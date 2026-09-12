const { normalizeExtraction } = require('../../src/chat/validateExtraction');

describe('normalizeExtraction', () => {
  test('a clean actionable debit extraction is actionable and normalized', () => {
    const result = normalizeExtraction({
      is_transaction: true,
      amount: 12.5,
      merchant: 'Starbucks',
      type: 'debit',
      date_hint: 'today',
      account_hint: null,
    });

    expect(result.isActionable).toBe(true);
    expect(result.amount).toBe(12.5);
    expect(result.merchant).toBe('Starbucks');
    expect(result.type).toBe('debit');
    expect(result.dateHint).toBe('today');
    expect(result.accountHint).toBeNull();
  });

  test('missing keys (not just null) are treated as null, not thrown', () => {
    const result = normalizeExtraction({ is_transaction: true, amount: 20, type: 'credit' });

    expect(result.merchant).toBeNull();
    expect(result.dateHint).toBeNull();
    expect(result.accountHint).toBeNull();
    expect(result.isActionable).toBe(true);
  });

  test('is_transaction: false is never actionable regardless of other fields', () => {
    const result = normalizeExtraction({ is_transaction: false, amount: 20, type: 'debit', merchant: 'Amazon' });
    expect(result.isActionable).toBe(false);
  });

  test('is_transaction: true with a missing/non-positive amount is rejected as not-actionable', () => {
    expect(normalizeExtraction({ is_transaction: true, amount: 0, type: 'debit' }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, amount: -5, type: 'debit' }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, amount: null, type: 'debit' }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, type: 'debit' }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, amount: 'a lot', type: 'debit' }).isActionable).toBe(false);
  });

  // Proactive fix, not (yet) an observed chat-side failure: F1.6's receipt parser hit the exact
  // same bug class (a numeric field returned as a JSON string by a "number"-schema'd model) on
  // a real photo. Applying the same coercion here before this codebase hits it for chat too.
  test('an amount returned as a numeric string is still treated as actionable', () => {
    const result = normalizeExtraction({ is_transaction: true, amount: '12.50', type: 'debit' });
    expect(result.isActionable).toBe(true);
    expect(result.amount).toBe(12.5);
  });

  test('a missing or invalid type value is rejected as not-actionable', () => {
    expect(normalizeExtraction({ is_transaction: true, amount: 10, type: 'transfer' }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, amount: 10, type: null }).isActionable).toBe(false);
    expect(normalizeExtraction({ is_transaction: true, amount: 10 }).isActionable).toBe(false);
  });

  test('handles a completely empty/garbage input without throwing', () => {
    expect(() => normalizeExtraction({})).not.toThrow();
    expect(() => normalizeExtraction(null)).not.toThrow();
    expect(() => normalizeExtraction(undefined)).not.toThrow();
    expect(normalizeExtraction(null).isActionable).toBe(false);
    expect(normalizeExtraction(undefined).isActionable).toBe(false);
  });

  test('a blank-string merchant/date_hint/account_hint normalizes to null', () => {
    const result = normalizeExtraction({
      is_transaction: true,
      amount: 5,
      type: 'debit',
      merchant: '   ',
      date_hint: '',
      account_hint: '  ',
    });
    expect(result.merchant).toBeNull();
    expect(result.dateHint).toBeNull();
    expect(result.accountHint).toBeNull();
  });
});
