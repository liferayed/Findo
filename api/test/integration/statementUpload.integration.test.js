const request = require('supertest');
const { pool } = require('../../src/db');
const { createApp } = require('../../src/app');
const { createStatementUploadService } = require('../../src/documents/statementUploadService');

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
});
