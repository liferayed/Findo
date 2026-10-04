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
    ['exp 4111111111111111 05/27', 'exp ****1111 05/27'],
    ['paid 4111111111111111 25.00', 'paid ****1111 25.00'],
    ['cvv 4111 1111 1111 1111 123', 'cvv ****1111 123'],
    ['zip 94105 4111111111111111', 'zip 94105 ****1111'],
    ['two 4111111111111111 4111111111111111', 'two ****1111 ****1111'],
    ['amex 3782-822463-10005 exp', 'amex ****0005 exp'],
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
    ['zip 94105 4111 1111 1111 1111', 'zip 94105 ****1111'],
    ['REF 1234 4111 1111 1111 1111', 'REF 1234 ****1111'],
    ['1234-4111-1111-1111-1111', '1234-****1111'],
    ['zip 94105 4111-1111-1111-1111 exp 05 27', 'zip 94105 ****1111 exp 05 27'],
    ['three 4111 1111 1111 1111 378282246310005 4000000000000000006', 'three ****1111 ****0005 ****0006'],
    ['checking 000123456789', 'checking ****6789'],
    ['stmt-4111111111111111.pdf', 'stmt-****1111.pdf'],
    ['receipt-4111111111111111.png', 'receipt-****1111.png'],
    ['VISA-4111111111111111', 'VISA-****1111'],
    ['Card-4111-1111-1111-1111', 'Card-****1111'],
    ['REF-4111 1111 1111 1111', 'REF-****1111'],
    ['AMEX-378282246310005', 'AMEX-****0005'],
    ['savings acct 000123456789', 'savings acct ****6789'],
    ['acct ending in 000123456789', 'acct ending in ****6789'],
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
    'items 1234 5678 9012 3456 7',
    'qty 12 34 56 78 90 12 34',
    '20-digit 41111111111111111111',
    'Total Checking 2026 statement',
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

// Seeded (mulberry32) so these property tests are deterministic — never flaky.
function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luhnCheckDigit(body) {
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    let d = Number(body[i]);
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

describe('redactText — properties', () => {
  test('a grouped card next to other digit groups never keeps 8+ of its digits in place', () => {
    const random = seededRandom(19);
    const int = (n) => Math.floor(random() * n);
    const digitString = (n) => Array.from({ length: n }, () => int(10)).join('');
    const leaks = [];
    for (let i = 0; i < 5000; i += 1) {
      const body = String(3 + int(4)) + digitString(14);
      const card = body + luhnCheckDigit(body);
      const grouped = card.match(/.{1,4}/g).join(int(2) ? ' ' : '-');
      const prefix = [digitString(5), digitString(4), digitString(3), '', 'VISA-', 'stmt-', `${digitString(4)}-`][int(7)];
      const suffix = ['', ` ${digitString(2)} ${digitString(2)}`, ` ${digitString(3)}`][int(3)];
      const text = prefix.endsWith('-') && int(2) ? `ref ${prefix}${grouped}${suffix} end` : `ref ${prefix} ${grouped}${suffix} end`;
      const compact = redactText(text).replace(/[ -]/g, '');
      if ([card.slice(0, 8), card.slice(4, 12), card.slice(8)].some((part) => compact.includes(part))) {
        leaks.push(text);
      }
    }
    expect(leaks).toEqual([]);
  });

  test('redacting twice always equals redacting once', () => {
    const random = seededRandom(7);
    const int = (n) => Math.floor(random() * n);
    const changed = [];
    for (let i = 0; i < 5000; i += 1) {
      const groups = Array.from({ length: 2 + int(7) }, () => Array.from({ length: 1 + int(7) }, () => int(10)).join(''));
      const text = `x ${groups.map((g, j) => (j ? (int(2) ? ' ' : '-') : '') + g).join('')}`;
      const once = redactText(text);
      if (redactText(once) !== once) {
        changed.push(text);
      }
    }
    expect(changed).toEqual([]);
  });

  test('redacting twice equals redacting once across mixed rule types', () => {
    const random = seededRandom(23);
    const int = (n) => Math.floor(random() * n);
    const digitString = (n) => Array.from({ length: n }, () => int(10)).join('');
    const tokens = [
      () => 'SSN', () => 'ss#', () => 'social security', () => 'routing', () => 'acct', () => 'checking', () => 'ending in',
      () => 'VISA-', () => ':', () => '#', () => digitString(9), () => digitString(9),
      () => `${digitString(3)}-${digitString(2)}-${digitString(4)}`,
      () => digitString(4), () => digitString(4), () => digitString(12), () => digitString(16), () => 'TRANSFER',
    ];
    const changed = [];
    for (let i = 0; i < 5000; i += 1) {
      const text = Array.from({ length: 3 + int(8) }, () => tokens[int(tokens.length)]()).join([' ', ' ', '-'][int(3)]);
      const once = redactText(text);
      if (redactText(once) !== once) {
        changed.push(text);
      }
    }
    expect(changed).toEqual([]);
  });
});
