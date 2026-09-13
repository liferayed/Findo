const { normalizeReceiptExtraction } = require('./validateReceiptExtraction');
const { validateReceiptUpload } = require('./validateReceiptUpload');
const { saveReceiptFile, deleteReceiptFileQuietly } = require('./receiptStorage');
const { ValidationError } = require('../errors');

// Matches exactly what saveReceiptFile (receiptStorage.js) produces: api/uploads/receipts/
// followed by a randomUUID() and an extension from ALLOWED_MIME_TYPES (validateReceiptUpload.js).
// Rejecting anything else here means a client can't smuggle an arbitrary path through file_ref —
// it's persisted verbatim as provenance, so its shape is checked alongside the other fields.
const FILE_REF_PATTERN = /^api\/uploads\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

function buildConfirmationReply(merchantRaw, amount) {
  return `Got it — logged $${amount.toFixed(2)} at ${merchantRaw} (debit).`;
}

function normalizeChannel(channel) {
  return channel === 'chat' ? 'chat' : 'web_upload';
}

async function insertSharedItem(client, userId, channel, fileRef, originalFilename, parseStatus, parsedSummary) {
  const { rows } = await client.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, original_filename, parse_status, parsed_summary)
     VALUES ($1, $2, 'file', $3, $4, $5, $6)
     RETURNING id`,
    [userId, channel, fileRef, originalFilename || null, parseStatus, parsedSummary || null]
  );
  return rows[0];
}

async function insertDocument(client, sharedItemId) {
  const { rows } = await client.query(
    `INSERT INTO documents (shared_item_id, document_type, page_count)
     VALUES ($1, 'receipt', 1)
     RETURNING id`,
    [sharedItemId]
  );
  return rows[0];
}

async function insertTransactionSource(client, transactionId, sharedItemId) {
  await client.query(
    `INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`,
    [transactionId, sharedItemId]
  );
}

/**
 * F1.6's web upload flow, split into two phases per the 2026-09-13 UI redesign
 * (see UI-UX Design.md §5): handleExtract runs the vision model and account detection
 * without writing anything to the database (so the user can review/edit before
 * anything is saved); handleConfirm takes the — possibly user-edited — fields and
 * performs the atomic multi-table write the old single-call handleUpload used to do.
 * Chat's flow is unaffected: chat.html still calls handleExtract then handleConfirm
 * back-to-back itself, since chat has no confirm-modal UI to pause at (out of scope
 * for this redesign — see UI-UX Design.md's explicit chat exclusion).
 */
function createReceiptUploadHandler({ pool, transactionsService, accountsService, extractReceipt }) {
  // `channel` is accepted (mirroring handleConfirm's shape and app.js's request body) but not
  // used here — it's only recorded on the shared_items row, which handleExtract never writes.
  async function handleExtract(userId, { file }) {
    const errors = validateReceiptUpload({ file });
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    const fileRef = await saveReceiptFile(file);

    let rawExtraction = null;
    try {
      rawExtraction = await extractReceipt(file.buffer.toString('base64'));
    } catch {
      rawExtraction = null;
    }

    const extraction = normalizeReceiptExtraction(rawExtraction);

    if (!extraction.isReadable) {
      return { fileRef, isReadable: false, extraction: null, detectedAccountId: null };
    }

    let detectedAccountId = null;
    if (extraction.cardLastFour) {
      const matches = await accountsService.findActiveAccountsByLastFour(userId, extraction.cardLastFour);
      if (matches.length === 1) {
        detectedAccountId = matches[0].id;
      }
    }

    return {
      fileRef,
      isReadable: true,
      extraction: {
        merchant: extraction.merchantRaw,
        transactionDate: extraction.transactionDate,
        total: extraction.total,
        lineItems: extraction.lineItems,
      },
      detectedAccountId,
    };
  }

  // `isManual` distinguishes the two callers of this same confirm path: the auto-extraction
  // confirm flow (default, false — the vision model successfully parsed the receipt) and the
  // manual-entry fallback (true — reached specifically because the receipt was unreadable, so
  // the human is typing in what the model couldn't extract). It's used only to record what
  // actually happened to the underlying file/extraction (parse_status, is_manual on the
  // transaction) — it does not change any validation or write-path behavior otherwise.
  async function handleConfirm(userId, { fileRef, originalFilename, channel, accountId, merchantRaw, transactionDate, amount, lineItems, isManual = false }) {
    const errors = [];
    if (typeof fileRef !== 'string' || !FILE_REF_PATTERN.test(fileRef)) {
      errors.push('file_ref is invalid');
    }
    if (typeof accountId !== 'string' || accountId.trim() === '') {
      errors.push('account_id is required');
    }
    if (typeof merchantRaw !== 'string' || merchantRaw.trim() === '') {
      errors.push('merchant is required');
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      errors.push('amount must be a positive number');
    }
    if (errors.length > 0) {
      // Validation failures are retryable — the user just needs to fix their input and submit
      // again with the same file_ref, so the saved file must NOT be deleted here.
      throw new ValidationError(errors);
    }

    // A bad/inactive/other-user account_id is also retryable (the user picks a different
    // account and resubmits with the same file_ref) — same reasoning as above, so this must
    // stay outside the try/catch that cleans up the file below.
    await transactionsService.findOwnedAccount(userId, accountId, { requireActive: true });

    const channelValue = normalizeChannel(channel);
    const parseStatus = isManual ? 'failed' : 'parsed';
    const summary = lineItems && lineItems.length > 0
      ? `${merchantRaw} — $${amount.toFixed(2)} (${lineItems.length} item${lineItems.length === 1 ? '' : 's'})`
      : `${merchantRaw} — $${amount.toFixed(2)}`;

    try {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const transaction = await transactionsService.createTransactionFromReceipt(
          userId,
          { accountId, transactionDate, amount, merchantRaw, isManual },
          { client }
        );

        const sharedItem = await insertSharedItem(client, userId, channelValue, fileRef, originalFilename, parseStatus, summary);
        const document = await insertDocument(client, sharedItem.id);
        await insertTransactionSource(client, transaction.id, sharedItem.id);

        await client.query('COMMIT');
        return { statusCode: 201, documentId: document.id, transaction, message: buildConfirmationReply(merchantRaw, amount) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      // Only DB/connection/transaction failures land here (pool.connect() itself, or anything
      // inside the BEGIN/COMMIT block) — genuinely non-retryable with the same file_ref, so the
      // saved file is cleaned up.
      await deleteReceiptFileQuietly(fileRef);
      throw err;
    }
  }

  return { handleExtract, handleConfirm };
}

module.exports = { createReceiptUploadHandler };
