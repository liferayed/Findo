// F1.7 final review C1: startStatementExtractionWorker has no caller outside tests — server.js
// never starts it, so every real upload sits at 'pending' forever. This test proves the worker
// actually drains a REAL BullMQ queue (enqueueStatementExtraction -> a real Worker consuming
// STATEMENT_QUEUE_NAME), not just processJobDirectly's direct-call test seam (already covered by
// statementExtraction.integration.test.js). extractPage is stubbed so this stays CI-safe without
// a real vision model, but the queue/worker round-trip itself is real.
const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createInstitutionsService } = require('../../src/institutions/institutionsService');
const { enqueueStatementExtraction, statementQueue } = require('../../src/documents/statementQueue');
const { startStatementExtractionWorker } = require('../../src/documents/statementExtractionService');
const { saveStatementFile } = require('../../src/documents/statementStorage');
const statementStorage = require('../../src/documents/statementStorage');

const accountsService = createAccountsService({ pool });
const institutionsService = createInstitutionsService({ pool });

let worker;

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

async function waitForParseStatus(sharedItemId, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows: [row] } = await pool.query('SELECT parse_status FROM shared_items WHERE id = $1', [sharedItemId]);
    if (row.parse_status !== 'pending') {
      return row.parse_status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`shared_item ${sharedItemId} never left 'pending' within ${timeoutMs}ms`);
}

describe('statement extraction worker against a REAL BullMQ queue (against real Postgres + Redis)', () => {
  let userId;

  beforeAll(() => {
    const extractPage = jest.fn().mockResolvedValue({
      transactions: [{ date: '2026-01-13', description: 'COFFEE', amount: -4.5 }],
      beginning_balance: 100, ending_balance: 95.5,
      institution_name: 'Chase', account_type_text: 'Total Checking', last_four: '4432',
    });
    worker = startStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage });
  });

  afterAll(async () => {
    await worker.close();
    // F1.7 final review M4: this suite is the only one that uses the real, shared
    // `findo-statement-extraction` BullMQ queue; statementUpload.integration.test.js mocks the
    // enqueue so its jobs can't be consumed by this suite's worker when suites run in parallel.
    // Clean up this file's own jobs so they don't pile up in Redis across test runs. This
    // is cleanup of jobs THIS file enqueued, not a change to the shared queue name/wiring itself.
    await statementQueue.obliterate({ force: true });
    await pool.end();
  });

  beforeEach(async () => {
    userId = await createTestUser(`realqueue-${Date.now()}-${Math.random()}@findo.test`);
    jest.spyOn(statementStorage, 'renderPagesToImages').mockResolvedValue(['pageOneBase64']);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  test('a job enqueued via enqueueStatementExtraction is actually picked up and processed by the real worker', async () => {
    const fileRef = await saveStatementFile({ buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 });
    const sharedItemId = await insertSharedItemAndDocument(userId, fileRef);

    await enqueueStatementExtraction(sharedItemId, userId);

    const finalStatus = await waitForParseStatus(sharedItemId);

    // needs_clarification (no matching account for last_four '4432' in this fresh user) is the
    // expected real-worker outcome here — the point of this test is that the row moved out of
    // 'pending' at all, proving the real queue -> real worker wiring actually runs the job.
    expect(finalStatus).not.toBe('pending');
    expect(['parsed', 'needs_clarification', 'failed']).toContain(finalStatus);

    const { rows: [doc] } = await pool.query('SELECT extracted_data FROM documents WHERE shared_item_id = $1', [sharedItemId]);
    expect(doc.extracted_data.transactions).toHaveLength(1);
  });
});
