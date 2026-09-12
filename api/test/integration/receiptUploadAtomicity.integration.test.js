// Proves the F1.6 receipt-upload success path is genuinely atomic: the transaction row and its
// shared_items/documents/transaction_sources provenance either all land or none do. This is a
// real-Postgres test (uses a real pg.Pool client and a real BEGIN/COMMIT/ROLLBACK), but
// deliberately does NOT call the real Ollama vision model — extraction correctness is already
// covered by receiptUpload.integration.test.js (the LLM-tagged suite); what's under test here
// is purely the SQL transaction wrapping around the four inserts, which has nothing to do with
// the vision model. Keeping it out of the LLM-tagged config means it's fast, deterministic, and
// still runs in the default `test:integration` (CI-safe) bucket.
const fs = require('node:fs/promises');
const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { UPLOAD_DIR } = require('../../src/documents/receiptStorage');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });

// A fast, deterministic stand-in for the real vision model — always resolves with a legible
// extraction, so every test here reaches the success path's write sequence without depending
// on Ollama being installed/reachable/fast.
async function stubExtractReceipt() {
  return { merchant: 'Stub Coffee', date: '2026-01-15', total: 9.99, line_items: [] };
}

function fakeReceiptFile() {
  return { buffer: Buffer.from('fake-png-bytes'), mimetype: 'image/png', size: 14, originalname: 'receipt.png' };
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

async function countRows(fromSql, whereSql, params) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${fromSql} WHERE ${whereSql}`, params);
  return rows[0].count;
}

// Wraps the REAL pool so a checked-out client's `.query()` rejects once the SQL text contains
// `failOnSqlIncludes`, while everything else (BEGIN, the earlier inserts, ROLLBACK) still runs
// against real Postgres via a real client from `pool.connect()`. This lets a test force a
// failure on a specific insert deep in the write sequence and then check, via the untouched
// real pool, whether anything from the earlier inserts on that same (rolled-back) transaction
// survived.
//
// Important: `pg.Pool` recycles idle clients, so mutating `client.query` without undoing it
// would leak the interception onto whatever unrelated query the pool happens to reuse that
// same underlying client for next (this was tried and hung real test runs indefinitely — the
// pool's own internal client.query invocation, made when handling `pool.query(...)` calls
// elsewhere, silently broke against the mutated method). `client.release` is patched to
// restore the original `query` method first, so the client goes back to the pool exactly as it
// came out.
function poolThatFailsQueryContaining(realPool, failOnSqlIncludes) {
  return {
    connect: async () => {
      const client = await realPool.connect();
      const originalQuery = client.query.bind(client);
      const originalRelease = client.release.bind(client);
      client.query = (text, params) => {
        if (typeof text === 'string' && text.includes(failOnSqlIncludes)) {
          return Promise.reject(new Error('simulated failure injected for atomicity test'));
        }
        return originalQuery(text, params);
      };
      client.release = (...args) => {
        client.query = originalQuery;
        return originalRelease(...args);
      };
      return client;
    },
  };
}

jest.setTimeout(20000);

describe('receipt upload write-sequence atomicity (real Postgres, stubbed vision model)', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`f16-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}@findo.test`);
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

  test('the happy path (no injected failure) really does commit all four rows', async () => {
    const handler = createReceiptUploadHandler({ pool, transactionsService, extractReceipt: stubExtractReceipt });

    const result = await handler.handleUpload(userId, { file: fakeReceiptFile(), accountId: account.id, channel: 'chat' });

    expect(result.statusCode).toBe(201);
    expect(await countRows('transactions', 'account_id = $1', [account.id])).toBe(1);
    expect(await countRows('shared_items', 'user_id = $1', [userId])).toBe(1);
    expect(
      await countRows('documents d JOIN shared_items si ON si.id = d.shared_item_id', 'si.user_id = $1', [userId])
    ).toBe(1);
    expect(await countRows('transaction_sources ts JOIN transactions t ON t.id = ts.transaction_id', 't.account_id = $1', [account.id])).toBe(
      1
    );
  });

  // The core regression test for the atomicity fix: forces a real DB failure on the LAST
  // insert in the sequence (transaction_sources), after the transaction, shared_items, and
  // documents inserts have already run (uncommitted, on the same client) — and confirms every
  // one of them was rolled back rather than the transaction row surviving with zero provenance
  // pointing to it.
  test('a failure on the last insert (transaction_sources) rolls back the transaction, shared_items, and documents rows too', async () => {
    const failingPool = poolThatFailsQueryContaining(pool, 'INSERT INTO transaction_sources');
    const handler = createReceiptUploadHandler({ pool: failingPool, transactionsService, extractReceipt: stubExtractReceipt });

    await expect(
      handler.handleUpload(userId, { file: fakeReceiptFile(), accountId: account.id, channel: 'chat' })
    ).rejects.toThrow('simulated failure injected for atomicity test');

    expect(await countRows('transactions', 'account_id = $1', [account.id])).toBe(0);
    expect(await countRows('shared_items', 'user_id = $1', [userId])).toBe(0);
    expect(
      await countRows('documents d JOIN shared_items si ON si.id = d.shared_item_id', 'si.user_id = $1', [userId])
    ).toBe(0);
  });

  // Same idea, but failing earlier in the sequence (shared_items, right after the transaction
  // insert) — proves the transaction row itself (which would have committed fine on its own
  // pre-fix) is rolled back along with it.
  test('a failure on an earlier insert (shared_items) also rolls back the already-inserted transaction row', async () => {
    const failingPool = poolThatFailsQueryContaining(pool, 'INSERT INTO shared_items');
    const handler = createReceiptUploadHandler({ pool: failingPool, transactionsService, extractReceipt: stubExtractReceipt });

    await expect(
      handler.handleUpload(userId, { file: fakeReceiptFile(), accountId: account.id, channel: 'chat' })
    ).rejects.toThrow('simulated failure injected for atomicity test');

    expect(await countRows('transactions', 'account_id = $1', [account.id])).toBe(0);
    expect(await countRows('shared_items', 'user_id = $1', [userId])).toBe(0);
  });

  // The illegible/unreadable path also writes two rows (shared_items + documents) — proves
  // that sequence is atomic too, not just the successful-extraction path.
  test('a failure on documents (illegible path) rolls back the shared_items row too', async () => {
    async function stubIllegibleExtract() {
      return { merchant: null, date: null, total: null, line_items: [] };
    }
    const failingPool = poolThatFailsQueryContaining(pool, 'INSERT INTO documents');
    const handler = createReceiptUploadHandler({ pool: failingPool, transactionsService, extractReceipt: stubIllegibleExtract });

    await expect(
      handler.handleUpload(userId, { file: fakeReceiptFile(), accountId: account.id, channel: 'chat' })
    ).rejects.toThrow('simulated failure injected for atomicity test');

    expect(await countRows('shared_items', 'user_id = $1', [userId])).toBe(0);
  });

  // Regression test for a narrower gap the reviewer found in the first version of the atomicity
  // fix: pool.connect() itself sat outside the try/catch that cleans up the already-saved file,
  // so a connection-acquisition failure (pool exhaustion, DB unreachable) would leave the file
  // orphaned on disk with no DB attempt ever made. Uses a real UPLOAD_DIR before/after diff
  // rather than mocking the storage module, so this proves the actual saved file is gone, not
  // just that a mock was called.
  test('a failure acquiring a DB connection still cleans up the already-saved file', async () => {
    const unconnectablePool = {
      connect: async () => {
        throw new Error('simulated pool exhaustion');
      },
    };
    const handler = createReceiptUploadHandler({ pool: unconnectablePool, transactionsService, extractReceipt: stubExtractReceipt });

    const before = await fs.readdir(UPLOAD_DIR).catch(() => []);

    await expect(
      handler.handleUpload(userId, { file: fakeReceiptFile(), accountId: account.id, channel: 'chat' })
    ).rejects.toThrow('simulated pool exhaustion');

    const after = await fs.readdir(UPLOAD_DIR).catch(() => []);
    expect(after).toEqual(before);
  });
});
