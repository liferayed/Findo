const { pool } = require('../../src/db');
const { createAccountOfferService } = require('../../src/documents/accountOfferService');
const { ValidationError } = require('../../src/errors');

const service = createAccountOfferService({ pool, accountsService: require('../../src/accounts/accountsService').createAccountsService({ pool }), institutionsService: require('../../src/institutions/institutionsService').createInstitutionsService({ pool }) });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

async function seedNeedsClarification(userId, extractedData) {
  const { rows: [sharedItem] } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'api/uploads/statements/x.png', 'needs_clarification') RETURNING id`,
    [userId]
  );
  await pool.query(`INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`, [
    sharedItem.id, JSON.stringify(extractedData),
  ]);
  return sharedItem.id;
}

describe('account offer service (against real Postgres)', () => {
  let userId;

  beforeEach(async () => { userId = await createTestUser(`offer-${Date.now()}-${Math.random()}@findo.test`); });
  afterEach(async () => { await pool.query('DELETE FROM users WHERE id = $1', [userId]); });
  afterAll(async () => { await pool.end(); });

  test('getAccountOffer surfaces the extracted header fields, suggesting credit_card when card fields were extracted', async () => {
    const id = await seedNeedsClarification(userId, {
      institutionName: 'Chase', accountTypeText: 'Sapphire', lastFour: '9911',
      creditCard: { due_date: null, minimum_payment: null, issuer: null, credit_limit: null, apr: null },
      transactions: [], resolvedAccountId: null, accountOfferDeclined: false,
    });
    const offer = await service.getAccountOffer(userId, id);
    expect(offer).toEqual({ institutionName: 'Chase', accountTypeText: 'Sapphire', lastFour: '9911', suggestedType: 'credit_card' });
  });

  test('accept creates the account and resolves it onto extracted_data', async () => {
    const id = await seedNeedsClarification(userId, { institutionName: 'Chase', accountTypeText: null, lastFour: '9911', creditCard: null, transactions: [], resolvedAccountId: null, accountOfferDeclined: false });
    await service.resolveAccountOffer(userId, id, { accept: true, type: 'checking', nickname: 'Chase Checking' });
    const { rows: [row] } = await pool.query(`SELECT si.parse_status, d.extracted_data FROM shared_items si JOIN documents d ON d.shared_item_id = si.id WHERE si.id = $1`, [id]);
    expect(row.parse_status).toBe('parsed');
    expect(row.extracted_data.resolvedAccountId).toBeDefined();
    const { rows: [account] } = await pool.query('SELECT * FROM accounts WHERE id = $1', [row.extracted_data.resolvedAccountId]);
    expect(account.last_four).toBe('9911');
  });

  // F1.7 final review I3: declining used to write accountOfferDeclined:true and flip
  // parse_status to 'parsed', which getStatementStatus then reported as ready_for_review — but
  // /review and /confirm-review both correctly reject a statement with no resolvedAccountId,
  // leaving no way forward. Until a per-row account picker exists, decline is rejected outright
  // instead of being written as a dead end.
  test('decline is rejected — not yet supported — and leaves the statement untouched', async () => {
    const id = await seedNeedsClarification(userId, { institutionName: 'Chase', accountTypeText: null, lastFour: '9911', creditCard: null, transactions: [], resolvedAccountId: null, accountOfferDeclined: false });
    await expect(service.resolveAccountOffer(userId, id, { accept: false })).rejects.toThrow(ValidationError);

    const { rows: [row] } = await pool.query(`SELECT si.parse_status, d.extracted_data FROM documents d JOIN shared_items si ON si.id = d.shared_item_id WHERE si.id = $1`, [id]);
    expect(row.parse_status).toBe('needs_clarification'); // still pending, not stuck in a dead end
    expect(row.extracted_data.accountOfferDeclined).toBe(false);
    expect(row.extracted_data.resolvedAccountId).toBeNull();
  });

  test('getAccountOffer rejects when the statement is not in needs_clarification', async () => {
    const id = await seedNeedsClarification(userId, { institutionName: null, accountTypeText: null, lastFour: null, creditCard: null, transactions: [], resolvedAccountId: 'x', accountOfferDeclined: false });
    await pool.query(`UPDATE shared_items SET parse_status = 'parsed' WHERE id = $1`, [id]);
    await expect(service.getAccountOffer(userId, id)).rejects.toThrow(ValidationError);
  });

  // F1.7 final review I6: the accept path used to read extracted_data without a lock, create
  // the account, then write two separate non-transactional UPDATEs — two concurrent accepts (or
  // a retry after a partial failure) could each create an account, leaving an orphan. Now the
  // whole accept path is one BEGIN/COMMIT with a SELECT ... FOR UPDATE OF si, d lock and a
  // conditional final UPDATE, mirroring statementConfirmService's Task 8 concurrency fix.
  test('two genuinely concurrent accepts on the same statement never both create an account', async () => {
    for (let i = 0; i < 5; i += 1) {
      const id = await seedNeedsClarification(userId, {
        institutionName: 'Chase', accountTypeText: null, lastFour: `99${i}${i}`, creditCard: null,
        transactions: [], resolvedAccountId: null, accountOfferDeclined: false,
      });

      const results = await Promise.allSettled([
        service.resolveAccountOffer(userId, id, { accept: true, type: 'checking', nickname: `Concurrent-A-${i}` }),
        service.resolveAccountOffer(userId, id, { accept: true, type: 'checking', nickname: `Concurrent-B-${i}` }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1); // exactly one of the two settles fulfilled...
      expect(rejected).toHaveLength(1); // ...and exactly one settles rejected
      expect(rejected[0].reason).toBeInstanceOf(ValidationError);

      const { rows: accounts } = await pool.query(
        `SELECT * FROM accounts WHERE user_id = $1 AND nickname LIKE $2`, [userId, `Concurrent-%-${i}`]
      );
      expect(accounts).toHaveLength(1); // exactly one account landed, never two
    }
  });
});
