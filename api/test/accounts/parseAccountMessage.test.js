const { looksLikeAccountCreation, parseAccountMessage } = require('../../src/accounts/parseAccountMessage');

describe('looksLikeAccountCreation', () => {
  test('recognizes "add my ... account" phrasing', () => {
    expect(looksLikeAccountCreation('Add my Chase checking account, call it Chase-Checking')).toBe(true);
  });

  test('does not treat an unrelated message as account creation', () => {
    expect(looksLikeAccountCreation('Spent $12.50 at Starbucks today')).toBe(false);
  });

  test('does not treat a balance question as account creation', () => {
    expect(looksLikeAccountCreation("how's my balance?")).toBe(false);
  });
});

describe('parseAccountMessage', () => {
  test('extracts institution, type, and explicit nickname from the design doc example', () => {
    const result = parseAccountMessage('Add my Chase checking account, call it Chase-Checking');
    expect(result).toEqual({
      institution_name: 'Chase',
      type: 'checking',
      nickname: 'Chase-Checking',
    });
  });

  test('maps "credit card" phrasing to the credit_card enum value', () => {
    const result = parseAccountMessage('Add my Amex credit card account, call it Amex-Everyday');
    expect(result.type).toBe('credit_card');
    expect(result.institution_name).toBe('Amex');
  });

  test('defaults the nickname to "<Institution> <Type>" when none is given', () => {
    const result = parseAccountMessage('Add my Wells Fargo savings account');
    expect(result.institution_name).toBe('Wells Fargo');
    expect(result.type).toBe('savings');
    expect(result.nickname).toBe('Wells Fargo Savings');
  });

  test('returns null when no recognizable account type keyword is present', () => {
    const result = parseAccountMessage('Add my Chase account please');
    expect(result).toBeNull();
  });
});
