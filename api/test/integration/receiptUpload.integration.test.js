const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { extractReceipt } = require('../../src/llm/ollamaVisionClient');
const { UPLOAD_DIR } = require('../../src/documents/receiptStorage');
const { ValidationError, NotFoundError } = require('../../src/errors');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'receipts');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const receiptUploadHandler = createReceiptUploadHandler({ pool, transactionsService, accountsService, extractReceipt });

function loadFixture(filename, mimetype = 'image/png') {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, filename));
  return { buffer, mimetype, size: buffer.length, originalname: filename };
}

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    email,
    'Test User',
  ]);
  return rows[0].id;
}

async function deleteTestUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]); // cascades to accounts/shared_items -> transactions/documents/transaction_sources
}

async function sharedItemsForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM shared_items WHERE user_id = $1 ORDER BY received_at ASC', [
    userId,
  ]);
  return rows;
}

async function documentForSharedItem(sharedItemId) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE shared_item_id = $1', [sharedItemId]);
  return rows[0] || null;
}

async function transactionSourcesFor(transactionId) {
  const { rows } = await pool.query('SELECT * FROM transaction_sources WHERE transaction_id = $1', [transactionId]);
  return rows;
}

// Generous per-test timeout: warm vision extraction is ~4.3s per the brief's spike, cold
// start can be much longer (~14s observed once).
jest.setTimeout(30000);

