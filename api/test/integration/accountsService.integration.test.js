const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { ValidationError, ConflictError, NotFoundError } = require('../../src/errors');

const service = createAccountsService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
    [email, 'Test User']
  );
  return rows[0].id;
}

async function deleteTestUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

describe('accountsService (against real Postgres)', () => {
  let userId;

  beforeEach(async () => {
    userId = await createTestUser(`test-${Date.now()}-${Math.random()}@findo.test`);
  });

  afterEach(async () => {
    await deleteTestUser(userId); // cascades to accounts
  });

  afterAll(async () => {
    await pool.end();
  });

  test('createAccount inserts a row and returns it', async () => {
    const account = await service.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
      last_four: '1234',
    });

    expect(account.user_id).toBe(userId);
    expect(account.nickname).toBe('Chase-Checking');
    expect(account.type).toBe('checking');
    expect(account.institution_name).toBe('Chase');
    expect(account.last_four).toBe('1234');
    expect(account.is_active).toBe(true);
  });

  test('createAccount rejects invalid input without touching the database', async () => {
    await expect(
      service.createAccount(userId, { nickname: '', type: 'checking', institution_name: 'Chase' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('createAccount rejects a duplicate nickname for the same user', async () => {
    await service.createAccount(userId, {
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });

    await expect(
      service.createAccount(userId, {
        nickname: 'Chase-Checking',
        type: 'savings',
        institution_name: 'Chase',
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test('listAccounts returns only the given user\'s accounts, newest first', async () => {
    const otherUserId = await createTestUser(`other-${Date.now()}-${Math.random()}@findo.test`);
    try {
      await service.createAccount(userId, { nickname: 'First', type: 'checking', institution_name: 'Chase' });
      await service.createAccount(userId, { nickname: 'Second', type: 'savings', institution_name: 'Chase' });
      await service.createAccount(otherUserId, { nickname: 'Not-Mine', type: 'checking', institution_name: 'Wells Fargo' });

      const accounts = await service.listAccounts(userId);

      expect(accounts.map((a) => a.nickname)).toEqual(['Second', 'First']);
    } finally {
      await deleteTestUser(otherUserId);
    }
  });

  test('updateAccount changes nickname and is_active for an owned account', async () => {
    const created = await service.createAccount(userId, {
      nickname: 'Old-Name',
      type: 'checking',
      institution_name: 'Chase',
    });

    const updated = await service.updateAccount(userId, created.id, { nickname: 'New-Name', is_active: false });

    expect(updated.nickname).toBe('New-Name');
    expect(updated.is_active).toBe(false);
  });

  test('updateAccount throws NotFoundError for an account belonging to a different user', async () => {
    const otherUserId = await createTestUser(`other2-${Date.now()}-${Math.random()}@findo.test`);
    try {
      const created = await service.createAccount(otherUserId, {
        nickname: 'Not-Mine',
        type: 'checking',
        institution_name: 'Wells Fargo',
      });

      await expect(service.updateAccount(userId, created.id, { nickname: 'Hijacked' })).rejects.toBeInstanceOf(
        NotFoundError
      );
    } finally {
      await deleteTestUser(otherUserId);
    }
  });

  test('finds the one active account matching a last-four', async () => {
    await service.createAccount(userId, { type: 'checking', institution_name: 'Chase', nickname: 'Chase Checking', last_four: '4821' });
    const matches = await service.findActiveAccountsByLastFour(userId, '4821');
    expect(matches).toHaveLength(1);
    expect(matches[0].nickname).toBe('Chase Checking');
  });

  test('returns empty when two active accounts share a last-four', async () => {
    await service.createAccount(userId, { type: 'checking', institution_name: 'Chase', nickname: 'Chase Checking', last_four: '4821' });
    await service.createAccount(userId, { type: 'savings', institution_name: 'Chase', nickname: 'Chase Savings', last_four: '4821' });
    const matches = await service.findActiveAccountsByLastFour(userId, '4821');
    expect(matches).toHaveLength(2);
  });

  test('returns empty for a null last-four', async () => {
    const matches = await service.findActiveAccountsByLastFour(userId, null);
    expect(matches).toHaveLength(0);
  });

  test('does not match an inactive account', async () => {
    const account = await service.createAccount(userId, { type: 'checking', institution_name: 'Chase', nickname: 'Old', last_four: '4821' });
    await service.updateAccount(userId, account.id, { is_active: false });
    const matches = await service.findActiveAccountsByLastFour(userId, '4821');
    expect(matches).toHaveLength(0);
  });
});
