const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { getBalanceAsOf } = require('../../src/accounts/balance');
const { createTransactionsService } = require('../../src/transactions/transactionsService');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });

async function balanceOf(accountId) {
  const { rows } = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);
  return Number(rows[0].current_balance);
}

async function countTransactions(accountId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions WHERE account_id = $1', [accountId]);
  return rows[0].n;
}

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [email, 'Test User']);
  return rows[0].id;
}

describe('balance ledger (against real Postgres)', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`ledger-${Date.now()}-${Math.random()}@findo.test`);
    account = await accountsService.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('a new account starts with opening_balance 0 and no balance_as_of_date', () => {
    expect(Number(account.opening_balance)).toBe(0);
    expect(account.balance_as_of_date).toBeNull();
  });

  test('manual debit and credit move current_balance by the signed amount', async () => {
    await transactionsService.createTransaction(userId, {
      account_id: account.id, transaction_date: '2026-01-15', amount: 40, type: 'debit', merchant_raw: 'Coffee',
    });
    expect(await balanceOf(account.id)).toBe(-40);
    await transactionsService.createTransaction(userId, {
      account_id: account.id, transaction_date: '2026-01-16', amount: 100, type: 'credit', merchant_raw: 'Refund',
    });
    expect(await balanceOf(account.id)).toBe(60);
  });

  test('chat capture moves current_balance', async () => {
    await transactionsService.createTransactionFromChat(userId, {
      accountId: account.id, transactionDate: '2026-01-15', amount: 25, merchantRaw: 'Lunch', type: 'debit',
      reconciliationStatus: 'unconfirmed',
    });
    expect(await balanceOf(account.id)).toBe(-25);
  });

  test('receipt creation moves current_balance', async () => {
    await transactionsService.createTransactionFromReceipt(userId, {
      accountId: account.id, transactionDate: '2026-01-15', amount: 12.5, merchantRaw: 'Cafe',
    });
    expect(await balanceOf(account.id)).toBe(-12.5);
  });

  test('receipt creation inside a caller-owned transaction rolls back both the row and the balance', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await transactionsService.createTransactionFromReceipt(
        userId,
        { accountId: account.id, transactionDate: '2026-01-15', amount: 12.5, merchantRaw: 'Cafe' },
        { client }
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await balanceOf(account.id)).toBe(0);
    expect(await countTransactions(account.id)).toBe(0);
  });

  test('if the balance update fails, no transaction row is left behind (self-owned transaction)', async () => {
    // Force the UPDATE to fail after the INSERT succeeds, using a real constraint.
    const constraint = `tmp_ledger_floor_${Date.now()}`;
    await pool.query(
      `ALTER TABLE accounts ADD CONSTRAINT ${constraint} CHECK (id <> '${account.id}'::uuid OR current_balance >= -1000) NOT VALID`
    );
    try {
      await expect(
        transactionsService.createTransaction(userId, {
          account_id: account.id, transaction_date: '2026-01-15', amount: 5000, type: 'debit', merchant_raw: 'Big',
        })
      ).rejects.toThrow();
    } finally {
      await pool.query(`ALTER TABLE accounts DROP CONSTRAINT ${constraint}`);
    }
    expect(await balanceOf(account.id)).toBe(0);
    expect(await countTransactions(account.id)).toBe(0);
  });

  test('concurrent creates on one account all land in the balance (no lost updates)', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        transactionsService.createTransaction(userId, {
          account_id: account.id, transaction_date: '2026-01-15', amount: 10, type: 'debit', merchant_raw: `M${i}`,
        })
      )
    );
    expect(await balanceOf(account.id)).toBe(-100);
    expect(await countTransactions(account.id)).toBe(10);
  });

  test('getBalanceAsOf reconstructs the balance at any date, including with no transactions', async () => {
    await pool.query('UPDATE accounts SET opening_balance = 500, current_balance = 500 WHERE id = $1', [account.id]);
    await transactionsService.createTransaction(userId, {
      account_id: account.id, transaction_date: '2026-01-10', amount: 100, type: 'debit', merchant_raw: 'A',
    });
    await transactionsService.createTransaction(userId, {
      account_id: account.id, transaction_date: '2026-01-20', amount: 30, type: 'credit', merchant_raw: 'B',
    });

    expect(await getBalanceAsOf(pool, account.id, '2026-01-05')).toBe(500);
    expect(await getBalanceAsOf(pool, account.id, '2026-01-10')).toBe(400);
    expect(await getBalanceAsOf(pool, account.id, '2026-02-01')).toBe(430);
    expect(await balanceOf(account.id)).toBe(430);
  });
});