describe('receipt upload & parsing (against real Postgres AND real Ollama vision model)', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`f16-${Date.now()}-${Math.random().toString(36).slice(2)}@findo.test`);
    account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
  });

  afterEach(async () => {
    if (userId) {
      await deleteTestUser(userId);
      userId = undefined;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('extract then confirm creates a transaction with correct provenance', async () => {
    const file = loadFixture('clear-coffee-receipt.png');

    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'web_upload' });
    expect(extractResult.isReadable).toBe(true);
    expect(extractResult.fileRef).toMatch(/^api\/uploads\/receipts\//);

    const sharedItemsBefore = await sharedItemsForUser(userId);
    expect(sharedItemsBefore).toHaveLength(0); // handleExtract must not write to the DB

    const confirmResult = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: file.originalname,
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: extractResult.extraction.merchant,
      transactionDate: extractResult.extraction.transactionDate,
      amount: extractResult.extraction.total,
      lineItems: extractResult.extraction.lineItems,
    });

    expect(confirmResult.statusCode).toBe(201);
    expect(confirmResult.transaction.account_id).toBe(account.id);

    const sharedItems = await sharedItemsForUser(userId);
    expect(sharedItems).toHaveLength(1);
    expect(sharedItems[0].parse_status).toBe('parsed');
    expect(sharedItems[0].original_filename).toBe('clear-coffee-receipt.png');

    const document = await documentForSharedItem(sharedItems[0].id);
    expect(document).not.toBeNull();

    const sources = await transactionSourcesFor(confirmResult.transaction.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].role).toBe('origin');
  });

  test('handleExtract never persists, so an abandoned extraction leaves no shared_items row', async () => {
    const file = loadFixture('clear-coffee-receipt.png');
    await receiptUploadHandler.handleExtract(userId, { file, channel: 'web_upload' });
    expect(await sharedItemsForUser(userId)).toHaveLength(0);
  });

  test('handleConfirm on manually-entered fields (no vision extraction involved) still creates a transaction', async () => {
    const result = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: `api/uploads/receipts/${randomUUID()}.png`,
      originalFilename: 'blurry.png',
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: 'Manually Entered Store',
      transactionDate: '2026-09-01',
      amount: 12.5,
      lineItems: [],
    });
    expect(result.statusCode).toBe(201);
    expect(result.transaction.merchant_raw).toBe('Manually Entered Store');
  });

  // Regression test for the manual-entry provenance fix: the manual-entry fallback is reached
  // specifically because the receipt was unreadable, so a human types the transaction in by
  // hand. That must NOT be recorded as if a model successfully parsed the receipt —
  // isManual: true should flow through to both the transaction's is_manual column and the
  // shared_items row's parse_status (which should say 'failed', since the underlying
  // extraction genuinely did fail; the manual entry doesn't change that fact about the file).
  test('a manual-entry confirm (isManual: true) records is_manual: true on the transaction and parse_status: failed on the shared_items row', async () => {
    const result = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: `api/uploads/receipts/${randomUUID()}.png`,
      originalFilename: 'blurry.png',
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: 'Manually Entered Store',
      transactionDate: '2026-09-01',
      amount: 12.5,
      lineItems: [],
      isManual: true,
    });

    expect(result.statusCode).toBe(201);
    expect(result.transaction.is_manual).toBe(true);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].parse_status).toBe('failed');

    const sources = await transactionSourcesFor(result.transaction.id);
    expect(sources).toHaveLength(1);
  });

  // Proves the "gate on `total`, not a self-reported legibility flag" rule matters in
  // practice: this fixture uses an unusual label ("AMT DUE" instead of "Total") and, per the
  // brief, the model has been observed to nonetheless extract every field correctly.
  test('an unusual-layout receipt (no "Total:" label) still extracts correctly', async () => {
    const file = loadFixture('unusual-layout-target.png');

    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'web_upload' });
    expect(extractResult.isReadable).toBe(true);

    const result = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: file.originalname,
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: extractResult.extraction.merchant,
      transactionDate: extractResult.extraction.transactionDate,
      amount: extractResult.extraction.total,
      lineItems: extractResult.extraction.lineItems,
    });

    expect(result.statusCode).toBe(201);
    expect(result.transaction).not.toBeNull();
    expect(Number(result.transaction.amount)).toBe(-14.87);
    expect(result.transaction.type).toBe('debit');

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].parse_status).toBe('parsed');
    expect(items[0].channel).toBe('web_upload');
  });

  // Regression test for a real bug caught in production use (not the original test suite): a
  // real Starbucks receipt with a Subtotal/Tax/Gratuity/Total breakdown made the model return
  // `"total"` as a JSON string ("11.29") rather than a JSON number, which the original strict
  // typeof-number check rejected outright — a perfectly legible receipt was wrongly reported as
  // unreadable. Fixed in validateReceiptExtraction.js (coerceToPositiveNumber). This fixture
  // recreates that receipt's exact content as a clean synthetic image.
  test('a receipt whose total the model returns as a numeric string is still processed correctly (real-world regression)', async () => {
    const file = loadFixture('starbucks-string-total-regression.png');

    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'web_upload' });
    expect(extractResult.isReadable).toBe(true);

    const result = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: file.originalname,
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: extractResult.extraction.merchant,
      transactionDate: extractResult.extraction.transactionDate,
      amount: extractResult.extraction.total,
      lineItems: extractResult.extraction.lineItems,
    });

    expect(result.statusCode).toBe(201);
    expect(result.transaction).not.toBeNull();
    expect(Number(result.transaction.amount)).toBe(-11.29);
    expect(result.transaction.merchant_raw).toEqual(expect.stringContaining('STARBUCKS'));
  });

  test('an illegible receipt is treated as unreadable by handleExtract: no extraction, nothing written', async () => {
    const file = loadFixture('illegible-noise.png');

    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

    expect(extractResult.isReadable).toBe(false);
    expect(extractResult.extraction).toBeNull();
    expect(extractResult.detectedAccountId).toBeNull();

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(0);
  });

  test('a nonexistent account_id is rejected by handleConfirm with no orphan shared_items/documents rows and no transaction', async () => {
    const file = loadFixture('clear-coffee-receipt.png');
    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

    await expect(
      receiptUploadHandler.handleConfirm(userId, {
        fileRef: extractResult.fileRef,
        originalFilename: file.originalname,
        channel: 'chat',
        accountId: '00000000-0000-0000-0000-000000000000',
        merchantRaw: extractResult.extraction.merchant,
        transactionDate: extractResult.extraction.transactionDate,
        amount: extractResult.extraction.total,
        lineItems: extractResult.extraction.lineItems,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  // An invalid account_id is retryable — the user just needs to pick a different account and
  // resubmit with the same file_ref — so the saved file must survive this failure, not be
  // deleted. (Previously this test asserted the opposite, which meant the UI's "Your entries
  // are kept — try again" retry prompt was actually lying: the file was already gone.)
  test('handleConfirm leaves the saved receipt file on disk when the account_id is invalid, so a retry with the same file_ref can succeed', async () => {
    const file = loadFixture('clear-coffee-receipt.png');
    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

    const savedFilePath = path.join(UPLOAD_DIR, path.basename(extractResult.fileRef));
    await expect(fsPromises.access(savedFilePath)).resolves.toBeUndefined(); // file exists after extract

    await expect(
      receiptUploadHandler.handleConfirm(userId, {
        fileRef: extractResult.fileRef,
        originalFilename: file.originalname,
        channel: 'chat',
        accountId: '00000000-0000-0000-0000-000000000000',
        merchantRaw: extractResult.extraction.merchant,
        transactionDate: extractResult.extraction.transactionDate,
        amount: extractResult.extraction.total,
        lineItems: extractResult.extraction.lineItems,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(fsPromises.access(savedFilePath)).resolves.toBeUndefined(); // file still exists — retry is possible

    // And the retry itself actually works with the same file_ref, proving this isn't just an
    // unused file sitting on disk.
    const retryResult = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: file.originalname,
      channel: 'chat',
      accountId: account.id,
      merchantRaw: extractResult.extraction.merchant,
      transactionDate: extractResult.extraction.transactionDate,
      amount: extractResult.extraction.total,
      lineItems: extractResult.extraction.lineItems,
    });
    expect(retryResult.statusCode).toBe(201);
  });

  // A missing/malformed transaction_date is a validation failure caught before pool.connect() —
  // just like the missing merchant/amount checks above — so it must be retryable: the saved
  // file must survive, not be deleted. Before this fix, an empty transactionDate skipped
  // validation entirely and reached Postgres's `date NOT NULL` column inside the BEGIN block,
  // landing in the DB-failure catch branch that (correctly, for genuine DB failures) deletes the
  // file — reproducing the "file deleted but UI invites a retry with the same file_ref" bug via
  // a different trigger.
  test('handleConfirm rejects a missing transaction date with a ValidationError and leaves the saved receipt file on disk, so a retry with the same file_ref can succeed', async () => {
    const file = loadFixture('clear-coffee-receipt.png');
    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

    const savedFilePath = path.join(UPLOAD_DIR, path.basename(extractResult.fileRef));
    await expect(fsPromises.access(savedFilePath)).resolves.toBeUndefined(); // file exists after extract

    await expect(
      receiptUploadHandler.handleConfirm(userId, {
        fileRef: extractResult.fileRef,
        originalFilename: file.originalname,
        channel: 'chat',
        accountId: account.id,
        merchantRaw: extractResult.extraction.merchant,
        transactionDate: '',
        amount: extractResult.extraction.total,
        lineItems: extractResult.extraction.lineItems,
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(fsPromises.access(savedFilePath)).resolves.toBeUndefined(); // file still exists — retry is possible

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);

    // And the retry itself actually works with the same file_ref, proving this isn't just an
    // unused file sitting on disk.
    const retryResult = await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: file.originalname,
      channel: 'chat',
      accountId: account.id,
      merchantRaw: extractResult.extraction.merchant,
      transactionDate: extractResult.extraction.transactionDate,
      amount: extractResult.extraction.total,
      lineItems: extractResult.extraction.lineItems,
    });
    expect(retryResult.statusCode).toBe(201);
  });

  test("another user's account_id (not owned by this user) is rejected by handleConfirm the same way as nonexistent", async () => {
    const otherUserId = await createTestUser(`f16-other-${Date.now()}@findo.test`);
    try {
      const otherAccount = await accountsService.createAccount(otherUserId, {
        nickname: 'Other-Checking',
        type: 'checking',
        institution_name: 'Wells Fargo',
      });
      const file = loadFixture('clear-coffee-receipt.png');
      const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

      await expect(
        receiptUploadHandler.handleConfirm(userId, {
          fileRef: extractResult.fileRef,
          originalFilename: file.originalname,
          channel: 'chat',
          accountId: otherAccount.id,
          merchantRaw: extractResult.extraction.merchant,
          transactionDate: extractResult.extraction.transactionDate,
          amount: extractResult.extraction.total,
          lineItems: extractResult.extraction.lineItems,
        })
      ).rejects.toBeInstanceOf(NotFoundError);

      const items = await sharedItemsForUser(userId);
      expect(items).toHaveLength(0);
      const otherItems = await sharedItemsForUser(otherUserId);
      expect(otherItems).toHaveLength(0);
    } finally {
      await deleteTestUser(otherUserId);
    }
  });

  test('an inactive account is rejected by handleConfirm with no orphan rows and no transaction', async () => {
    await accountsService.updateAccount(userId, account.id, { is_active: false });
    const file = loadFixture('clear-coffee-receipt.png');
    const extractResult = await receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' });

    await expect(
      receiptUploadHandler.handleConfirm(userId, {
        fileRef: extractResult.fileRef,
        originalFilename: file.originalname,
        channel: 'chat',
        accountId: account.id,
        merchantRaw: extractResult.extraction.merchant,
        transactionDate: extractResult.extraction.transactionDate,
        amount: extractResult.extraction.total,
        lineItems: extractResult.extraction.lineItems,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test('a non-image file (.txt) is rejected by handleExtract with a ValidationError and no DB writes at all', async () => {
    const file = { buffer: Buffer.from('just some text, not an image'), mimetype: 'text/plain', size: 29 };

    await expect(receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' })).rejects.toBeInstanceOf(
      ValidationError
    );

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(0);
  });

  test('an oversized file is rejected by handleExtract with a ValidationError and no DB writes at all', async () => {
    const file = { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimetype: 'image/png', size: 10 * 1024 * 1024 + 1 };

    await expect(receiptUploadHandler.handleExtract(userId, { file, channel: 'chat' })).rejects.toBeInstanceOf(
      ValidationError
    );

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });
});
