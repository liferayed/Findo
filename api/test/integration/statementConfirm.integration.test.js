const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createStatementConfirmService } = require('../../src/documents/statementConfirmService');
const { createStatementReviewService } = require('../../src/documents/statementReviewService');
const { ValidationError, NotFoundError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const confirmService = createStatementConfirmService({ pool, transactionsService });
const reviewService = createStatementReviewService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

// F1.7 gap-fix Task 5: a declined statement needs resolvedAccountId: null and
// accountOfferDeclined: true, plus optionally a creditCard block — none of which the plain
// array form below can express. transactionsOrOptions stays an array for every pre-existing
// call (identical extractedData shape as before) or an options object for the new tests.
async function seedReadyForReview(userId, accountId, transactionsOrOptions) {
  const options = Array.isArray(transactionsOrOptions) ? { transactions: transactionsOrOptions } : transactionsOrOptions;
  const {
    transactions,
    resolvedAccountId = accountId,
    accountOfferDeclined = false,
    creditCard = null,
  } = options;
  const { rows: [sharedItem] } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'parsed') RETURNING id`,
    [userId]
  );
  const extractedData = { transactions, beginningBalance: null, endingBalance: null, institutionName: null, accountTypeText: null, lastFour: null, creditCard, resolvedAccountId, accountOfferDeclined };
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

  // F1.7 final review I1: document_type is always 'bank_statement' at upload time in
  // production — the upsert must not depend on it. It must be keyed on the RESOLVED
  // ACCOUNT's actual type instead, which is known by confirm time regardless of document_type.
  test('a credit-card upsert runs when the resolved account is a credit_card, even though document_type is bank_statement (as it always is in production)', async () => {
    const card = await accountsService.createAccount(userId, { nickname: 'Sapphire', type: 'credit_card', institution_name: 'Chase' });
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'parsed') RETURNING id`, [userId]
    );
    const extractedData = { transactions: [], beginningBalance: null, endingBalance: null, institutionName: null, accountTypeText: null, lastFour: null, creditCard: { due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null }, resolvedAccountId: card.id, accountOfferDeclined: false };
    // document_type deliberately left as 'bank_statement' — proving the fix no longer depends on it.
    await pool.query(`INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`, [sharedItem.id, JSON.stringify(extractedData)]);

    await confirmService.confirmReview(userId, sharedItem.id, []);
    const { rows: [details] } = await pool.query('SELECT minimum_payment FROM credit_card_details WHERE account_id = $1', [card.id]);
    expect(Number(details.minimum_payment)).toBe(35);
  });

  test('a checking account never attempts the credit-card upsert, even if extracted_data.creditCard has real fields', async () => {
    const id = await seedReadyForReview(userId, account.id, []);
    await pool.query(
      `UPDATE documents SET extracted_data = jsonb_set(extracted_data, '{creditCard}', $1) WHERE shared_item_id = $2`,
      [JSON.stringify({ due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null }), id]
    );

    await confirmService.confirmReview(userId, id, []);
    const { rows: details } = await pool.query('SELECT 1 FROM credit_card_details WHERE account_id = $1', [account.id]);
    expect(details).toHaveLength(0);
  });

  // --- Round 2, Finding 1: two truly concurrent confirms on the SAME statement must not both
  // land a write. loadReadyRow's lock has to cover documents (d), not just shared_items (si) —
  // otherwise the second call, once unblocked, still reads the pre-confirm extracted_data
  // snapshot and passes the replay guard. Looped several times since lock-acquisition order
  // between the two connections is not fixed run to run.
  test('two genuinely concurrent force-confirms on the same statement never both insert (documents row must be locked too)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const iterAccount = await accountsService.createAccount(userId, { nickname: `Concurrent-${i}`, type: 'checking', institution_name: 'Chase' });
      const existing = await transactionsService.createTransactionFromChat(userId, {
        accountId: iterAccount.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'confirmed',
      });
      const id = await seedReadyForReview(userId, iterAccount.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);

      // confirmReview opens its own client internally (pool.connect()), so two real,
      // independently-connected transactions race here — this is the race2.js probe as a
      // real repo test, not a throwaway script.
      const results = await Promise.allSettled([
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]),
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1); // exactly one of the two settles fulfilled...
      expect(rejected).toHaveLength(1); // ...and exactly one settles rejected
      expect(rejected[0].reason).toBeInstanceOf(ValidationError);

      const { rows: newRows } = await pool.query(
        'SELECT * FROM transactions WHERE account_id = $1 AND id != $2', [iterAccount.id, existing.id]
      );
      expect(newRows).toHaveLength(1); // exactly one forced transaction landed, never two
    }
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

    test("action 'force' on a genuinely ambiguous row succeeds and records the highest-confidence tied candidate as overridden_candidate_id (a lead to trace, not a certain match)", async () => {
      const olderCandidate = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-13', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const closerCandidate = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-14', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const id = await seedReadyForReview(userId, account.id, [{ date: '2026-01-14', description: 'Target', amount: -48.23 }]);

      // Sanity-check against the review service which of the two tied candidates scores highest
      // (same date as the statement row should score at least as high as the one a day off).
      const review = await reviewService.buildReview(userId, id);
      expect(review.rows[0].kind).toBe('ambiguous');
      const sorted = review.rows[0].candidates.slice().sort((a, b) => b.confidence - a.confidence);
      const expectedRecordedId = sorted[0].candidate.id;
      expect(expectedRecordedId).toBe(closerCandidate.id);

      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]);

      const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(all).toHaveLength(3); // the two original ambiguous candidates + one newly-inserted row
      const inserted = all.filter((t) => t.reconciliation_status === 'confirmed'); // the two originals stayed unconfirmed
      expect(inserted).toHaveLength(1);
      const { rows: [source] } = await pool.query('SELECT overridden_candidate_id FROM transaction_sources WHERE transaction_id = $1', [inserted[0].id]);
      // Not lossy: ambiguous means multiple tied candidates, so the highest-confidence one is
      // recorded so a later discrepancy has a lead to trace, even though it isn't a certain match.
      expect(source.overridden_candidate_id).toBe(expectedRecordedId);
      expect(source.overridden_candidate_id).not.toBeNull();
      expect([olderCandidate.id, closerCandidate.id]).toContain(source.overridden_candidate_id);
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

  // --- Round 2, Finding 2: excludeIds must also cover this batch's OWN just-inserted rows and
  // the force branch's overridden candidate, mirroring statementReviewService.buildReview.
  describe('excludeIds must not let a batch self-match its own inserts', () => {
    test('scenario A: two genuinely separate but identical rows in one statement both insert as new, without row 1 falsely matching row 0\'s own just-inserted transaction', async () => {
      const id = await seedReadyForReview(userId, account.id, [
        { date: '2026-01-14', description: 'Corner Coffee', amount: -5 },
        { date: '2026-01-14', description: 'Corner Coffee', amount: -5 },
      ]);

      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }, { index: 1, action: 'new' }]);

      const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(all).toHaveLength(2); // two separate transactions, not a rejected batch
      expect(await balanceOf(account.id)).toBe(-10);
    });

    test('scenario B: force over a duplicate excludes both the overridden candidate AND the newly-forced row, so a third identical row correctly classifies as new instead of re-matching either', async () => {
      const existing = await transactionsService.createTransactionFromChat(userId, {
        accountId: account.id, transactionDate: '2026-01-12', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'confirmed',
      });
      const id = await seedReadyForReview(userId, account.id, [
        { date: '2026-01-14', description: 'Target', amount: -48.23 }, // duplicate vs `existing`, forced
        { date: '2026-01-14', description: 'Target', amount: -48.23 }, // identical row — must end up genuinely new
      ]);

      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }, { index: 1, action: 'new' }]);

      const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      expect(all).toHaveLength(3); // original + row 0's forced insert + row 1's new insert

      const { rows: [forcedSource] } = await pool.query(
        `SELECT ts.transaction_id, ts.overridden_candidate_id FROM transaction_sources ts
         JOIN transactions t ON t.id = ts.transaction_id
         WHERE ts.shared_item_id = $1 AND ts.overridden_candidate_id IS NOT NULL`,
        [id]
      );
      expect(forcedSource.overridden_candidate_id).toBe(existing.id);

      const newlyInsertedIds = all.filter((t) => t.id !== existing.id).map((t) => t.id);
      expect(newlyInsertedIds).toHaveLength(2);
      expect(newlyInsertedIds).not.toContain(existing.id);
    });
  });

  // --- Round 3: forcing an ambiguous row must NOT exclude its tied candidates from later rows
  // in the same batch. buildReview never excludes ambiguous candidates at all (only
  // corroborate/duplicate/possible) — so confirm pushing every tied candidate into excludeIds
  // diverges from what review showed the user, with real consequences for later rows.
  describe('Round 3: force on an ambiguous row must not exclude its tied candidates for later rows', () => {
    test('two rows both ambiguous against the same overlapping {A,B} set: forcing BOTH must succeed (not reject the batch) and leave A and B untouched', async () => {
      const olderCandidate = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-13', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const closerCandidate = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-14', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const id = await seedReadyForReview(userId, account.id, [
        { date: '2026-01-14', description: 'Target', amount: -48.23 },
        { date: '2026-01-14', description: 'Target', amount: -48.23 },
      ]);

      // Sanity-check against buildReview: both rows are genuinely ambiguous against {A,B}.
      const review = await reviewService.buildReview(userId, id);
      expect(review.rows[0].kind).toBe('ambiguous');
      expect(review.rows[1].kind).toBe('ambiguous');

      // With the bug, row 0's force wrongly excludes BOTH A and B, so row 1 (re-run through
      // findMatch with those ids excluded) sees no candidates at all -> kind 'new' -> the
      // force action on it is rejected -> the whole batch rolls back.
      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }, { index: 1, action: 'force' }]);

      const { rows: newRows } = await pool.query(
        'SELECT * FROM transactions WHERE account_id = $1 AND id NOT IN ($2, $3)',
        [account.id, olderCandidate.id, closerCandidate.id]
      );
      expect(newRows).toHaveLength(2); // both forced rows landed — the batch was not wrongly rejected

      const { rows: sources } = await pool.query(
        'SELECT overridden_candidate_id FROM transaction_sources WHERE transaction_id = ANY($1::uuid[])',
        [newRows.map((t) => t.id)]
      );
      expect(sources).toHaveLength(2);
      // Same statement date for both rows -> same candidate set -> same highest-confidence id
      // (closerCandidate, same-day) recorded for both, from each row's own original candidate set.
      for (const source of sources) {
        expect(source.overridden_candidate_id).toBe(closerCandidate.id);
      }

      const { rows: [afterOlder] } = await pool.query('SELECT reconciliation_status FROM transactions WHERE id = $1', [olderCandidate.id]);
      const { rows: [afterCloser] } = await pool.query('SELECT reconciliation_status FROM transactions WHERE id = $1', [closerCandidate.id]);
      expect(afterOlder.reconciliation_status).toBe('unconfirmed'); // untouched, not accidentally corroborated
      expect(afterCloser.reconciliation_status).toBe('unconfirmed');
    });

    test('partial candidate overlap {A,B} vs {B,C}: forcing row 0 only must not silently auto-corroborate C via row 1', async () => {
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-01', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-07', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const candidateC = await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-13', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const id = await seedReadyForReview(userId, account.id, [
        { date: '2026-01-04', description: 'Target', amount: -48.23 }, // ambiguous vs {A,B} (both within ±5 days)
        { date: '2026-01-10', description: 'Target', amount: -48.23 }, // ambiguous vs {B,C} (A is 9 days away — out of window)
      ]);

      const review = await reviewService.buildReview(userId, id);
      expect(review.rows[0].kind).toBe('ambiguous');
      expect(review.rows[1].kind).toBe('ambiguous');

      // Force row 0 only; leave row 1 with no selection entry at all. With the bug, row 0's
      // force wrongly excludes B, so row 1's own findMatch call only sees C — a single
      // candidate — which reclassifies as 'corroborate' and is applied unconditionally
      // (the corroborate branch runs even with no selection), silently confirming C.
      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }]);

      const { rows: [afterC] } = await pool.query('SELECT reconciliation_status FROM transactions WHERE id = $1', [candidateC.id]);
      expect(afterC.reconciliation_status).toBe('unconfirmed'); // NOT silently auto-corroborated by row 1
    });

    test('same partial-overlap setup, forcing BOTH rows: exactly 5 transactions exist (3 originals + 2 forced inserts), balance reflects both', async () => {
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-01', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-07', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      await transactionsService.createTransactionFromChat(userId, { accountId: account.id, transactionDate: '2026-01-13', amount: 48.23, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed' });
      const id = await seedReadyForReview(userId, account.id, [
        { date: '2026-01-04', description: 'Target', amount: -48.23 },
        { date: '2026-01-10', description: 'Target', amount: -48.23 },
      ]);

      const balanceBefore = await balanceOf(account.id);

      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'force' }, { index: 1, action: 'force' }]);

      const { rows: all } = await pool.query('SELECT * FROM transactions WHERE account_id = $1', [account.id]);
      // 3 pre-existing candidates (unchanged) + 2 newly-forced inserts — neither forced insert
      // was silently dropped by a mid-batch rejection or a mis-classification.
      expect(all).toHaveLength(5);
      expect(await balanceOf(account.id)).toBeCloseTo(balanceBefore - 96.46, 5);
    });
  });

  // F1.7 gap fix Task 5: a declined offer has no single resolved account, so confirm has to
  // skip findMatch/excludeIds entirely and insert each checked row on whichever account the
  // user picked for it in bulk-review, with the credit-card upsert only when every row agreed.
  describe('a declined account offer: per-row accounts, no matching', () => {
    test('a declined statement inserts each checked row on its own selected account, with no matching', async () => {
      const accountA = await accountsService.createAccount(userId, { nickname: 'New Checking', type: 'checking', institution_name: 'Chase' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [
          { date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 },
          { date: '2026-01-15', description: 'SHELL OIL', amount: -30 },
        ],
      });
      await confirmService.confirmReview(userId, id, [
        { index: 0, action: 'new', accountId: accountA.id },
        { index: 1, action: 'new', accountId: accountA.id },
      ]);
      const { rows } = await pool.query('SELECT * FROM transactions WHERE account_id = $1 ORDER BY transaction_date', [accountA.id]);
      expect(rows).toHaveLength(2);
      expect(rows.every((t) => t.reconciliation_status === 'confirmed' && t.is_manual === false)).toBe(true);
    });

    test('a checked row on a declined statement with no accountId is rejected, rolling back the whole batch', async () => {
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      });
      await expect(confirmService.confirmReview(userId, id, [{ index: 0, action: 'new' }])).rejects.toThrow(ValidationError);
      // Scoped to this batch's own shared_item_id rather than the whole transactions table —
      // this environment's shared Postgres carries unrelated pre-existing seed rows, so an
      // unfiltered count would false-fail on rows this test never touched.
      const { rowCount } = await pool.query('SELECT 1 FROM transaction_sources WHERE shared_item_id = $1', [id]);
      expect(rowCount).toBe(0);
    });

    test('credit-card details upsert when every checked row on a declined statement used the same credit_card account', async () => {
      const card = await accountsService.createAccount(userId, { nickname: 'New Card', type: 'credit_card', institution_name: 'Chase' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
        creditCard: { due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null },
      });
      await confirmService.confirmReview(userId, id, [{ index: 0, action: 'new', accountId: card.id }]);
      const { rows: [details] } = await pool.query('SELECT minimum_payment FROM credit_card_details WHERE account_id = $1', [card.id]);
      expect(Number(details.minimum_payment)).toBe(35);
    });

    test('credit-card details upsert is skipped when checked rows on a declined statement use different accounts', async () => {
      const cardA = await accountsService.createAccount(userId, { nickname: 'Card A', type: 'credit_card', institution_name: 'Chase' });
      const cardB = await accountsService.createAccount(userId, { nickname: 'Card B', type: 'credit_card', institution_name: 'Amex' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [
          { date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 },
          { date: '2026-01-15', description: 'SHELL OIL', amount: -30 },
        ],
        creditCard: { due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null },
      });
      await confirmService.confirmReview(userId, id, [
        { index: 0, action: 'new', accountId: cardA.id },
        { index: 1, action: 'new', accountId: cardB.id },
      ]);
      const { rowCount } = await pool.query('SELECT 1 FROM credit_card_details WHERE account_id IN ($1, $2)', [cardA.id, cardB.id]);
      expect(rowCount).toBe(0);
    });

    test('a non-new action on a declined statement is rejected, rolling back the whole batch', async () => {
      const accountA = await accountsService.createAccount(userId, { nickname: 'New Checking', type: 'checking', institution_name: 'Chase' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      });
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'force', accountId: accountA.id }])
      ).rejects.toThrow(ValidationError);
      const { rowCount } = await pool.query('SELECT 1 FROM transaction_sources WHERE shared_item_id = $1', [id]);
      expect(rowCount).toBe(0);
    });

    test('a later invalid row rolls back an earlier valid row on the same declined statement, including its balance change', async () => {
      const accountA = await accountsService.createAccount(userId, { nickname: 'New Checking', type: 'checking', institution_name: 'Chase' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [
          { date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 },
          { date: '2026-01-15', description: 'SHELL OIL', amount: -30 },
        ],
      });
      const balanceBefore = await balanceOf(accountA.id);
      await expect(
        confirmService.confirmReview(userId, id, [
          { index: 0, action: 'new', accountId: accountA.id },
          { index: 1, action: 'new' }, // no accountId — invalid, should roll back row 0 too
        ])
      ).rejects.toThrow(ValidationError);
      const { rowCount } = await pool.query('SELECT 1 FROM transaction_sources WHERE shared_item_id = $1', [id]);
      expect(rowCount).toBe(0);
      expect(await balanceOf(accountA.id)).toBe(balanceBefore);
    });

    test('an accountId belonging to a different user is rejected and rolls back', async () => {
      const otherUserId = await createTestUser(`confirm-other-${Date.now()}-${Math.random()}@findo.test`);
      const otherAccount = await accountsService.createAccount(otherUserId, { nickname: 'Other Checking', type: 'checking', institution_name: 'Chase' });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      });
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'new', accountId: otherAccount.id }])
      ).rejects.toThrow(NotFoundError);
      const { rowCount } = await pool.query('SELECT 1 FROM transaction_sources WHERE shared_item_id = $1', [id]);
      expect(rowCount).toBe(0);
      await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
    });

    test('an accountId belonging to this user but inactive is rejected and rolls back', async () => {
      const inactiveAccount = await accountsService.createAccount(userId, { nickname: 'Old Checking', type: 'checking', institution_name: 'Chase' });
      await accountsService.updateAccount(userId, inactiveAccount.id, { is_active: false });
      const id = await seedReadyForReview(userId, null, {
        resolvedAccountId: null, accountOfferDeclined: true,
        transactions: [{ date: '2026-01-14', description: 'TARGET 1234', amount: -48.23 }],
      });
      await expect(
        confirmService.confirmReview(userId, id, [{ index: 0, action: 'new', accountId: inactiveAccount.id }])
      ).rejects.toThrow(NotFoundError);
      const { rowCount } = await pool.query('SELECT 1 FROM transaction_sources WHERE shared_item_id = $1', [id]);
      expect(rowCount).toBe(0);
    });
  });
});
