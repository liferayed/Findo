// The statement queue is mocked so POST /documents/statements doesn't enqueue a real job that the
// docker findo-api worker would race this test for (same concern as statementUpload's tests).
jest.mock('../../src/documents/statementQueue', () => ({
  STATEMENT_QUEUE_NAME: 'test-statement-queue',
  connection: {},
  enqueueStatementExtraction: jest.fn(async () => {}),
}));

const request = require('supertest');
const { pool } = require('../../src/db');
const { createApp } = require('../../src/app');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createInstitutionsService } = require('../../src/institutions/institutionsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createChatTransactionHandler } = require('../../src/chat/chatTransactionHandler');
const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { createDocumentsService } = require('../../src/documents/documentsService');
const { createStatementUploadService } = require('../../src/documents/statementUploadService');
const { createAccountOfferService } = require('../../src/documents/accountOfferService');
const { createStatementReviewService } = require('../../src/documents/statementReviewService');
const { createStatementConfirmService } = require('../../src/documents/statementConfirmService');
const { createStatementExtractionWorker } = require('../../src/documents/statementExtractionService');

const accountsService = createAccountsService({ pool });
const institutionsService = createInstitutionsService({ pool });
const transactionsService = createTransactionsService({ pool });
const statementConfirmService = createStatementConfirmService({ pool, transactionsService });

const CARD = '4111 1111 1111 1111';
const PAYLOAD = `card ${CARD} routing 021000021 acct 000123456789 SSN 123-45-6789`;
// Every raw form a sensitive value could survive in. '123456789' also covers the account number
// (it is a substring of 000123456789) and a de-dashed SSN.
const NEEDLES = ['4111111111111111', CARD, '4111-1111-1111-1111', '021000021', '123456789', '123-45-6789', '123 45 6789'];

async function createTestUser() {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [
    `redact-${Date.now()}-${Math.random().toString(36).slice(2)}@findo.test`,
  ]);
  return rows[0].id;
}

// Every column of every row this user owns, across every table that stores ingested data.
async function dumpUserData(userId) {
  const queries = {
    accounts: 'SELECT a.* FROM accounts a WHERE a.user_id = $1',
    credit_card_details: 'SELECT c.* FROM credit_card_details c JOIN accounts a ON a.id = c.account_id WHERE a.user_id = $1',
    transactions: 'SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = $1',
    shared_items: 'SELECT si.* FROM shared_items si WHERE si.user_id = $1',
    clarification_requests:
      'SELECT cr.* FROM clarification_requests cr JOIN shared_items si ON si.id = cr.shared_item_id WHERE si.user_id = $1',
    documents: 'SELECT d.* FROM documents d JOIN shared_items si ON si.id = d.shared_item_id WHERE si.user_id = $1',
    transaction_sources:
      'SELECT ts.* FROM transaction_sources ts JOIN shared_items si ON si.id = ts.shared_item_id WHERE si.user_id = $1',
  };
  const dump = {};
  for (const [table, sql] of Object.entries(queries)) {
    dump[table] = (await pool.query(sql, [userId])).rows;
  }
  return JSON.stringify(dump);
}

async function expectNoSensitiveData(userId) {
  const dump = await dumpUserData(userId);
  for (const needle of NEEDLES) {
    expect(dump).not.toContain(needle);
  }
  return dump;
}

function buildApp(userId, { extractTransaction = async () => ({ is_transaction: false }), extractReceipt = async () => null } = {}) {
  return createApp({
    checkHealth: async () => ({ status: 'ok', subsystems: {} }),
    accountsService,
    institutionsService,
    transactionsService,
    resolveCurrentUserId: async () => userId,
    chatTransactionHandler: createChatTransactionHandler({ pool, transactionsService, extractTransaction }).handleMessage,
    receiptUploadHandler: createReceiptUploadHandler({ pool, transactionsService, accountsService, extractReceipt }),
    documentsService: createDocumentsService({ pool }),
    statementUploadService: createStatementUploadService({ pool }),
    accountOfferService: createAccountOfferService({ pool, accountsService, institutionsService }),
    statementReviewService: createStatementReviewService({ pool }),
    statementConfirmService,
  });
}

