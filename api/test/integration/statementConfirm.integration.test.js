const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createStatementConfirmService } = require('../../src/documents/statementConfirmService');
const { createStatementReviewService } = require('../../src/documents/statementReviewService');
const { ValidationError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const confirmService = createStatementConfirmService({ pool, transactionsService });
const reviewService = createStatementReviewService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

async function seedReadyForReview(userId, accountId, transactions) {
  const { rows: [sharedItem] } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'parsed') RETURNING id`,
    [userId]
  );
  const extractedData = { transactions, beginningBalance: null, endingBalance: null, institutionName: null, accountTypeText: null, lastFour: null, creditCard: null, resolvedAccountId: accountId, accountOfferDeclined: false };
  await pool.query(`INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`, [sharedItem.id, JSON.stringify(extractedData)]);
  return sharedItem.id;
}

async function balanceOf(accountId) {
  const { rows } = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);
  return Number(rows[0].current_balance);
}

describe('statement confirm service (against real Postgres)', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`confirm-${Date.now()}-${Math.random()}@findo.test`);
    account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
  });
  afterEach(async () => { await pool.query('DELETE FROM users WHERE id = $1', [userId]); });
  afterAll(async () => { await pool.end(); });

  test('a new row inserts a transaction, sets origin provenance, and moves the balance', async () => {
    const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'TARGET', amount: -48.23 }]);
    await confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }]);
    const { rows: [t] } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(Number(t.amount)).toBe(-48.23);
    expect(t.is_manual).toBe(false);
    const { rows: [source] } = await pool.query('SELECT role, shared_item_id FROM transaction_sources WHERE transaction_id = $1', [t.id]);
    expect(source.role).toBe('origin');
    expect(source.shared_item_id).toBe(id);
    expect(await balanceOf(account.id)).toBe(-48.23);
  });

  test('a corroborate row is always applied even without an explicit selection entry, and does not double-count', async () => {
    const existing = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
    const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);
    await confirmService.confirmReview(userId, id, []); // no explicit selections — corroborate is implicit
    const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(all).toHaveLength(1); // no new row created
    expect(all[0].id).toBe(existing.id);
    expect(all[0].reconciliation_status).toBe('confirmed');
  });

  test('a tagged possible row updates amount, original_amount, and the balance by the exact difference', async () => {
    const existing = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 42, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
    const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -50.4 }]);
    await confirmService.confirmReview(userId, id, [{ index: 0, action: 'tag', adjustmentReason: 'tip' }]);
    const { rows: [t] } = await pool.query('SELECT amount, original_amount FROM transactions WHERE id = $1', [existing.id]);
    expect(Number(t.amount)).toBe(-50.4);
    expect(Number(t.original_amount)).toBe(-42);
    const balanceText = (await pool.query('SELECT current_balance::text FROM accounts WHERE id = $1', [account.id])).rows[0].current_balance;
    expect(balanceText).toBe('-50.4');
  });

  test('a tag of other without a note is rejected and rolls back the whole batch', async () => {
    await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 42, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
    const id = await seedReadyForReview(userId, account.id, [
      { date: '2026-01-14', description: 'Target', amount: -50.4 },
      { date: '2026-01-15', description: 'New Merchant', amount: -10 },
    ]);
    await expect(
      confirmService.confirmReview(userId, id, [{ index: 0, action: 'tag', adjustmentReason: 'other' }, { index: 1, action: 'new' }])
    ).rejects.toThrow(ValidationError);
    const { rows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(rows).toHaveLength(1); // only the pre-existing unconfirmed one — the batch's new row never committed
  });

  test('force-creating over a flagged duplicate records overridden_candidate_id', async () => {
    const existing = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'confirmed' });
    const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);
    await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]);
    const { rows: newRows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1 AND id != $2', [account.id, existing.id]);
    expect(newRows).toHaveLength(1);
    const { rows: [source] } = await pool.query('SELECT overridden_candidate_id FROM transaction_sources WHERE transaction_id = $1', [newRows[0].id]);
    expect(source.overridden_candidate_id).toBe(existing.id);
  });

  test('two identical rows do not both claim the same corroboration candidate', async () => {
    const existing = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
    const id = await seedReadyForReview(userId, account.id, [
      { date: '2026-01-14', description: 'Target', amount: -48.23 },
      { date: '2026-01-14', description: 'Target', amount: -48.23 },
    ]);
    await confirmService.confirmReview(userId, id, [{ index: 1, action: 'new' }]); // row 0 implicit corroborate; row 1 explicitly new
    const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(all).toHaveLength(2); // the pre-existing (now confirmed) + one genuinely new row
    expect(all.filter((t) => t.id === existing.id)).toHaveLength(1);
  });

  test('a card statement also upserts credit_card_details as part of the same confirm', async () => {
    const card = await accountsService.createAccount(userId, { nickname: 'Sapphire', type: 'credit_card', institution_name: 'Chase' });
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'parsed') RETURNING id`, [userId]
    );
    const extractedData = { transactions: [], beginningBalance: null, endingBalance: null, institutionName: null, accountTypeText: null, lastFour: null, creditCard: { due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null }, resolvedAccountId: card.id, accountOfferDeclined: false };
    await pool.query(`INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'card_statement', $2)`, [sharedItem.id, JSON.stringify(extractedData)]);

    await confirmService.confirmReview(userId, sharedItem.id, []);
    const { rows: [details] } = await pool.query('SELECT minimum_payment FROM credit_card_details WHERE account_id = $1', [card.id]);
    expect(Number(details.minimum_payment)).toBe(35);
  });

  // --- Fix 1: replay/double-confirm must be rejected, not double-write ---
  test('confirming an already-confirmed statement is rejected and does not double-insert or double-move the balance', async () => {
    const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'TARGET', amount: -48.23 }]);
    await confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }]);

    await expect(
      confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }])
    ).rejects.toThrow(ValidationError);

    const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(all).toHaveLength(1); // still exactly one transaction, not two
    expect(await balanceOf(account.id)).toBe(-48.23); // balance reflects only the first confirm
  });

  // --- Fix 2: selection.action must be validated against the row's actual match kind ---
  describe('action validation against match kind', () => {
    test("action 'tag' on a row with no candidate (new) is rejected, not an unhandled crash", async () => {
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Brand New Merchant', amount: -10 }]);
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'tag', adjustmentReason: 'tip' }])
      ).rejects.toThrow(ValidationError);
      const { rows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(rows).toHaveLength(0); // rolled back, nothing written
    });

    test("action 'new' on a row that is actually a duplicate is rejected", async () => {
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'confirmed' });
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }])
      ).rejects.toThrow(ValidationError);
      const { rows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(rows).toHaveLength(1); // only the pre-existing duplicate candidate — no second row inserted
    });

    test("action 'force' on a row that is actually new (no match at all) is rejected", async () => {
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Brand New Merchant', amount: -10 }]);
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }])
      ).rejects.toThrow(ValidationError);
      const { rows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(rows).toHaveLength(0);
    });

    test("action 'force' on a genuinely ambiguous row succeeds and leaves overridden_candidate_id NULL (multiple candidates, not one to blame)", async () => {
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-13', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);

      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]);

      const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(all).toHaveLength(3); // the two original ambiguous candidates + one newly-inserted row
      const inserted = all.filter((t) => t.reconciliation_status === 'confirmed'); // the two originals stayed unconfirmed
      expect(inserted).toHaveLength(1);
      const { rows: [source] } = await pool.query('SELECT overridden_candidate_id FROM transaction_sources WHERE transaction_id = $1', [inserted[0].id]);
      // Intentional, not a silent bug: ambiguous means multiple candidates, so there is no
      // single one to record as "overridden" — asserted explicitly here per the fix's design.
      expect(source.overridden_candidate_id).toBeNull();
    });

    test("an unrecognized action string is rejected with a clean ValidationError, not a 500", async () => {
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Brand New Merchant', amount: -10 }]);
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'bogus' }])
      ).rejects.toThrow(ValidationError);
    });
  });

  // --- Fix 3: excludeIds must accumulate for duplicate/possible rows too, mirroring statementReviewService ---
  test('a candidate already claimed as a possible match for an earlier row is excluded, and the later row ends up new instead of auto-corroborating (matches what buildReview would show)', async () => {
    const existing = await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-12', amount: 42, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed',
    });
    const transactions = [
      { date: '2026-01-14', description: 'Target', amount: -50.4 }, // 'possible' vs existing (42 -> 50.4, within adjustment range), left unselected
      { date: '2026-01-14', description: 'Target', amount: -42 }, // would exactly match existing (-> 'corroborate') if existing weren't already claimed by row 0
    ];
    const id = await seedReadyForReview(userId, account.id, transactions);

    // Sanity-check against the review service: with excludeIds accumulating correctly,
    // row 0 is 'possible' against existing and row 1 is 'new' (existing already claimed).
    const review = await reviewService.buildReview(userId, id);
    expect(review.rows[0].kind).toBe('possible');
    expect(review.rows[0].candidate.id).toBe(existing.id);
    expect(review.rows[1].kind).toBe('new');

    // Leave row 0 untagged/unselected and don't select row 1 either — if confirm's excludeIds
    // does not mirror the review's, row 1 would silently auto-corroborate against `existing`.
    await confirmService.confirmReview(userId, id, []);

    const { rows: [after] } = await pool.query('SELECT reconciliation_status FROM transactions WHERE id = $1', [existing.id]);
    expect(after.reconciliation_status).toBe('unconfirmed'); // NOT auto-corroborated by row 1
    const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
    expect(all).toHaveLength(1); // no new row inserted either — both rows were left unselected
  });
});
