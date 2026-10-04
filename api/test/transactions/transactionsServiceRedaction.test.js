const { createTransactionsService } = require('../../src/transactions/transactionsService');

// findOwnedAccount runs on `pool`; the INSERT and balance update run on a checked-out client.
function fakePool() {
  const clientCalls = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      clientCalls.push({ sql, params });
      return { rows: [{ id: 'txn-1' }] };
    }),
    release: jest.fn(),
  };
  return {
    clientCalls,
    query: jest.fn(async () => ({ rows: [{ id: 'acc-1' }] })),
    connect: jest.fn(async () => client),
  };
}

function insertParams(pool) {
  return pool.clientCalls.find((c) => c.sql.includes('INSERT INTO transactions')).params;
}

describe('transactionsService — F1.9 redaction', () => {
  test('a manual transaction (F1.3) has its merchant_raw and merchant_normalized redacted', async () => {
    const pool = fakePool();
    await createTransactionsService({ pool }).createTransaction('user-1', {
      account_id: 'acc-1', transaction_date: '2026-01-14', amount: 50, type: 'debit',
      merchant_raw: 'TRANSFER TO CHK 123456789',
    });
    // INSERT params: [accountId, date, signedAmount, merchant_raw, merchant_normalized, type, is_manual, status]
    const params = insertParams(pool);
    expect(params[3]).toBe('TRANSFER TO CHK ****6789');
    expect(params[4]).not.toContain('123456789');
  });

  test('every other creation path goes through the same INSERT and is redacted too', async () => {
    const pool = fakePool();
    await createTransactionsService({ pool }).createTransactionFromStatement('user-1', {
      accountId: 'acc-1', transactionDate: '2026-01-14', amount: -50, merchantRaw: 'PAYMENT 4111111111111111',
    });
    expect(insertParams(pool)[3]).toBe('PAYMENT ****1111');
  });
});
