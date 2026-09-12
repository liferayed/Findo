const { validateAccountInput, ACCOUNT_TYPES } = require('../../src/accounts/validateAccountInput');

describe('validateAccountInput', () => {
  test('returns no errors for a fully valid input', () => {
    const errors = validateAccountInput({
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
      last_four: '1234',
    });
    expect(errors).toEqual([]);
  });

  test('allows last_four to be omitted', () => {
    const errors = validateAccountInput({
      nickname: 'Chase-Checking',
      type: 'checking',
      institution_name: 'Chase',
    });
    expect(errors).toEqual([]);
  });

  test('requires a nickname', () => {
    const errors = validateAccountInput({ type: 'checking', institution_name: 'Chase' });
    expect(errors).toContain('nickname is required');
  });

  test('requires an institution_name', () => {
    const errors = validateAccountInput({ nickname: 'Chase-Checking', type: 'checking' });
    expect(errors).toContain('institution_name is required');
  });

  test('rejects a type outside the known enum', () => {
    const errors = validateAccountInput({ nickname: 'X', institution_name: 'Chase', type: 'crypto_wallet' });
    expect(errors).toContain(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  });

  test('rejects last_four with more than 4 digits (a full card/account number pasted by mistake)', () => {
    const errors = validateAccountInput({
      nickname: 'X',
      institution_name: 'Chase',
      type: 'checking',
      last_four: '123456789012',
    });
    expect(errors).toContain('last_four must be exactly 4 digits');
  });

  test('rejects last_four with non-digit characters', () => {
    const errors = validateAccountInput({
      nickname: 'X',
      institution_name: 'Chase',
      type: 'checking',
      last_four: '12a4',
    });
    expect(errors).toContain('last_four must be exactly 4 digits');
  });
});
