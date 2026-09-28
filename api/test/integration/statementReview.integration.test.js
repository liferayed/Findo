const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createStatementReviewService } = require('../../src/documents/statementReviewService');
const { ValidationError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const service = createStatementReviewService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

async function seedReadyForReview(userId, accountId, extractedDataOverrides = {}) {
  const { rows: [sharedItem] } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'parsed') RETURNING id`,
    [userId]
  );
  const extractedData = {
    transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
    beginningBalance: 100, endingBalance: 51.77,
    institutionName: null, accountTypeText: null, lastFour: null, creditCard: null,
    resolvedAccountId: accountId, accountOfferDeclined: false,
    ...extractedDataOverrides,
  };
  await pool.query(`INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`, [
    sharedItem.id, JSON.stringify(extractedData),
  ]);
  return sharedItem.id;
}

describe('statement review service (against real Postgres)', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`review-${Date.now()}-${Math.random()}@findo.test`);
    account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
  });
  afterEach(async () => { await pool.query('DELETE FROM users WHERE id = $1', [userId]); });
  afterAll(async () => { await pool.end(); });

  test('a row with no candidate classifies as new', async () => {
    const id = await seedReadyForReview(userId, account.id);
    const review = await service.buildReview(userId, id);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0].kind).toBe('new');
    expect(review.accountId).toBe(account.id);
  });

  test('a row matching an unconfirmed transaction classifies as corroborate', async () => {
    const t = await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target #1234', type: 'debit', reconciliationStatus: 'unconfirmed',
    });
    const id = await seedReadyForReview(userId, account.id);
    const review = await service.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('corroborate');
    expect(review.rows[0].candidate.id).toBe(t.id);
  });

  test('two identical statement rows only match one candidate each (excludeIds accumulation)', async () => {
    const t1 = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target #1234', type: 'debit', reconciliationStatus: 'unconfirmed' });
    const id = await seedReadyForReview(userId, account.id, {
      transactions: [
        { date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 },
        { date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 },
      ],
    });
    const review = await service.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('corroborate');
    expect(review.rows[0].candidate.id).toBe(t1.id);
    expect(review.rows[1].kind).toBe('new'); // the only candidate was already claimed by row 0
  });

  test('balanceMismatch is null when the statement ending balance matches the reconstructed balance', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    const id = await seedReadyForReview(userId, account.id, { endingBalance: 100 });
    const review = await service.buildReview(userId, id);
    expect(review.balanceMismatch).toBeNull();
  });

  test('balanceMismatch reports a gap when they differ', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    const id = await seedReadyForReview(userId, account.id, { endingBalance: 37.54, transactions: [] });
    const review = await service.buildReview(userId, id);
    expect(review.balanceMismatch).not.toBeNull();
    expect(review.balanceMismatch.gap).toBeCloseTo(62.46);
  });

  test('rejects a statement whose account offer was declined', async () => {
    const id = await seedReadyForReview(userId, account.id, { resolvedAccountId: null, accountOfferDeclined: true });
    await expect(service.buildReview(userId, id)).rejects.toThrow(ValidationError);
  });
});
