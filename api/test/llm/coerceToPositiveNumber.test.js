const { coerceToPositiveNumber } = require('../../src/llm/coerceToPositiveNumber');

describe('coerceToPositiveNumber', () => {
  test('accepts a genuine positive number', () => {
    expect(coerceToPositiveNumber(11.29)).toBe(11.29);
  });

  test('rejects zero, negative, NaN, and Infinity', () => {
    expect(coerceToPositiveNumber(0)).toBeNull();
    expect(coerceToPositiveNumber(-5)).toBeNull();
    expect(coerceToPositiveNumber(NaN)).toBeNull();
    expect(coerceToPositiveNumber(Infinity)).toBeNull();
  });

  test('coerces a plain numeric string (a real model quirk, not hypothetical)', () => {
    expect(coerceToPositiveNumber('11.29')).toBe(11.29);
  });

  test('coerces a currency-formatted string ($ prefix, thousands commas)', () => {
    expect(coerceToPositiveNumber('$11.29')).toBe(11.29);
    expect(coerceToPositiveNumber('1,234.56')).toBe(1234.56);
  });

  test('rejects a genuinely non-numeric string', () => {
    expect(coerceToPositiveNumber('a lot')).toBeNull();
    expect(coerceToPositiveNumber('fifteen dollars')).toBeNull();
  });

  test('rejects empty/whitespace-only strings', () => {
    expect(coerceToPositiveNumber('')).toBeNull();
    expect(coerceToPositiveNumber('   ')).toBeNull();
  });

  test('rejects null, undefined, booleans, objects, and arrays without throwing', () => {
    expect(coerceToPositiveNumber(null)).toBeNull();
    expect(coerceToPositiveNumber(undefined)).toBeNull();
    expect(coerceToPositiveNumber(true)).toBeNull();
    expect(coerceToPositiveNumber({})).toBeNull();
    expect(coerceToPositiveNumber([])).toBeNull();
  });
});
