const { resolveDateHint } = require('../../src/chat/resolveDateHint');

describe('resolveDateHint', () => {
  const reference = new Date('2026-06-15T12:00:00Z');

  test('"today" resolves to the reference date', () => {
    expect(resolveDateHint('today', reference)).toBe('2026-06-15');
  });

  test('"yesterday" resolves to one day before the reference date', () => {
    expect(resolveDateHint('yesterday', reference)).toBe('2026-06-14');
  });

  test('is case-insensitive on the relative-date words', () => {
    expect(resolveDateHint('Today', reference)).toBe('2026-06-15');
    expect(resolveDateHint('YESTERDAY', reference)).toBe('2026-06-14');
  });

  test('an explicit parseable date (YYYY-MM-DD) is used as-is', () => {
    expect(resolveDateHint('2026-06-01', reference)).toBe('2026-06-01');
  });

  test('an explicit parseable date in a different format is normalized to YYYY-MM-DD', () => {
    expect(resolveDateHint('June 1, 2026', reference)).toBe('2026-06-01');
  });

  test('null defaults to the reference date', () => {
    expect(resolveDateHint(null, reference)).toBe('2026-06-15');
  });

  test('undefined (missing key) defaults to the reference date', () => {
    expect(resolveDateHint(undefined, reference)).toBe('2026-06-15');
  });

  test('an empty string defaults to the reference date', () => {
    expect(resolveDateHint('', reference)).toBe('2026-06-15');
  });

  test('garbage input (e.g. the observed "on Checking" quirk) defaults to the reference date instead of throwing', () => {
    expect(() => resolveDateHint('on Checking', reference)).not.toThrow();
    expect(resolveDateHint('on Checking', reference)).toBe('2026-06-15');
  });

  test('a non-string date_hint defaults to the reference date instead of throwing', () => {
    expect(() => resolveDateHint(12345, reference)).not.toThrow();
    expect(resolveDateHint(12345, reference)).toBe('2026-06-15');
  });
});
