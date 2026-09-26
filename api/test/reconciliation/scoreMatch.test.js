const {
  WINDOW_DAYS, MATCH_THRESHOLD, merchantSimilarity, dateProximity, scoreMatch, scoreMerchantAndDate, amountInAdjustmentRange,
} = require('../../src/reconciliation/scoreMatch');

describe('merchantSimilarity', () => {
  test('identical', () => expect(merchantSimilarity('blue bottle', 'blue bottle')).toBe(1));
  test('processor-truncated token matches by prefix', () => {
    expect(merchantSimilarity('blue bottle cof', 'blue bottle coffee')).toBe(1);
  });
  test('statement descriptor with extra city/state tokens still matches receipt', () => {
    expect(merchantSimilarity('trader joe s sunnyvale ca', 'trader joe s')).toBe(1);
  });
  test('unrelated merchants score 0', () => {
    expect(merchantSimilarity('shell oil', 'blue bottle coffee')).toBe(0);
  });
  test('empty input scores 0', () => expect(merchantSimilarity('', 'blue bottle')).toBe(0));
  test('two-letter tokens only match when equal', () => {
    expect(merchantSimilarity('ca', 'cafe')).toBe(0);
  });
});

describe('dateProximity', () => {
  test('same day is 1', () => expect(dateProximity('2026-01-10', '2026-01-10')).toBe(1));
  test('edge of window is 0', () => expect(dateProximity('2026-01-10', '2026-01-15')).toBe(0));
  test('beyond window floors at 0', () => expect(dateProximity('2026-01-10', '2026-02-10')).toBe(0));
  test('symmetric', () => expect(dateProximity('2026-01-12', '2026-01-10')).toBeCloseTo(0.6));
  test('WINDOW_DAYS is 5', () => expect(WINDOW_DAYS).toBe(5));
});

describe('scoreMatch / scoreMerchantAndDate', () => {
  const extracted = { amount: -48.23, transactionDate: '2026-01-14', merchantNormalized: 'target' };

  test('different amount is never an exact match', () => {
    const c = { amount: -48.24, transaction_date: '2026-01-14', merchant_normalized: 'target' };
    expect(scoreMatch({ extracted, candidate: c })).toBe(0);
    expect(scoreMerchantAndDate({ extracted, candidate: c })).toBe(1);
  });
  test('same amount, same merchant, 2 days apart clears the threshold', () => {
    const c = { amount: '-48.23', transaction_date: '2026-01-12', merchant_normalized: 'target' };
    expect(scoreMatch({ extracted, candidate: c })).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  test('same amount but unrelated merchant on the same day stays below the threshold', () => {
    const c = { amount: -48.23, transaction_date: '2026-01-14', merchant_normalized: 'shell oil' };
    expect(scoreMatch({ extracted, candidate: c })).toBeLessThan(MATCH_THRESHOLD);
  });
  test('accepts a Date for candidate.transaction_date', () => {
    const c = { amount: -48.23, transaction_date: new Date(2026, 0, 14), merchant_normalized: 'target' };
    expect(scoreMatch({ extracted, candidate: c })).toBe(1);
  });
});

describe('amountInAdjustmentRange', () => {
  test('tip-sized increase (debits are negative) is in range', () => {
    expect(amountInAdjustmentRange(-42, -50.4)).toBe(true);
  });
  test('exactly 1.4x is in range', () => expect(amountInAdjustmentRange(-100, -140)).toBe(true));
  test('over 1.4x is out of range', () => expect(amountInAdjustmentRange(-100, -140.01)).toBe(false));
  test('statement lower than the receipt is out of range', () => {
    expect(amountInAdjustmentRange(-42, -40)).toBe(false);
  });
  test('equal amounts are not an adjustment', () => expect(amountInAdjustmentRange(-42, -42)).toBe(false));
  test('opposite signs are out of range', () => expect(amountInAdjustmentRange(-42, 50)).toBe(false));
  test('accepts numeric strings as returned by pg', () => {
    expect(amountInAdjustmentRange('-42.00', -50.4)).toBe(true);
  });
  test('zero is out of range', () => expect(amountInAdjustmentRange(0, -5)).toBe(false));
});
