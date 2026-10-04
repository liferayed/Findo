const { redactText, redactLastFourInput } = require('../../src/redaction/redactSensitive');

describe('redactText', () => {
  test.each([
    // card numbers: Luhn-valid, 13–19 digits, any grouping, masked to last 4
    ['Visa 4111111111111111', 'Visa ****1111'],
    ['Visa 4111 1111 1111 1111', 'Visa ****1111'],
    ['Visa 4111-1111-1111-1111', 'Visa ****1111'],
    ['Amex 378282246310005', 'Amex ****0005'],
    ['card 4000000000000000006', 'card ****0006'],
    ['stmt_4111111111111111.pdf', 'stmt_****1111.pdf'],
    // SSNs: removed entirely
    ['SSN 123-45-6789', 'SSN [REDACTED]'],
    ['ssn 123 45 6789', 'ssn [REDACTED]'],
    ['SSN: 123456789', 'SSN: [REDACTED]'],
    ['SS# 123456789', 'SS# [REDACTED]'],
    ['social security number is 123456789', 'social security number is [REDACTED]'],
    // routing numbers: removed entirely, labelled or bare-and-ABA-valid
    ['routing 021000021', 'routing [REDACTED]'],
    ['bare 021000021 here', 'bare [REDACTED] here'],
    // labelled account numbers: masked to last 4, keyword kept
    ['acct #000123456789', 'acct #****6789'],
    ['ONLINE TRANSFER TO CHK 123456789 REF', 'ONLINE TRANSFER TO CHK ****6789 REF'],
    ['ZELLE TO JOHN ACCT: 987654321', 'ZELLE TO JOHN ACCT: ****4321'],
    ['Routing #: 021000021 account 000123456789', 'Routing #: [REDACTED] account ****6789'],
  ])('redacts %j', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  test.each([
    'ORDER 4111111111111112', // 16 digits but Luhn-invalid
    'call 555-123-4567',
    'ZIP 94105-1234',
    'on 2026-01-14 for $1,234.56',
    'REF 12345678', // unlabelled — deliberately survives (design §1 trade-off)
    'ref 123456789', // 9 digits but not a valid ABA routing number
    'paid ****4821 and XXXX4821',
    'already [REDACTED] here',
    'SSN 000-12-3456', // impossible SSN (area 000)
    'AMAZON MKTPLACE PMTS AMZN.COM/BILL WA',
  ])('leaves %j unchanged', (input) => {
    expect(redactText(input)).toBe(input);
  });

  test('is idempotent — redacting twice equals redacting once', () => {
    const input = 'card 4111 1111 1111 1111 routing 021000021 acct 000123456789 SSN 123-45-6789';
    const once = redactText(input);
    expect(once).toBe('card ****1111 routing [REDACTED] acct ****6789 SSN [REDACTED]');
    expect(redactText(once)).toBe(once);
  });

  test('returns non-string input unchanged', () => {
    expect(redactText(null)).toBeNull();
    expect(redactText(undefined)).toBeUndefined();
    expect(redactText(42)).toBe(42);
  });
});

describe('redactLastFourInput', () => {
  test.each([
    ['4821', '4821'],
    ['12 34', '1234'],
    ['4111 1111 1111 1111', '1111'],
    ['4111-1111-1111-1111', '1111'],
    ['12345', '2345'],
    ['4111111111111111111', '1111'],
  ])('%j becomes %j', (input, expected) => {
    expect(redactLastFourInput(input)).toBe(expected);
  });

  test.each(['41111111111111111111', 'abcd', '12a4', ''])('%j is returned unchanged for the validator to judge', (input) => {
    expect(redactLastFourInput(input)).toBe(input);
  });

  test('returns non-string input unchanged', () => {
    expect(redactLastFourInput(null)).toBeNull();
    expect(redactLastFourInput(undefined)).toBeUndefined();
  });
});
