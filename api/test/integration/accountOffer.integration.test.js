const { pool } = require('../../src/db');
const { createAccountOfferService } = require('../../src/documents/accountOfferService');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createInstitutionsService } = require('../../src/institutions/institutionsService');
const { ValidationError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const institutionsService = createInstitutionsService({ pool });
const service = createAccountOfferService({ pool, accountsService, institutionsService });

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

  // F1.7 final review I1: after normalizeCreditCardFields collapses an all-null credit_card
  // object to a plain null (validateStatementExtraction.js), suggestedType's truthiness check
  // on data.creditCard becomes reliable — a checking statement whose credit_card key was
  // extracted but empty now correctly suggests nothing, rather than 'credit_card'.
  test('getAccountOffer suggests nothing when extracted_data.creditCard is null (the normalized "nothing real extracted" case)', async () => {
    const id = await seedNeedsClarification(userId, {
      institutionName: 'Chase', accountTypeText: 'Total Checking', lastFour: '9911',
      creditCard: null,
      transactions: [], resolvedAccountId: null, accountOfferDeclined: false,
    });
    const offer = await service.getAccountOffer(userId, id);
    expect(offer.suggestedType).toBeNull();
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

  test('decline marks accountOfferDeclined without creating an account, and parse_status becomes parsed', async () => {
    const id = await seedNeedsClarification(userId, { institutionName: 'Chase', accountTypeText: null, lastFour: '9911', creditCard: null, transactions: [], resolvedAccountId: null, accountOfferDeclined: false });
    await service.resolveAccountOffer(userId, id, { accept: false });
    const { rows: [row] } = await pool.query(
      `SELECT si.parse_status, d.extracted_data FROM shared_items si JOIN documents d ON d.shared_item_id = si.id WHERE si.id = $1`,
      [id]
    );
    expect(row.parse_status).toBe('parsed');
    expect(row.extracted_data.accountOfferDeclined).toBe(true);
    expect(row.extracted_data.resolvedAccountId).toBeNull();
    const { rowCount } = await pool.query('SELECT 1 FROM accounts WHERE user_id = $1', [userId]);
    expect(rowCount).toBe(0);
  });

  test('a second concurrent decline on an already-resolved statement is rejected, matching the accept path\'s lock', async () => {
    const id = await seedNeedsClarification(userId, { institutionName: 'Chase', accountTypeText: null, lastFour: '9911', creditCard: null, transactions: [], resolvedAccountId: null, accountOfferDeclined: false });
    await service.resolveAccountOffer(userId, id, { accept: false });
    await expect(service.resolveAccountOffer(userId, id, { accept: false })).rejects.toThrow(ValidationError);
  });

  // F1.7 final review M1: createAccount used to write via `pool`, its own connection — separate
  // from resolveAccountOffer's `client`/transaction — so the account was committed independently
  // the instant createAccount returned, regardless of what happened afterwards. If some later
  // step in the same call then failed, the account it had just created would be left behind as
  // an orphan, not rolled back with the rest. createAccount now accepts an optional `client` and
  // resolveAccountOffer passes its own, so the INSERT runs on the same transaction and rolls
  // back with everything else. This test forces a failure right after account creation (via a
  // wrapped accountsService) and confirms no orphan account survives the rollback.
  test('when a later step fails after account creation, the account is rolled back too — no orphan', async () => {
    const id = await seedNeedsClarification(userId, {
      institutionName: 'Chase', accountTypeText: null, lastFour: '7777', creditCard: null,
      transactions: [], resolvedAccountId: null, accountOfferDeclined: false,
    });

    const failingAccountsService = {
      createAccount: async (uid, input, opts) => {
        await accountsService.createAccount(uid, input, opts);
        throw new Error('forced failure after account creation, before the offer is fully resolved');
      },
    };
    const failingService = createAccountOfferService({ pool, accountsService: failingAccountsService, institutionsService });

    await expect(
      failingService.resolveAccountOffer(userId, id, { accept: true, type: 'checking', nickname: 'Orphan-Check' })
    ).rejects.toThrow('forced failure after account creation, before the offer is fully resolved');

    const { rows: [row] } = await pool.query(
      `SELECT si.parse_status, d.extracted_data FROM shared_items si JOIN documents d ON d.shared_item_id = si.id WHERE si.id = $1`,
      [id]
    );
    expect(row.parse_status).toBe('needs_clarification'); // rolled back, not left half-resolved
    expect(row.extracted_data.resolvedAccountId).toBeNull();

    const { rows: accounts } = await pool.query(
      `SELECT * FROM accounts WHERE user_id = $1 AND nickname = 'Orphan-Check'`, [userId]
    );
    expect(accounts).toHaveLength(0); // the account the failed call created did not survive
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
