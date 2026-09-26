const { normalizeMerchant } = require('../../src/transactions/normalizeMerchant');

describe('normalizeMerchant', () => {
  test.each([
    ["Trader Joe's #204", 'trader joe s'],
    ['TRADER JOE S #204 SUNNYVALE CA', 'trader joe s sunnyvale ca'],
    ['SQ *BLUE BOTTLE COF', 'blue bottle cof'],
    ['TST* Sweetgreen', 'sweetgreen'],
    ['  Blue   Bottle  Coffee ', 'blue bottle coffee'],
    ['AMZN Mktp US*2K4 123', 'amzn mktp us 2k4'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  test('returns empty string for empty or non-string input', () => {
    expect(normalizeMerchant('')).toBe('');
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant(undefined)).toBe('');
  });
});
