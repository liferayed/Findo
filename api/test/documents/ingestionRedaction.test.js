// statementUploadService imports statementQueue, which opens a Redis connection at require time,
// and statementStorage, which writes to disk — neither is wanted in a unit test.
jest.mock('../../src/documents/statementQueue', () => ({
  STATEMENT_QUEUE_NAME: 'test-statement-queue',
  connection: {},
  enqueueStatementExtraction: jest.fn(async () => {}),
}));
jest.mock('../../src/documents/statementStorage', () => ({
  saveStatementFile: jest.fn(async () => 'api/uploads/statements/fake.png'),
}));

const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { createStatementUploadService } = require('../../src/documents/statementUploadService');
const { applyAmountCorroboration } = require('../../src/reconciliation/reconciliationService');

function recordingClient(respond = () => ({ rows: [{ id: 'row-1' }] })) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return respond(sql);
    }),
    release: jest.fn(),
  };
}

describe('receipt confirm — F1.9 redaction', () => {
  test('a client-supplied merchant and filename are redacted before shared_items and the transaction are written', async () => {
    const client = recordingClient();
    const pool = { connect: jest.fn(async () => client) };
    const createTransactionFromReceipt = jest.fn(async () => ({ id: 'txn-1' }));
    const handler = createReceiptUploadHandler({
      pool,
      transactionsService: { findOwnedAccount: jest.fn(async () => {}), createTransactionFromReceipt },
      accountsService: {},
      extractReceipt: async () => null,
    });

    await handler.handleConfirm('user-1', {
      fileRef: 'api/uploads/receipts/123e4567-e89b-42d3-a456-426614174000.png',
      originalFilename: 'receipt_4111111111111111.png',
      channel: 'web_upload',
      accountId: 'acc-1',
      merchantRaw: 'Store 4111 1111 1111 1111',
      transactionDate: '2026-01-15',
      amount: 20,
      lineItems: [],
    });

    expect(createTransactionFromReceipt.mock.calls[0][1].merchantRaw).toBe('Store ****1111');
    // shared_items INSERT params: [userId, channel, fileRef, originalFilename, parseStatus, parsedSummary]
    const sharedItemParams = client.calls.find((c) => c.sql.includes('INSERT INTO shared_items')).params;
    expect(sharedItemParams[3]).toBe('receipt_****1111.png');
    expect(sharedItemParams[5]).toBe('Store ****1111 — $20.00');
  });
});

describe('receipt confirm — non-string filename', () => {
  test('a non-string originalFilename is stored as null, not as text', async () => {
    const client = recordingClient();
    const pool = { connect: jest.fn(async () => client) };
    const handler = createReceiptUploadHandler({
      pool,
      transactionsService: { findOwnedAccount: jest.fn(async () => {}), createTransactionFromReceipt: jest.fn(async () => ({ id: 'txn-1' })) },
      accountsService: {},
      extractReceipt: async () => null,
    });

    await handler.handleConfirm('user-1', {
      fileRef: 'api/uploads/receipts/123e4567-e89b-42d3-a456-426614174000.png',
      originalFilename: 4111111111111111,
      channel: 'web_upload',
      accountId: 'acc-1',
      merchantRaw: 'Store',
      transactionDate: '2026-01-15',
      amount: 20,
      lineItems: [],
    });

    const sharedItemParams = client.calls.find((c) => c.sql.includes('INSERT INTO shared_items')).params;
    expect(sharedItemParams[3]).toBeNull();
  });
});

describe('statement upload — F1.9 redaction', () => {
  test('the uploaded filename is redacted before it is stored', async () => {
    const pool = recordingClient();
    await createStatementUploadService({ pool }).handleStatementUpload('user-1', {
      file: { mimetype: 'application/pdf', size: 10, originalname: 'stmt_4111111111111111.pdf' },
    });
    // shared_items INSERT params: [userId, fileRef, original_filename]
    const params = pool.calls.find((c) => c.sql.includes('INSERT INTO shared_items')).params;
    expect(params[2]).toBe('stmt_****1111.pdf');
  });
});

describe('adjustment note — F1.9 redaction', () => {
  test('a card number in a user-typed adjustment note is redacted before transaction_sources is written', async () => {
    const client = recordingClient((sql) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ account_id: 'acc-1', amount: '-42', reconciliation_status: 'unconfirmed' }] };
      }
      if (sql.includes('AS difference')) {
        return { rows: [{ difference: '-8.4' }] };
      }
      return { rows: [] };
    });

    await applyAmountCorroboration(client, {
      transactionId: 'txn-1', sharedItemId: 'si-1', postedDate: '2026-01-14', statementAmount: -50.4,
      confidence: 0.8, adjustmentReason: 'other', adjustmentNote: 'refund to card 4111111111111111',
    });

    // transaction_sources INSERT params: [transactionId, sharedItemId, confidence, reason, note]
    const params = client.calls.find((c) => c.sql.includes('INSERT INTO transaction_sources')).params;
    expect(params[4]).toBe('refund to card ****1111');
  });

  test('a non-string adjustment note is stored as null, not as text', async () => {
    const client = recordingClient((sql) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ account_id: 'acc-1', amount: '-42', reconciliation_status: 'unconfirmed' }] };
      }
      if (sql.includes('AS difference')) {
        return { rows: [{ difference: '-8.4' }] };
      }
      return { rows: [] };
    });

    await applyAmountCorroboration(client, {
      transactionId: 'txn-1', sharedItemId: 'si-1', postedDate: '2026-01-14', statementAmount: -50.4,
      confidence: 0.8, adjustmentReason: 'tip', adjustmentNote: 4111111111111111,
    });

    const params = client.calls.find((c) => c.sql.includes('INSERT INTO transaction_sources')).params;
    expect(params[4]).toBeNull();
  });
});
