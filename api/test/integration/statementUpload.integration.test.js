// This suite tests the upload/status HTTP endpoints, not the queue. Mock the enqueue so uploads
// never put a real job on the shared `findo-statement-extraction` queue: when suites run in
// parallel, statementExtractionRealQueue's real worker (or the dev findo-api container's) would
// pick it up and move it past 'pending' mid-test. The real queue -> worker round trip is covered
// by statementExtractionRealQueue.integration.test.js.
jest.mock('../../src/documents/statementQueue', () => ({
  STATEMENT_QUEUE_NAME: 'findo-statement-extraction-test-unused',
  connection: {},
  enqueueStatementExtraction: jest.fn(async () => {}),
}));

const request = require('supertest');
const { pool } = require('../../src/db');
const { createApp } = require('../../src/app');
const { createStatementUploadService } = require('../../src/documents/statementUploadService');
const { enqueueStatementExtraction } = require('../../src/documents/statementQueue');

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [email]);
  return rows[0].id;
}

// Follows api/test/app.test.js's buildApp pattern exactly: createApp is given every
// dependency it destructures, with unused services stubbed to throw if accidentally invoked,
// and resolveCurrentUserId stubbed to resolve to a real test user id. statementUploadService
// is the one real, non-stubbed dependency under test here — wired to the real pool/queue.
function buildApp(userId, overrides = {}) {
  return createApp({
    checkHealth: async () => ({ status: 'ok', subsystems: {} }),
    accountsService: {
      createAccount: async () => {
        throw new Error('createAccount not stubbed');
      },
      listAccounts: async () => {
        throw new Error('listAccounts not stubbed');
      },
      updateAccount: async () => {
        throw new Error('updateAccount not stubbed');
      },
    },
    institutionsService: {
      listInstitutions: async () => {
        throw new Error('listInstitutions not stubbed');
      },
      resolveInstitutionAlias: async () => {
        throw new Error('resolveInstitutionAlias not stubbed');
      },
    },
    transactionsService: {
      createTransaction: async () => {
        throw new Error('createTransaction not stubbed');
      },
      listTransactionsForAccount: async () => {
        throw new Error('listTransactionsForAccount not stubbed');
      },
    },
    resolveCurrentUserId: async () => userId,
    chatTransactionHandler: async () => null,
    receiptUploadHandler: {
      handleExtract: async () => {
        throw new Error('handleExtract not stubbed');
      },
      handleConfirm: async () => {
        throw new Error('handleConfirm not stubbed');
      },
    },
    documentsService: {
      listDocuments: async () => {
        throw new Error('listDocuments not stubbed');
      },
    },
    statementUploadService: createStatementUploadService({ pool }),
    ...overrides,
  });
}

describe('statement upload + status endpoints (against real Postgres/Redis)', () => {
  let userId;
  let app;

  beforeEach(async () => {
    userId = await createTestUser(`stmt-upload-${Date.now()}-${Math.random().toString(36).slice(2)}@findo.test`);
    app = buildApp(userId);
  });

  afterEach(async () => {
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      userId = undefined;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /documents/statements accepts a PDF and returns a shared_item_id', async () => {
    const res = await request(app)
      .post('/documents/statements')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'statement.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(202);
    expect(res.body.shared_item_id).toBeDefined();
  });

  test('POST /documents/statements hands the new shared_item to the extraction queue', async () => {
    const res = await request(app)
      .post('/documents/statements')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'statement.pdf', contentType: 'application/pdf' });
    expect(enqueueStatementExtraction).toHaveBeenCalledWith(res.body.shared_item_id, userId);
  });

  test('POST /documents/statements rejects an unsupported file type', async () => {
    const res = await request(app)
      .post('/documents/statements')
      .attach('file', Buffer.from('not a doc'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  test('GET /documents/:id/status returns pending immediately after upload', async () => {
    const upload = await request(app)
      .post('/documents/statements')
      .attach('file', Buffer.from('fake png'), { filename: 'statement.png', contentType: 'image/png' });
    const res = await request(app).get(`/documents/${upload.body.shared_item_id}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  test('GET /documents/:id/status 404s for a shared_item belonging to another user or not found', async () => {
    const res = await request(app).get('/documents/00000000-0000-0000-0000-000000000000/status');
    expect(res.status).toBe(404);
  });

  test('GET /documents/:id/status reports confirmed once the statement has been confirmed, not ready_for_review forever', async () => {
    // Seed a shared_items/documents row directly (rather than via POST /documents/statements,
    // whose job is mocked out above and so never gets extracted) with parse_status 'parsed' and extracted_data.confirmedAt
    // set — mirroring what statementConfirmService.confirmReview writes on success — then assert
    // the status endpoint reports 'confirmed', not 'ready_for_review'.
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, original_filename, parse_status)
       VALUES ($1, 'web_upload', 'file', 'fake-ref', 'statement.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: '11111111-1111-1111-1111-111111111111', confirmedAt: new Date().toISOString() })]
    );
    const res = await request(app).get(`/documents/${sharedItem.id}/status`);
    expect(res.body.status).toBe('confirmed');
  });
});
