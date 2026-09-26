const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');

const accountsService = createAccountsService({ pool });

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
});