describe('F1.9 — no sensitive identifier reaches the database through any ingestion path (real Postgres)', () => {
  let userId;

  beforeEach(async () => {
    userId = await createTestUser();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });
  afterAll(async () => {
    await pool.end();
  });

  test('web account creation: a full card number in last_four, nickname and institution', async () => {
    const res = await request(buildApp(userId))
      .post('/accounts')
      .send({ nickname: `Visa ${CARD}`, type: 'credit_card', institution_name: `Chase ${CARD}`, last_four: CARD });
    expect(res.status).toBe(201);
    expect(res.body.last_four).toBe('1111');
    const dump = await expectNoSensitiveData(userId);
    expect(dump).toContain('Visa ****1111');
    expect(dump).toContain('Chase ****1111');
  });

  test('chat account creation', async () => {
    const res = await request(buildApp(userId))
      .post('/chat/messages')
      .send({ text: `Add my Chase checking account, ${PAYLOAD}` });
    expect(res.status).toBe(201);
    expect(res.body.received).toContain('****1111');
    await expectNoSensitiveData(userId);
    const { rows } = await pool.query('SELECT nickname, institution_name FROM accounts WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].institution_name).toBe('Chase');
    expect(rows[0].nickname).toBe('Chase Checking');
  });

  test('manual web transaction (F1.3)', async () => {
    const account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
    const res = await request(buildApp(userId))
      .post('/transactions')
      .send({ account_id: account.id, transaction_date: '2026-01-14', amount: 50, type: 'debit', merchant_raw: `Shop ${PAYLOAD}` });
    expect(res.status).toBe(201);
    expect(await expectNoSensitiveData(userId)).toContain('Shop card ****1111');
  });

  test('chat transaction — the LLM receives redacted text, and a model that echoes raw digits back is redacted too', async () => {
    await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
    const extractTransaction = jest.fn(async () => ({
      is_transaction: true, amount: 12.5, type: 'debit', merchant: `Coffee ${PAYLOAD}`, date_hint: 'today', account_hint: null,
    }));
    const res = await request(buildApp(userId, { extractTransaction }))
      .post('/chat/messages')
      .send({ text: `Spent $12.50 at Coffee ${PAYLOAD}` });
    expect(res.status).toBe(201);
    for (const needle of NEEDLES) {
      expect(extractTransaction.mock.calls[0][0]).not.toContain(needle);
      expect(JSON.stringify(res.body)).not.toContain(needle);
    }
    expect(await expectNoSensitiveData(userId)).toContain('****1111');
  });

  test('chat clarification — the held message and the user reply are both redacted', async () => {
    await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
    await accountsService.createAccount(userId, { nickname: 'Amex-Gold', type: 'credit_card', institution_name: 'American Express' });
    const extractTransaction = jest.fn(async () => ({
      is_transaction: true, amount: 12.5, type: 'debit', merchant: 'Coffee', date_hint: 'today', account_hint: null,
    }));
    const app = buildApp(userId, { extractTransaction });

    const first = await request(app).post('/chat/messages').send({ text: `Spent $12.50 at Coffee ${PAYLOAD}` });
    expect(first.body.reply).toContain('Which account');
    const second = await request(app).post('/chat/messages').send({ text: 'Chase-Checking, SSN 123-45-6789' });
    expect(second.status).toBe(201);

    expect(await expectNoSensitiveData(userId)).toContain('SSN [REDACTED]');
  });

  test('receipt upload — extraction output, a user-edited merchant and the filename are all redacted', async () => {
    const account = await accountsService.createAccount(userId, { nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });
    const extractReceipt = jest.fn(async () => ({
      merchant: `Store ${PAYLOAD}`, date: '2026-01-15', total: 20,
      line_items: [{ description: `Gift card ${CARD}`, amount: 20 }], card_last_four: null,
    }));
    const app = buildApp(userId, { extractReceipt });

    const extract = await request(app)
      .post('/documents/extract')
      .attach('file', Buffer.from('fake png'), { filename: 'receipt_4111111111111111.png', contentType: 'image/png' });
    expect(extract.status).toBe(200);
    expect(extract.body.extraction.merchant).toBe('Store card ****1111 routing [REDACTED] acct ****6789 SSN [REDACTED]');

    // Simulates a client that sends raw values back at confirm (e.g. the user re-typed the merchant).
    const confirm = await request(app).post('/documents/confirm').send({
      file_ref: extract.body.file_ref, original_filename: 'receipt_4111111111111111.png', channel: 'web_upload',
      account_id: account.id, merchant: `Store ${PAYLOAD}`, transaction_date: '2026-01-15', amount: 20,
      line_items: extract.body.extraction.line_items,
    });
    expect(confirm.status).toBe(201);
    expect(await expectNoSensitiveData(userId)).toContain('receipt_****1111.png');
  });

  test('statement upload, extraction and confirm — filename, descriptions, header text and an adjustment note', async () => {
    const account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase', last_four: '6789',
    });
    // An unconfirmed earlier transaction that the statement's Target row will be a `possible` match for.
    await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-12', amount: 42, merchantRaw: 'Target', type: 'debit', reconciliationStatus: 'unconfirmed',
    });

    const upload = await request(buildApp(userId))
      .post('/documents/statements')
      .attach('file', Buffer.from('fake png'), { filename: 'stmt_4111111111111111.png', contentType: 'image/png' });
    expect(upload.status).toBe(202);
    const sharedItemId = upload.body.shared_item_id;

    jest.spyOn(require('../../src/documents/statementStorage'), 'renderPagesToImages').mockResolvedValue(['page']);
    const extractPage = jest.fn(async () => ({
      transactions: [
        { date: '2026-01-14', description: 'Target', amount: -50.4 },
        { date: '2026-01-15', description: `TRANSFER TO ${PAYLOAD}`, amount: -100 },
      ],
      beginning_balance: null, ending_balance: null,
      institution_name: 'Chase', account_type_text: `Total Checking ${PAYLOAD}`, last_four: '6789',
    }));
    const worker = createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
    await worker.processJobDirectly({ data: { sharedItemId, userId } });

    await statementConfirmService.confirmReview(userId, sharedItemId, [
      { index: 0, action: 'tag', adjustmentReason: 'other', adjustmentNote: `refund to ${PAYLOAD}` },
      { index: 1, action: 'new' },
    ]);

    const dump = await expectNoSensitiveData(userId);
    expect(dump).toContain('stmt_****1111.png');
    expect(dump).toContain('TRANSFER TO card ****1111');
    expect(dump).toContain('refund to card ****1111');
  });
});
