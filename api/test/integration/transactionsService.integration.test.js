const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { ValidationError, NotFoundError } = require('../../src/errors');

const accountsService = createAccountsService({ pool });
const service = createTransactionsService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    email,
    'Test User',
  ]);
  return rows[0].id;
}

async function deleteTestUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]); // cascades to accounts -> transactions
}

describe('transactionsService (against real Postgres)', () => {
  let userId;
  let accountId;

  beforeEach(async () => {
    userId = await createTestUser(`test-${Date.now()}-${Math.random()}@findo.test`);
    const account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
    accountId = account.id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('createTransaction inserts a row with server-shaped fields', async () => {
    const transaction = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 42.5,
      type: 'debit',
      merchant_raw: 'Blue Bottle Coffee',
    });

    expect(transaction.account_id).toBe(accountId);
    expect(transaction.merchant_raw).toBe('Blue Bottle Coffee');
    expect(transaction.type).toBe('debit');
    expect(transaction.is_manual).toBe(true);
    expect(transaction.reconciliation_status).toBe('confirmed');
    expect(transaction.category_id).toBeNull();
    expect(Number(transaction.amount)).toBe(-42.5);
  });

  test('a debit is stored as a negative amount and a credit as a positive amount', async () => {
    const debit = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 20,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    const credit = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 20,
      type: 'credit',
      merchant_raw: 'Refund',
    });

    expect(Number(debit.amount)).toBe(-20);
    expect(Number(credit.amount)).toBe(20);
  });

  test('a created transaction appears in listTransactionsForAccount', async () => {
    const created = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });

    const transactions = await service.listTransactionsForAccount(userId, accountId);

    expect(transactions.map((t) => t.id)).toContain(created.id);
  });

  test('listTransactionsForAccount orders newest first by transaction_date, then created_at', async () => {
    const older = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-01',
      amount: 1,
      type: 'debit',
      merchant_raw: 'Older',
    });
    const newer = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 2,
      type: 'debit',
      merchant_raw: 'Newer',
    });
    const sameDateEarlier = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 3,
      type: 'debit',
      merchant_raw: 'Same-Date-Earlier',
    });
    const sameDateLater = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 4,
      type: 'debit',
      merchant_raw: 'Same-Date-Later',
    });

    const transactions = await service.listTransactionsForAccount(userId, accountId);

    expect(transactions.map((t) => t.id)).toEqual([sameDateLater.id, sameDateEarlier.id, newer.id, older.id]);
  });

  test('createTransaction rejects invalid input without touching the database', async () => {
    await expect(
      service.createTransaction(userId, {
        account_id: accountId,
        transaction_date: '2026-01-15',
        amount: 10,
        type: 'debit',
        merchant_raw: '',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('createTransaction rejects a transfer type', async () => {
    await expect(
      service.createTransaction(userId, {
        account_id: accountId,
        transaction_date: '2026-01-15',
        amount: 10,
        type: 'transfer',
        merchant_raw: 'Coffee',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('createTransaction rejects a non-positive amount', async () => {
    await expect(
      service.createTransaction(userId, {
        account_id: accountId,
        transaction_date: '2026-01-15',
        amount: -5,
        type: 'debit',
        merchant_raw: 'Coffee',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('createTransaction rejects an account_id belonging to a different user', async () => {
    const otherUserId = await createTestUser(`other-${Date.now()}-${Math.random()}@findo.test`);
    try {
      const otherAccount = await accountsService.createAccount(otherUserId, {
        nickname: 'Not-Mine',
        type: 'checking',
        institution_name: 'Wells Fargo',
      });

      await expect(
        service.createTransaction(userId, {
          account_id: otherAccount.id,
          transaction_date: '2026-01-15',
          amount: 10,
          type: 'debit',
          merchant_raw: 'Coffee',
        })
      ).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await deleteTestUser(otherUserId);
    }
  });

  test('createTransaction rejects a non-existent account_id', async () => {
    await expect(
      service.createTransaction(userId, {
        account_id: '11111111-1111-1111-1111-111111111111',
        transaction_date: '2026-01-15',
        amount: 10,
        type: 'debit',
        merchant_raw: 'Coffee',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('createTransaction rejects creating against an inactive account', async () => {
    await accountsService.updateAccount(userId, accountId, { is_active: false });

    await expect(
      service.createTransaction(userId, {
        account_id: accountId,
        transaction_date: '2026-01-15',
        amount: 10,
        type: 'debit',
        merchant_raw: 'Coffee',
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('listTransactionsForAccount still works for an inactive account', async () => {
    const created = await service.createTransaction(userId, {
      account_id: accountId,
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });

    await accountsService.updateAccount(userId, accountId, { is_active: false });

    const transactions = await service.listTransactionsForAccount(userId, accountId);
    expect(transactions.map((t) => t.id)).toContain(created.id);
  });

  test('listTransactionsForAccount rejects an account belonging to a different user', async () => {
    const otherUserId = await createTestUser(`other2-${Date.now()}-${Math.random()}@findo.test`);
    try {
      const otherAccount = await accountsService.createAccount(otherUserId, {
        nickname: 'Not-Mine',
        type: 'checking',
        institution_name: 'Wells Fargo',
      });

      await expect(service.listTransactionsForAccount(userId, otherAccount.id)).rejects.toBeInstanceOf(
        NotFoundError
      );
    } finally {
      await deleteTestUser(otherUserId);
    }
  });
});
