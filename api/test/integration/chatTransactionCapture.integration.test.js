const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createChatTransactionHandler } = require('../../src/chat/chatTransactionHandler');
const { extractTransaction } = require('../../src/llm/ollamaClient');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const chatTransactionHandler = createChatTransactionHandler({ pool, transactionsService, extractTransaction });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    email,
    'Test User',
  ]);
  return rows[0].id;
}

async function deleteTestUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]); // cascades to accounts/shared_items -> transactions/clarification_requests/transaction_sources
}

async function sharedItemsForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM shared_items WHERE user_id = $1 ORDER BY received_at ASC', [
    userId,
  ]);
  return rows;
}

async function transactionSourcesFor(transactionId) {
  const { rows } = await pool.query('SELECT * FROM transaction_sources WHERE transaction_id = $1', [transactionId]);
  return rows;
}

async function pendingClarificationFor(userId) {
  const { rows } = await pool.query(
    `SELECT cr.* FROM clarification_requests cr
     JOIN shared_items si ON si.id = cr.shared_item_id
     WHERE si.user_id = $1
     ORDER BY cr.created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// Generous per-test timeout: a warm Ollama call is ~1-2s per the brief, but a couple of
// these tests make two sequential calls (initial + re-extraction on clarification resolve).
jest.setTimeout(30000);

describe('chat transaction capture (against real Postgres AND real Ollama)', () => {
  let userId;

  afterEach(async () => {
    if (userId) {
      await deleteTestUser(userId);
      userId = undefined;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('a clear message with exactly one active account creates a transaction with provenance rows', async () => {
    userId = await createTestUser(`f15-clear-${Date.now()}@findo.test`);
    const account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });

    const start = Date.now();
    const result = await chatTransactionHandler.handleMessage(userId, 'Spent $12.50 at Starbucks today');
    const latencyMs = Date.now() - start;
    console.log(`[latency] warm extraction (clear message) took ${latencyMs}ms`);

    expect(result.statusCode).toBe(201);
    expect(result.reply).toEqual(expect.stringContaining('12.50'));
    expect(result.reply).toEqual(expect.stringContaining('Chase-Checking'));

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].raw_text).toBe('Spent $12.50 at Starbucks today');
    expect(items[0].parse_status).toBe('parsed');
    expect(items[0].channel).toBe('chat');
    expect(items[0].content_type).toBe('text');

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(-12.5);
    expect(transactions[0].type).toBe('debit');
    expect(transactions[0].is_manual).toBe(false);
    expect(transactions[0].reconciliation_status).toBe('confirmed');

    const sources = await transactionSourcesFor(transactions[0].id);
    expect(sources).toHaveLength(1);
    expect(sources[0].shared_item_id).toBe(items[0].id);
    expect(sources[0].role).toBe('origin');
  });

  test('a credit message with no merchant (auto-resolved single account) is logged as a credit', async () => {
    userId = await createTestUser(`f15-credit-${Date.now()}@findo.test`);
    const account = await accountsService.createAccount(userId, {
      nickname: 'Ally-Savings',
      type: 'savings',
      institution_name: 'Ally',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'Got paid $2000 today');

    expect(result.statusCode).toBe(201);

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(2000);
    expect(transactions[0].type).toBe('credit');
    expect(transactions[0].reconciliation_status).toBe('confirmed');
  });

  test('a refund message resolves date_hint "yesterday" to the day before today', async () => {
    userId = await createTestUser(`f15-refund-${Date.now()}@findo.test`);
    const account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'Refunded $30 from Amazon yesterday');
    expect(result.statusCode).toBe(201);

    const transactions = await transactionsService.listTransactionsForAccount(userId, account.id);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(30);
    expect(transactions[0].type).toBe('credit');

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expected = yesterday.toISOString().slice(0, 10);
    expect(transactions[0].transaction_date.toISOString().slice(0, 10)).toBe(expected);
  });

  test('a non-transaction message creates no shared_items row and no transaction', async () => {
    userId = await createTestUser(`f15-nontxn-${Date.now()}@findo.test`);
    await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'How is my balance looking?');

    expect(result).toBeNull(); // falls through to the generic chat echo

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test('a vague message with no usable amount creates no shared_items row and no transaction', async () => {
    userId = await createTestUser(`f15-vague-${Date.now()}@findo.test`);
    await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'I bought some stuff earlier');

    expect(result).toBeNull();

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test('zero active accounts is guarded — no transaction, no crash', async () => {
    userId = await createTestUser(`f15-noaccts-${Date.now()}@findo.test`);

    const result = await chatTransactionHandler.handleMessage(userId, 'Spent $12.50 at Starbucks today');

    expect(result.statusCode).toBe(200);
    expect(result.reply.toLowerCase()).toEqual(expect.stringContaining("don't have any accounts"));

    const items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(0);
  });

  test('ambiguous account (hint matches none of the active accounts) creates a clarification; a valid follow-up resolves it', async () => {
    userId = await createTestUser(`f15-ambiguous-${Date.now()}@findo.test`);
    // Deliberately named so "Chase checking" (mentioned in the message) substring-matches
    // neither account — this is the brief's recommended deterministic way to force
    // ambiguity without depending on a specific garbled extraction.
    const accountA = await accountsService.createAccount(userId, {
      nickname: 'Personal-Savings',
      type: 'savings',
      institution_name: 'Wells Fargo',
    });
    const accountB = await accountsService.createAccount(userId, {
      nickname: 'Rainy-Day-Fund',
      type: 'savings',
      institution_name: 'Marcus',
    });

    const first = await chatTransactionHandler.handleMessage(
      userId,
      'Paid $45 for groceries yesterday on my Chase checking'
    );

    // A clarification (shared_items + clarification_requests rows) was created, so this
    // uses 201, the same as any other successful chat-processing response that persisted
    // something — only the later "couldn't match, re-asking" branch (no DB writes) uses 200.
    expect(first.statusCode).toBe(201);
    expect(first.reply).toEqual(expect.stringContaining('Personal-Savings'));
    expect(first.reply).toEqual(expect.stringContaining('Rainy-Day-Fund'));

    let items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].parse_status).toBe('needs_clarification');

    let pending = await pendingClarificationFor(userId);
    expect(pending).not.toBeNull();
    expect(pending.resolved_at).toBeNull();

    let transactions = await transactionsService.listTransactionsForAccount(userId, accountA.id);
    expect(transactions).toHaveLength(0);

    // An unrelated message that doesn't match any account re-asks rather than starting a
    // new independent transaction attempt (accepted limitation per the brief).
    const unrelated = await chatTransactionHandler.handleMessage(userId, 'What is the weather like');
    expect(unrelated.statusCode).toBe(200);
    expect(unrelated.reply.toLowerCase()).toEqual(expect.stringContaining("couldn't match"));

    pending = await pendingClarificationFor(userId);
    expect(pending.resolved_at).toBeNull();

    // Now answer with a matching account nickname.
    const resolved = await chatTransactionHandler.handleMessage(userId, 'Rainy-Day-Fund');

    expect(resolved.statusCode).toBe(201);

    pending = await pendingClarificationFor(userId);
    expect(pending.resolved_at).not.toBeNull();
    expect(pending.user_response).toBe('Rainy-Day-Fund');

    items = await sharedItemsForUser(userId);
    expect(items).toHaveLength(1);
    expect(items[0].parse_status).toBe('parsed');

    transactions = await transactionsService.listTransactionsForAccount(userId, accountB.id);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(-45);
    expect(transactions[0].type).toBe('debit');
    expect(transactions[0].reconciliation_status).toBe('unconfirmed'); // ambiguous, resolved by asking
    expect(transactions[0].is_manual).toBe(false);

    const sources = await transactionSourcesFor(transactions[0].id);
    expect(sources).toHaveLength(1);
    expect(sources[0].shared_item_id).toBe(items[0].id);
    expect(sources[0].role).toBe('origin');
  });

  test('ambiguous account with no hint at all (2+ accounts) also creates a clarification, and answering resolves it', async () => {
    userId = await createTestUser(`f15-nohint-ambiguous-${Date.now()}@findo.test`);
    const chase = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
    await accountsService.createAccount(userId, {
      nickname: 'Ally-Savings',
      type: 'savings',
      institution_name: 'Ally',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'Got paid $2000 today');

    expect(result.statusCode).toBe(201);
    expect(result.reply).toEqual(expect.stringContaining('Chase-Checking'));
    expect(result.reply).toEqual(expect.stringContaining('Ally-Savings'));

    let pending = await pendingClarificationFor(userId);
    expect(pending).not.toBeNull();
    expect(pending.resolved_at).toBeNull();

    let transactions = await transactionsService.listTransactionsForAccount(userId, chase.id);
    expect(transactions).toHaveLength(0);

    const resolved = await chatTransactionHandler.handleMessage(userId, 'Chase-Checking');
    expect(resolved.statusCode).toBe(201);

    pending = await pendingClarificationFor(userId);
    expect(pending.resolved_at).not.toBeNull();

    transactions = await transactionsService.listTransactionsForAccount(userId, chase.id);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].amount)).toBe(2000);
    expect(transactions[0].type).toBe('credit');
    expect(transactions[0].reconciliation_status).toBe('unconfirmed');
  });

  test('an inactive account is not offered/matched for auto-resolution or fuzzy matching', async () => {
    userId = await createTestUser(`f15-inactive-${Date.now()}@findo.test`);
    const inactiveAccount = await accountsService.createAccount(userId, {
      nickname: 'Old-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
    await accountsService.updateAccount(userId, inactiveAccount.id, { is_active: false });
    const activeAccount = await accountsService.createAccount(userId, {
      nickname: 'New-Savings',
      type: 'savings',
      institution_name: 'Ally',
    });

    const result = await chatTransactionHandler.handleMessage(userId, 'Spent $12.50 at Starbucks today');

    expect(result.statusCode).toBe(201);

    const transactions = await transactionsService.listTransactionsForAccount(userId, activeAccount.id);
    expect(transactions).toHaveLength(1);
  });
});
