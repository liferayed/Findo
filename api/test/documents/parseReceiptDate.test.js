const { parseReceiptDate } = require('../../src/documents/parseReceiptDate');

// Fixed "now" so "defaults to today" assertions are deterministic.
const NOW = new Date('2026-01-20T12:00:00Z');

describe('parseReceiptDate', () => {
  test('parses explicit MM/DD/YYYY', () => {
    expect(parseReceiptDate('01/15/2026', NOW)).toBe('2026-01-15');
  });

  test('parses explicit MM-DD-YYYY', () => {
    expect(parseReceiptDate('01-15-2026', NOW)).toBe('2026-01-15');
  });

  test('parses explicit YYYY-MM-DD', () => {
    expect(parseReceiptDate('2026-01-15', NOW)).toBe('2026-01-15');
  });

  test('parses single-digit month/day in MM/DD/YYYY', () => {
    expect(parseReceiptDate('1/5/2026', NOW)).toBe('2026-01-05');
  });

  test('null defaults to today', () => {
    expect(parseReceiptDate(null, NOW)).toBe('2026-01-20');
  });

  test('undefined defaults to today', () => {
    expect(parseReceiptDate(undefined, NOW)).toBe('2026-01-20');
  });

  test('empty string defaults to today', () => {
    expect(parseReceiptDate('', NOW)).toBe('2026-01-20');
  });

  test('garbage string defaults to today, never throws', () => {
    expect(() => parseReceiptDate('not a date', NOW)).not.toThrow();
    expect(parseReceiptDate('not a date', NOW)).toBe('2026-01-20');
  });

  test('a relative hint like "today" is not special-cased (not an explicit format) and defaults to today anyway', () => {
    expect(parseReceiptDate('today', NOW)).toBe('2026-01-20');
  });

  test('an impossible calendar date defaults to today rather than throwing', () => {
    expect(parseReceiptDate('13/45/2026', NOW)).toBe('2026-01-20');
  });

  test('a non-string value (e.g. a number) defaults to today, never throws', () => {
    expect(() => parseReceiptDate(20260115, NOW)).not.toThrow();
    expect(parseReceiptDate(20260115, NOW)).toBe('2026-01-20');
  });
});
