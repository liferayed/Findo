const { normalizeReceiptExtraction } = require('../../src/documents/validateReceiptExtraction');

const NOW = new Date('2026-01-20T12:00:00Z');

describe('normalizeReceiptExtraction', () => {
  test('a fully legible extraction is readable and normalized', () => {
    const result = normalizeReceiptExtraction(
      {
        merchant: 'BLUE BOTTLE COFFEE',
        date: '01/15/2026',
        total: 15.75,
        line_items: [
          { description: 'Latte', amount: 5.5 },
          { description: 'Croissant', amount: 4.25 },
          { description: 'Cold Brew', amount: 6.0 },
        ],
      },
      { now: NOW }
    );

    expect(result.isReadable).toBe(true);
    expect(result.total).toBe(15.75);
    expect(result.merchantRaw).toBe('BLUE BOTTLE COFFEE');
    expect(result.transactionDate).toBe('2026-01-15');
    expect(result.lineItems).toHaveLength(3);
    expect(result.summary).toEqual(expect.stringContaining('BLUE BOTTLE COFFEE'));
    expect(result.summary).toEqual(expect.stringContaining('$15.75'));
    expect(result.summary).toEqual(expect.stringContaining('3 items'));
  });

  // The critical correction from the brief: gate purely on `total`, never on a self-reported
  // legibility flag. A response claiming `legible: false` (or omitting it) must still be
  // treated as readable if `total` is a valid positive number.
  test('gates success purely on `total`, ignoring any self-reported legible flag', () => {
    const result = normalizeReceiptExtraction({
      merchant: 'TARGET',
      date: '01/15/2026',
      total: 14.87,
      line_items: [],
      legible: false,
    });

    expect(result.isReadable).toBe(true);
    expect(result.total).toBe(14.87);
  });

  test('total: null is treated as unreadable', () => {
    const result = normalizeReceiptExtraction({ merchant: null, date: null, total: null, line_items: [] });
    expect(result.isReadable).toBe(false);
  });

  test('a missing total key entirely is treated as unreadable', () => {
    const result = normalizeReceiptExtraction({ merchant: 'Some Store' });
    expect(result.isReadable).toBe(false);
  });

  test('a zero or negative total is treated as unreadable (not a real purchase amount)', () => {
    expect(normalizeReceiptExtraction({ total: 0 }).isReadable).toBe(false);
    expect(normalizeReceiptExtraction({ total: -5 }).isReadable).toBe(false);
  });

  test('a non-numeric total is treated as unreadable', () => {
    expect(normalizeReceiptExtraction({ total: 'fifteen dollars' }).isReadable).toBe(false);
    expect(normalizeReceiptExtraction({ total: NaN }).isReadable).toBe(false);
    expect(normalizeReceiptExtraction({ total: Infinity }).isReadable).toBe(false);
  });

  // Real-world regression: the model does not always respect the "number" instruction in the
  // prompt schema. Observed on a real photographed receipt (a Starbucks receipt with a
  // Subtotal/Tax/Gratuity/Total breakdown) — the model returned `"total": "11.29"` as a JSON
  // string instead of a JSON number, which the original strict `typeof === 'number'` check
  // rejected outright, wrongly treating a perfectly legible receipt as unreadable.
  test('a total returned as a numeric string (a real model quirk, not just a hypothetical) is still treated as readable', () => {
    const result = normalizeReceiptExtraction({ merchant: 'Starbucks', total: '11.29', line_items: [] }, { now: NOW });
    expect(result.isReadable).toBe(true);
    expect(result.total).toBe(11.29);
  });

  test('line item amounts returned as numeric strings are also coerced rather than dropped', () => {
    const result = normalizeReceiptExtraction(
      {
        merchant: 'Starbucks',
        total: 11.29,
        line_items: [
          { description: 'Gr Latte', amount: '4.95' },
          { description: 'Cheese Danish', amount: '3.45' },
        ],
      },
      { now: NOW }
    );
    expect(result.lineItems).toEqual([
      { description: 'Gr Latte', amount: 4.95 },
      { description: 'Cheese Danish', amount: 3.45 },
    ]);
  });

  test('a currency-formatted total string ($ prefix, thousands comma) is still coerced correctly', () => {
    expect(normalizeReceiptExtraction({ total: '$11.29' }).total).toBe(11.29);
    expect(normalizeReceiptExtraction({ total: '1,234.56' }).total).toBe(1234.56);
  });

  test('an empty or whitespace-only total string is still treated as unreadable', () => {
    expect(normalizeReceiptExtraction({ total: '' }).isReadable).toBe(false);
    expect(normalizeReceiptExtraction({ total: '   ' }).isReadable).toBe(false);
  });

  test('a null merchant falls back to the literal string "Receipt"', () => {
    const result = normalizeReceiptExtraction({ merchant: null, total: 10, line_items: [] }, { now: NOW });
    expect(result.merchantRaw).toBe('Receipt');
  });

  test('a missing merchant key falls back to "Receipt"', () => {
    const result = normalizeReceiptExtraction({ total: 10 }, { now: NOW });
    expect(result.merchantRaw).toBe('Receipt');
  });

  test('a blank/whitespace merchant falls back to "Receipt"', () => {
    const result = normalizeReceiptExtraction({ merchant: '   ', total: 10 }, { now: NOW });
    expect(result.merchantRaw).toBe('Receipt');
  });

  test('a null/missing date defaults to today via parseReceiptDate', () => {
    const result = normalizeReceiptExtraction({ merchant: 'X', total: 10, date: null }, { now: NOW });
    expect(result.transactionDate).toBe('2026-01-20');
  });

  test('missing line_items defaults to an empty array and a summary without an item count', () => {
    const result = normalizeReceiptExtraction({ merchant: 'X', total: 10 }, { now: NOW });
    expect(result.lineItems).toEqual([]);
    expect(result.summary).toBe('X — $10.00');
  });

  test('a non-array line_items is treated as empty rather than throwing', () => {
    expect(() => normalizeReceiptExtraction({ merchant: 'X', total: 10, line_items: 'not an array' })).not.toThrow();
    expect(normalizeReceiptExtraction({ merchant: 'X', total: 10, line_items: 'not an array' }).lineItems).toEqual([]);
  });

  test('malformed line items (missing amount) are dropped rather than crashing', () => {
    const result = normalizeReceiptExtraction({
      merchant: 'X',
      total: 10,
      line_items: [{ description: 'Good item', amount: 5 }, { description: 'No amount' }, null, 'garbage'],
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]).toEqual({ description: 'Good item', amount: 5 });
  });

  test('a completely garbage/non-object input is treated as unreadable, never throws', () => {
    expect(() => normalizeReceiptExtraction(null)).not.toThrow();
    expect(normalizeReceiptExtraction(null).isReadable).toBe(false);
    expect(normalizeReceiptExtraction(undefined).isReadable).toBe(false);
    expect(normalizeReceiptExtraction('garbage').isReadable).toBe(false);
    expect(normalizeReceiptExtraction(42).isReadable).toBe(false);
  });

  test('a receipt total that does not match the sum of line items is still trusted as-is (no reconciliation)', () => {
    const result = normalizeReceiptExtraction({
      merchant: 'X',
      total: 100,
      line_items: [{ description: 'Item', amount: 5 }],
    });
    expect(result.isReadable).toBe(true);
    expect(result.total).toBe(100);
  });
});
