const { createAccountsService } = require('../../src/accounts/accountsService');
const { ValidationError } = require('../../src/errors');

function fakePool() {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'acc-1' }] };
    }),
  };
}

describe('accountsService — F1.9 redaction', () => {
  test('createAccount truncates a pasted full card number in last_four to its last 4 digits', async () => {
    const pool = fakePool();
    await createAccountsService({ pool }).createAccount('user-1', {
      nickname: 'Visa', type: 'credit_card', institution_name: 'Chase', last_four: '4111 1111 1111 1111',
    });
    // INSERT params: [userId, type, institution_name, nickname, last_four]
    expect(pool.calls[0].params[4]).toBe('1111');
  });

  test('createAccount redacts a card number typed into nickname or institution_name', async () => {
    const pool = fakePool();
    await createAccountsService({ pool }).createAccount('user-1', {
      nickname: 'Visa 4111111111111111', type: 'credit_card', institution_name: 'Chase 4111-1111-1111-1111',
    });
    expect(pool.calls[0].params[2]).toBe('Chase ****1111');
    expect(pool.calls[0].params[3]).toBe('Visa ****1111');
  });

  test('createAccount still rejects a last_four that is not a number at all', async () => {
    const pool = fakePool();
    await expect(
      createAccountsService({ pool }).createAccount('user-1', { nickname: 'X', type: 'checking', institution_name: 'Chase', last_four: 'abcd' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('updateAccount redacts a card number in the new nickname', async () => {
    const pool = fakePool();
    await createAccountsService({ pool }).updateAccount('user-1', 'acc-1', { nickname: 'Visa 4111111111111111' });
    // UPDATE params: [nickname, accountId, userId]
    expect(pool.calls[0].params[0]).toBe('Visa ****1111');
  });

  test('updateAccount rejects a non-string nickname without touching the database', async () => {
    const pool = fakePool();
    await expect(
      createAccountsService({ pool }).updateAccount('user-1', 'acc-1', { nickname: 4111111111111111 })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
