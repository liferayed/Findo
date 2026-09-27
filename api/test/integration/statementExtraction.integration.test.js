const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createInstitutionsService } = require('../../src/institutions/institutionsService');
const { createStatementExtractionWorker } = require('../../src/documents/statementExtractionService');
const { saveStatementFile } = require('../../src/documents/statementStorage');

const accountsService = createAccountsService({ pool });
const institutionsService = createInstitutionsService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

async function insertSharedItemAndDocument(userId, fileRef) {
  const { rows: [sharedItem] } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', $2, 'pending') RETURNING id`,
    [userId, fileRef]
  );
  await pool.query(`INSERT INTO documents (shared_item_id, document_type) VALUES ($1, 'bank_statement')`, [sharedItem.id]);
  return sharedItem.id;
}

async function fetchState(sharedItemId) {
  const { rows: [row] } = await pool.query(
    `SELECT si.parse_status, si.progress, d.extracted_data
     FROM shared_items si JOIN documents d ON d.shared_item_id = si.id WHERE si.id = $1`,
    [sharedItemId]
  );
  return row;
}

describe('statement extraction worker (against real Postgres)', () => {
  let userId;

  beforeEach(async () => {
    userId = await createTestUser(`stmt-${Date.now()}-${Math.random()}@findo.test`);
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('two-page statement aggregates transactions and picks the first/last non-null balance', async () => {
    const fileRef = await saveStatementFile({ buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 });
    const sharedItemId = await insertSharedItemAndDocument(userId, fileRef);
    const account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase', last_four: '4432' });

    let call = 0;
    const extractPage = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          transactions: [{ date: '2026-01-13', description: 'COFFEE', amount: -4.5 }],
          beginning_balance: 100, ending_balance: null,
          institution_name: 'Chase', account_type_text: 'Total Checking', last_four: '4432',
        };
      }
      return { transactions: [{ date: '2026-01-14', description: 'DEPOSIT', amount: 250 }], beginning_balance: null, ending_balance: 345.5 };
    });
    jest.spyOn(require('../../src/documents/statementStorage'), 'renderPagesToImages').mockResolvedValue(['pageOneBase64', 'pageTwoBase64']);

    const worker = createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
    await worker.processJobDirectly({ data: { sharedItemId, userId } }); // see Step 3 note on this test seam

    const state = await fetchState(sharedItemId);
    expect(state.parse_status).toBe('parsed');
    expect(state.progress).toEqual({ page: 2, totalPages: 2 });
    expect(state.extracted_data.transactions).toHaveLength(2);
    expect(state.extracted_data.beginningBalance).toBe(100);
    expect(state.extracted_data.endingBalance).toBe(345.5);
    expect(state.extracted_data.resolvedAccountId).toBe(account.id);

    jest.restoreAllMocks();
  });

  test('no last_four means no account resolution — parse_status becomes needs_clarification', async () => {
    const fileRef = await saveStatementFile({ buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 });
    const sharedItemId = await insertSharedItemAndDocument(userId, fileRef);
    jest.spyOn(require('../../src/documents/statementStorage'), 'renderPagesToImages').mockResolvedValue(['page']);
    const extractPage = jest.fn().mockResolvedValue({ transactions: [], beginning_balance: null, ending_balance: null });

    const worker = createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
    await worker.processJobDirectly({ data: { sharedItemId, userId } });

    const state = await fetchState(sharedItemId);
    expect(state.parse_status).toBe('needs_clarification');
    expect(state.extracted_data.resolvedAccountId).toBeNull();
    jest.restoreAllMocks();
  });

  test('a page that throws (e.g. unreadable) contributes nothing but does not fail the whole statement', async () => {
    const fileRef = await saveStatementFile({ buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 });
    const sharedItemId = await insertSharedItemAndDocument(userId, fileRef);
    jest.spyOn(require('../../src/documents/statementStorage'), 'renderPagesToImages').mockResolvedValue(['page1', 'page2']);
    const extractPage = jest.fn()
      .mockResolvedValueOnce({ transactions: [{ date: '2026-01-13', description: 'X', amount: -1 }], beginning_balance: null, ending_balance: null })
      .mockRejectedValueOnce(new Error('model unreachable'));

    const worker = createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
    await worker.processJobDirectly({ data: { sharedItemId, userId } });

    const state = await fetchState(sharedItemId);
    expect(state.extracted_data.transactions).toHaveLength(1);
    expect(state.parse_status).not.toBe('failed');
    jest.restoreAllMocks();
  });

  test('every page failing marks the statement failed', async () => {
    const fileRef = await saveStatementFile({ buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 });
    const sharedItemId = await insertSharedItemAndDocument(userId, fileRef);
    jest.spyOn(require('../../src/documents/statementStorage'), 'renderPagesToImages').mockResolvedValue(['page1']);
    const extractPage = jest.fn().mockRejectedValue(new Error('model unreachable'));

    const worker = createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
    await worker.processJobDirectly({ data: { sharedItemId, userId } });

    expect((await fetchState(sharedItemId)).parse_status).toBe('failed');
    jest.restoreAllMocks();
  });
});
