const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { extractReceipt } = require('../../src/llm/ollamaVisionClient');
const { ValidationError, NotFoundError } = require('../../src/errors');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'receipts');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const receiptUploadHandler = createReceiptUploadHandler({ pool, transactionsService, extractReceipt });

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

  test('a clear, legible receipt creates a debit transaction with full provenance', async () => {
    const file = loadFixture('clear-coffee-receipt.png');

    const start = Date.now();
    const result = await receiptUploadHandler.handleUpload(userId, { file, accountId: account.id, channel: 'chat' });
    const latencyMs = Date.now() - start;
    console.log(`[latency] warm vision extraction (clear receipt) took ${latencyMs}ms`);

    expect(result.statusCode).toBe(201);
    expect(result.transaction).not.toBeNull();
    expect(result.transaction.type).toBe('debit');
    expect(Number(result.transaction.amount)).toBe(-15.75);
    expect(result.transaction.is_manual).toBe(false);
    expect(result.transaction.reconciliation_status).toBe('confirmed');
    expect(result.message).toEqual(expect.stringContaining('15.75'));

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].channel).toBe('chat');
    expect(items[0].content_type).toBe('file');
    expect(items[0].parse_status).toBe('parsed');
    expect(items[0].file_ref).toEqual(expect.stringContaining('api/uploads/receipts/'));

    const document = await documentForSharedItem(items[0].id);
    expect(document).not.toBeNull();
    expect(document.document_type).toBe('receipt');
    expect(document.page_count).toBe(1);

    const sources = await transactionSourcesFor(result.transaction.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].shared_item_id).toBe(items[0].id);
    expect(sources[0].role).toBe('origin');

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].id).toBe(result.transaction.id);
  });

  // Proves the "gate on `total`, not a self-reported legibility flag" rule matters in
  // practice: this fixture uses an unusual label ("AMT DUE" instead of "Total") and, per the
  // brief, the model has been observed to nonetheless extract every field correctly.
  test('an unusual-layout receipt (no "Total:" label) still extracts correctly', async () => {
    const file = loadFixture('unusual-layout-target.png');

    const result = await receiptUploadHandler.handleUpload(userId, {
      file,
      accountId: account.id,
      channel: 'web_upload',
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

  test('an illegible receipt is treated as unreadable: no transaction, shared_items marked failed', async () => {
    const file = loadFixture('illegible-noise.png');

    const result = await receiptUploadHandler.handleUpload(userId, { file, accountId: account.id, channel: 'chat' });

    expect(result.statusCode).toBe(200);
    expect(result.transaction).toBeNull();
    expect(result.message.toLowerCase()).toEqual(expect.stringContaining("couldn't read"));

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].parse_status).toBe('failed');

    const document = await documentForSharedItem(items[0].id);
    expect(document).not.toBeNull();
    expect(document.document_type).toBe('receipt');

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(0);
  });

  test('a nonexistent account_id is rejected with no orphan shared_items/documents rows and no transaction', async () => {
    const file = loadFixture('clear-coffee-receipt.png');

    await expect(
      receiptUploadHandler.handleUpload(userId, { file, accountId: '00000000-0000-0000-0000-000000000000', channel: 'chat' })
    ).rejects.toBeInstanceOf(NotFoundError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test("another user's account_id (not owned by this user) is rejected the same way as nonexistent", async () => {
    const otherUserId = await createTestUser(`f16-other-${Date.now()}@findo.test`);
    try {
      const otherAccount = await accountsService.createAccount(otherUserId, {
        nickname: 'Other-Checking',
        type: 'checking',
        institution_name: 'Wells Fargo',
      });
      const file = loadFixture('clear-coffee-receipt.png');

      await expect(
        receiptUploadHandler.handleUpload(userId, { file, accountId: otherAccount.id, channel: 'chat' })
      ).rejects.toBeInstanceOf(NotFoundError);

      const items = await sharedItemsForUser(userId);
      expect(items).toHaveLength(0);
      const otherItems = await sharedItemsForUser(otherUserId);
      expect(otherItems).toHaveLength(0);
    } finally {
      await deleteTestUser(otherUserId);
    }
  });

  test('an inactive account is rejected with no orphan rows and no transaction', async () => {
    await accountsService.updateAccount(userId, account.id, { is_active: false });
    const file = loadFixture('clear-coffee-receipt.png');

    await expect(
      receiptUploadHandler.handleUpload(userId, { file, accountId: account.id, channel: 'chat' })
    ).rejects.toBeInstanceOf(NotFoundError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test('a non-image file (.txt) is rejected with a ValidationError and no DB writes at all', async () => {
    const file = { buffer: Buffer.from('just some text, not an image'), mimetype: 'text/plain', size: 29 };

    await expect(
      receiptUploadHandler.handleUpload(userId, { file, accountId: account.id, channel: 'chat' })
    ).rejects.toBeInstanceOf(ValidationError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(0);
  });

  test('an oversized file is rejected with a ValidationError and no DB writes at all', async () => {
    const file = { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), mimetype: 'image/png', size: 10 * 1024 * 1024 + 1 };

    await expect(
      receiptUploadHandler.handleUpload(userId, { file, accountId: account.id, channel: 'chat' })
    ).rejects.toBeInstanceOf(ValidationError);

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });
});
