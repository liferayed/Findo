const { normalizeReceiptExtraction } = require('./validateReceiptExtraction');
const { validateReceiptUpload } = require('./validateReceiptUpload');
const { saveReceiptFile, deleteReceiptFileQuietly } = require('./receiptStorage');
const { ValidationError } = require('../errors');

const UNREADABLE_REPLY =
  "I couldn't read that receipt clearly — could you reshare a clearer photo, or enter it manually?";
const FAILED_SUMMARY = "couldn't read this receipt";

function buildConfirmationReply(extraction) {
  return `Got it — logged $${extraction.total.toFixed(2)} at ${extraction.merchantRaw} (debit).`;
}

function normalizeChannel(channel) {
  return channel === 'chat' ? 'chat' : 'web_upload';
}

// All three of these take a checked-out client (not the pool) so every write in handleUpload
// below runs on the same BEGIN/COMMIT transaction — see the comment there for why.
async function insertSharedItem(client, userId, channel, fileRef, parseStatus, parsedSummary) {
  const { rows } = await client.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status, parsed_summary)
     VALUES ($1, $2, 'file', $3, $4, $5)
     RETURNING id`,
    [userId, channel, fileRef, parseStatus, parsedSummary || null]
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
 * Ties together receipt-upload validation, vision extraction, and provenance persistence for
 * F1.6. Both entry points (chat attachment, web upload) call this same handler via the same
 * POST /documents route — the only difference between them is the `channel` value passed
 * through to shared_items.
 */
function createReceiptUploadHandler({ pool, transactionsService, extractReceipt }) {
  async function handleUpload(userId, { file, accountId, channel }) {
    const errors = validateReceiptUpload({ file, accountId });
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    // Validate ownership + active status BEFORE writing anything to disk or spending a vision-
    // model call, so a rejected request (wrong/inactive/nonexistent account) never leaves an
    // orphan file or DB row behind. Reuses transactionsService's existing check rather than
    // reimplementing it.
    await transactionsService.findOwnedAccount(userId, accountId, { requireActive: true });

    const channelValue = normalizeChannel(channel);
    const fileRef = await saveReceiptFile(file);

    let rawExtraction = null;
    try {
      rawExtraction = await extractReceipt(file.buffer.toString('base64'));
    } catch {
      // Model unreachable, timed out, or returned unparseable output — treated exactly like
      // an illegible image (never fabricate a transaction from a failed call), not a 500.
      rawExtraction = null;
    }

    const extraction = normalizeReceiptExtraction(rawExtraction);

    // Everything from here down (the transaction row, if any, plus shared_items/documents/
    // transaction_sources) runs on one checked-out client inside a real SQL transaction, so
    // the writes are atomic: either all of them land, or none do. Without this, a failure in
    // one of the later inserts after the transaction row was already committed on its own
    // would leave a permanent, provenance-less transaction behind — worse than simply losing
    // the upload.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (!extraction.isReadable) {
        const sharedItem = await insertSharedItem(client, userId, channelValue, fileRef, 'failed', FAILED_SUMMARY);
        const document = await insertDocument(client, sharedItem.id);
        await client.query('COMMIT');
        return { statusCode: 200, documentId: document.id, transaction: null, message: UNREADABLE_REPLY };
      }

      const transaction = await transactionsService.createTransactionFromReceipt(
        userId,
        {
          accountId,
          transactionDate: extraction.transactionDate,
          amount: extraction.total,
          merchantRaw: extraction.merchantRaw,
        },
        { client }
      );

      const sharedItem = await insertSharedItem(client, userId, channelValue, fileRef, 'parsed', extraction.summary);
      const document = await insertDocument(client, sharedItem.id);
      await insertTransactionSource(client, transaction.id, sharedItem.id);

      await client.query('COMMIT');
      return { statusCode: 201, documentId: document.id, transaction, message: buildConfirmationReply(extraction) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        // best-effort — if the connection itself is broken, there's nothing more to roll back
      });
      // The file was already written to disk before this transaction started — clean it up
      // rather than leaving it behind with nothing in the (now rolled-back) DB referencing it.
      await deleteReceiptFileQuietly(fileRef);
      throw err;
    } finally {
      client.release();
    }
  }

  return { handleUpload };
}

module.exports = { createReceiptUploadHandler, UNREADABLE_REPLY };
