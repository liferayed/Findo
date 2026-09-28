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

  // F1.7 final review I4: buildReview used to compare the CURRENT reconstructed balance
  // (before this statement's own new rows are inserted) against the statement's endingBalance
  // (which assumes those rows WILL be recorded) — so any statement with a genuinely new
  // transaction showed a false gap equal to that row's own amount. Opening/current 100, one new
  // row of -48.23, and an endingBalance of 51.77 (100 - 48.23) is exactly that scenario: it must
  // report null, not a false 48.23 gap.
  test('balanceMismatch is null when the statement ending balance correctly accounts for a genuinely new row', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    const id = await seedReadyForReview(userId, account.id, { endingBalance: 51.77 }); // default transactions: one new row of -48.23
    const review = await service.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('new');
    expect(review.balanceMismatch).toBeNull();
  });

  // Same setup, but the statement's endingBalance is off by a genuine amount X (10) beyond what
  // the new row itself accounts for — the new formula must still surface exactly that gap.
  test('balanceMismatch still reports a genuine gap on top of a new row\'s own amount', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    const id = await seedReadyForReview(userId, account.id, { endingBalance: 41.77 }); // 10 off from the correct 51.77
    const review = await service.buildReview(userId, id);
    expect(review.balanceMismatch).not.toBeNull();
    expect(review.balanceMismatch.gap).toBeCloseTo(10);
    // F1.7 final review M2: reconstructedBalance must be the same (adjusted) value gap was
    // actually computed from, so the three returned numbers stay arithmetically consistent for
    // any caller displaying them together — this has a genuine gap AND a new row, exactly the
    // case that used to make the two disagree.
    expect(review.balanceMismatch.reconstructedBalance - review.balanceMismatch.statementEndingBalance)
      .toBeCloseTo(review.balanceMismatch.gap);
  });

  test('balanceMismatch reports a gap when they differ', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    const id = await seedReadyForReview(userId, account.id, { endingBalance: 37.54, transactions: [] });
    const review = await service.buildReview(userId, id);
    expect(review.balanceMismatch).not.toBeNull();
    expect(review.balanceMismatch.gap).toBeCloseTo(62.46);
  });

  // An unresolved 'possible' row's difference (statement amount vs. the near-matched existing
  // transaction's amount) must be folded into the mismatch too — the user hasn't confirmed
  // either the match or the amount discrepancy yet, so the reconstructed balance doesn't
  // account for it.
  test('balanceMismatch includes an unresolved possible row\'s difference', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    // An existing unconfirmed transaction close in date/amount to the statement row, but not an
    // exact amount match, classifies as 'possible' rather than 'corroborate'. It's dated before
    // the statement period, so it's already part of the reconstructed ledger balance
    // (reconstructed = opening 100 + (-45) = 55); the statement row's difference (-3.23) is the
    // part not yet reflected anywhere, so it must be folded into the mismatch on top of that.
    await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-10', amount: 45, merchantRaw: 'Target #1234', type: 'debit', reconciliationStatus: 'unconfirmed',
    });
    const id = await seedReadyForReview(userId, account.id, {
      transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      endingBalance: 51.77, // opening(100) + this statement row's own amount(-48.23) — correctly accounts for it
    });
    const review = await service.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('possible');
    expect(review.rows[0].difference).toBeCloseTo(-3.23);
    expect(review.balanceMismatch).toBeNull();
  });

  test('balanceMismatch surfaces a genuine gap on top of an unresolved possible row\'s difference', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 100, current_balance = 100 WHERE id = $1', [account.id]);
    await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-10', amount: 45, merchantRaw: 'Target #1234', type: 'debit', reconciliationStatus: 'unconfirmed',
    });
    const id = await seedReadyForReview(userId, account.id, {
      transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      endingBalance: 41.77, // 10 off from the correct 51.77
    });
    const review = await service.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('possible');
    expect(review.balanceMismatch).not.toBeNull();
    expect(review.balanceMismatch.gap).toBeCloseTo(10);
    // F1.7 final review M2: same consistency check, this time with a 'possible' row's difference
    // folded into the adjustment instead of a 'new' row's amount.
    expect(review.balanceMismatch.reconstructedBalance - review.balanceMismatch.statementEndingBalance)
      .toBeCloseTo(review.balanceMismatch.gap);
  });

  // F1.7 final review I3 (Task 7 Minor): loadReadyRow used to throw one generic
  // "this statement is not ready for review" message whether parse_status was wrong or
  // resolvedAccountId was missing — too coarse to tell apart a statement that's still
  // processing/needs_clarification/failed from one that's 'parsed' but has no resolved account
  // (e.g. a not-yet-supported decline). Now two distinct messages.
  test('rejects with a wrong-parse_status-specific message when parse_status is not parsed', async () => {
    const id = await seedReadyForReview(userId, account.id);
    await pool.query(`UPDATE shared_items SET parse_status = 'needs_clarification' WHERE id = $1`, [id]);
    await expect(service.buildReview(userId, id)).rejects.toThrow(ValidationError);
    try {
      await service.buildReview(userId, id);
      throw new Error('expected buildReview to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors[0]).toMatch(/parse_status|not parsed|not ready for review/i);
    }
  });

  test('rejects with a resolvedAccountId-specific message when parsed but no account was resolved', async () => {
    const id = await seedReadyForReview(userId, account.id, { resolvedAccountId: null, accountOfferDeclined: true });
    await expect(service.buildReview(userId, id)).rejects.toThrow(ValidationError);
    try {
      await service.buildReview(userId, id);
      throw new Error('expected buildReview to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors[0]).toMatch(/account/i);
    }
  });

  test('the two error messages are distinct from each other', async () => {
    const wrongStatusId = await seedReadyForReview(userId, account.id);
    await pool.query(`UPDATE shared_items SET parse_status = 'needs_clarification' WHERE id = $1`, [wrongStatusId]);
    const noAccountId = await seedReadyForReview(userId, account.id, { resolvedAccountId: null, accountOfferDeclined: true });

    let wrongStatusMessage;
    let noAccountMessage;
    try { await service.buildReview(userId, wrongStatusId); } catch (err) { wrongStatusMessage = err.errors[0]; }
    try { await service.buildReview(userId, noAccountId); } catch (err) { noAccountMessage = err.errors[0]; }

    expect(wrongStatusMessage).toBeDefined();
    expect(noAccountMessage).toBeDefined();
    expect(wrongStatusMessage).not.toBe(noAccountMessage);
  });
});
