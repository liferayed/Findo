const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { findMatch, applyCorroboration, applyAmountCorroboration } = require('../../src/reconciliation/reconciliationService');
const { ValidationError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });

async function makeSharedItem(userId) {
  const { rows } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, parse_status)
     VALUES ($1, 'web_upload', 'file', 'parsed') RETURNING id`,
    [userId]
  );
  return rows[0].id;
}

async function balanceOf(accountId) {
  const { rows } = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);
  return Number(rows[0].current_balance);
}

describe('reconciliation service (against real Postgres)', () => {
  let userId;
  let account;
  let otherAccount;

  async function seed(overrides = {}) {
    return transactionsService.createTransactionFromChat(userId, {
      accountId: account.id,
      transactionDate: '2026-01-12',
      amount: 48.23,
      merchantRaw: 'Target #1234',
      type: 'debit',
      reconciliationStatus: 'unconfirmed',
      ...overrides,
    });
  }

  const statementRow = (overrides = {}) => ({
    accountId: account.id,
    transactionDate: '2026-01-14',
    amount: -48.23,
    merchantRaw: 'TARGET 1234 SUNNYVALE CA',
    ...overrides,
  });

  beforeEach(async () => {
    const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [
      `recon-${Date.now()}-${Math.random()}@findo.test`,
    ]);
    userId = rows[0].id;
    account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
    otherAccount = await accountsService.createAccount(userId, { nickname: 'Other', type: 'checking', institution_name: 'Chase' });
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('findMatch', () => {
    test('no candidates -> new', async () => {
      expect(await findMatch(pool, statementRow())).toEqual({ kind: 'new' });
    });

    test('single unconfirmed exact match -> corroborate', async () => {
      const t = await seed();
      const result = await findMatch(pool, statementRow());
      expect(result.kind).toBe('corroborate');
      expect(result.candidate.id).toBe(t.id);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    test('single confirmed exact match -> duplicate', async () => {
      const t = await seed({ reconciliationStatus: 'confirmed' });
      const result = await findMatch(pool, statementRow());
      expect(result.kind).toBe('duplicate');
      expect(result.candidate.id).toBe(t.id);
    });

    test('a different account is not searched', async () => {
      await seed();
      expect((await findMatch(pool, statementRow({ accountId: otherAccount.id }))).kind).toBe('new');
    });

    test('window boundary: 5 days apart still searched, 6 days apart is not', async () => {
      await seed({ transactionDate: '2026-01-09' }); // 5 days before 2026-01-14
      expect((await findMatch(pool, statementRow())).kind).toBe('corroborate'); // date 0 + merchant 1 = 0.6, meets threshold
      expect((await findMatch(pool, statementRow({ transactionDate: '2026-01-15' }))).kind).toBe('new'); // 6 days
    });

    test('two exact matches -> ambiguous', async () => {
      await seed();
      await seed({ transactionDate: '2026-01-13' });
      const result = await findMatch(pool, statementRow());
      expect(result.kind).toBe('ambiguous');
      expect(result.candidates).toHaveLength(2);
    });

    test('excludeIds removes an already-claimed candidate', async () => {
      const first = await seed();
      const second = await seed({ transactionDate: '2026-01-13' });
      const result = await findMatch(pool, statementRow({ excludeIds: [first.id] }));
      expect(result.kind).toBe('corroborate');
      expect(result.candidate.id).toBe(second.id);
    });

    test('same amount but unrelated merchant is not a match', async () => {
      await seed({ merchantRaw: 'Shell Oil' });
      expect((await findMatch(pool, statementRow())).kind).toBe('new');
    });

    test('tip-sized amount difference on an unconfirmed receipt -> possible with signed difference', async () => {
      const t = await seed({ amount: 42 });
      const result = await findMatch(pool, statementRow({ amount: -50.4 }));
      expect(result.kind).toBe('possible');
      expect(result.candidate.id).toBe(t.id);
      expect(result.difference).toBeCloseTo(-8.4);
    });

    test('statement lower than the receipt is not a possible match', async () => {
      await seed({ amount: 42 });
      expect((await findMatch(pool, statementRow({ amount: -40 }))).kind).toBe('new');
    });

    test('statement more than 1.4x the receipt is not a possible match', async () => {
      await seed({ amount: 42 });
      expect((await findMatch(pool, statementRow({ amount: -60 }))).kind).toBe('new'); // 60 > 58.8
    });

    test('a confirmed transaction with a different amount is never a possible match', async () => {
      await seed({ amount: 42, reconciliationStatus: 'confirmed' });
      expect((await findMatch(pool, statementRow({ amount: -50.4 }))).kind).toBe('new');
    });

    test('an exact-amount match wins over a possible one', async () => {
      await seed({ amount: 42 });
      const exact = await seed({ amount: 50.4, transactionDate: '2026-01-13' });
      const result = await findMatch(pool, statementRow({ amount: -50.4 }));
      expect(result.kind).toBe('corroborate');
      expect(result.candidate.id).toBe(exact.id);
    });

    test('two possible candidates -> ambiguous', async () => {
      await seed({ amount: 42 });
      await seed({ amount: 43, transactionDate: '2026-01-13' });
      expect((await findMatch(pool, statementRow({ amount: -50.4 }))).kind).toBe('ambiguous');
    });
  });

  describe('applyCorroboration', () => {
    test('confirms the row, records provenance, and leaves amount and balance alone', async () => {
      const t = await seed();
      const sharedItemId = await makeSharedItem(userId);
      const balanceBefore = await balanceOf(account.id);

      await applyCorroboration(pool, { transactionId: t.id, sharedItemId, postedDate: '2026-01-14', confidence: 0.84 });

      const { rows: [after] } = await pool.query('SELECT reconciliation_status, amount, posted_date FROM transactions WHERE id = $1', [t.id]);
      expect(after.reconciliation_status).toBe('confirmed');
      expect(Number(after.amount)).toBe(-48.23);
      expect(after.posted_date).not.toBeNull();

      const { rows: sources } = await pool.query(
        `SELECT role, matched_at, match_confidence, adjustment_reason FROM transaction_sources WHERE transaction_id = $1 AND shared_item_id = $2`,
        [t.id, sharedItemId]
      );
      expect(sources).toHaveLength(1);
      expect(sources[0].role).toBe('corroboration');
      expect(sources[0].matched_at).not.toBeNull();
      expect(Number(sources[0].match_confidence)).toBeCloseTo(0.84);
      expect(sources[0].adjustment_reason).toBeNull();
      expect(await balanceOf(account.id)).toBe(balanceBefore);
    });
  });

  describe('applyAmountCorroboration', () => {
    const args = (t, sharedItemId, overrides = {}) => ({
      transactionId: t.id, sharedItemId, postedDate: '2026-01-14', statementAmount: -50.4,
      confidence: 0.84, adjustmentReason: 'tip', adjustmentNote: null, ...overrides,
    });

    test('updates amount, keeps original_amount, adjusts the balance by the difference, tags the reason', async () => {
      const t = await seed({ amount: 42 });
      const sharedItemId = await makeSharedItem(userId);
      expect(await balanceOf(account.id)).toBe(-42);

      await applyAmountCorroboration(pool, args(t, sharedItemId));

      const { rows: [after] } = await pool.query(
        'SELECT amount, original_amount, reconciliation_status FROM transactions WHERE id = $1', [t.id]);
      expect(Number(after.amount)).toBe(-50.4);
      expect(Number(after.original_amount)).toBe(-42);
      expect(after.reconciliation_status).toBe('confirmed');
      expect(await balanceOf(account.id)).toBeCloseTo(-50.4);

      const { rows: [source] } = await pool.query(
        'SELECT role, adjustment_reason, adjustment_note FROM transaction_sources WHERE transaction_id = $1', [t.id]);
      expect(source.role).toBe('corroboration');
      expect(source.adjustment_reason).toBe('tip');
      expect(source.adjustment_note).toBeNull();
    });

    test('other requires a note; a note is stored when given', async () => {
      const t = await seed({ amount: 42 });
      const sharedItemId = await makeSharedItem(userId);
      await expect(
        applyAmountCorroboration(pool, args(t, sharedItemId, { adjustmentReason: 'other', adjustmentNote: '  ' }))
      ).rejects.toThrow(ValidationError);
      await applyAmountCorroboration(pool, args(t, sharedItemId, { adjustmentReason: 'other', adjustmentNote: 'valet parking' }));
      const { rows: [source] } = await pool.query('SELECT adjustment_note FROM transaction_sources WHERE transaction_id = $1', [t.id]);
      expect(source.adjustment_note).toBe('valet parking');
    });

    test('rejects an unknown reason without writing anything', async () => {
      const t = await seed({ amount: 42 });
      const sharedItemId = await makeSharedItem(userId);
      await expect(
        applyAmountCorroboration(pool, args(t, sharedItemId, { adjustmentReason: 'bribe' }))
      ).rejects.toThrow(ValidationError);
      expect(await balanceOf(account.id)).toBe(-42);
    });

    test('rejects a transaction that is already confirmed', async () => {
      const t = await seed({ amount: 42, reconciliationStatus: 'confirmed' });
      const sharedItemId = await makeSharedItem(userId);
      await expect(applyAmountCorroboration(pool, args(t, sharedItemId))).rejects.toThrow(ValidationError);
      expect(await balanceOf(account.id)).toBe(-42);
    });

    test('rolls back amount, balance and status together when a later write fails', async () => {
      const t = await seed({ amount: 42 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // A shared_item id that doesn't exist makes the transaction_sources INSERT fail its FK.
        await expect(
          applyAmountCorroboration(client, args(t, '00000000-0000-0000-0000-000000000000'))
        ).rejects.toThrow();
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const { rows: [after] } = await pool.query('SELECT amount, reconciliation_status FROM transactions WHERE id = $1', [t.id]);
      expect(Number(after.amount)).toBe(-42);
      expect(after.reconciliation_status).toBe('unconfirmed');
      expect(await balanceOf(account.id)).toBe(-42);
    });
  });
});
