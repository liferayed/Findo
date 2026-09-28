const { normalizeStatementPageExtraction } = require('../../src/documents/validateStatementExtraction');

describe('normalizeStatementPageExtraction', () => {
  test('keeps well-formed transactions, drops malformed ones', () => {
    const raw = {
      transactions: [
        { date: '2026-01-13', description: 'COFFEE SHOP', amount: -4.5 },
        { date: 'not-a-date', description: 'BAD ROW', amount: -1 },
        { date: '2026-01-14', description: 'DEPOSIT', amount: '250' },
        { date: '2026-01-15', description: '', amount: -2 },
      ],
      beginning_balance: 100,
      ending_balance: 345.5,
    };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: false });
    expect(result.transactions).toEqual([
      { date: '2026-01-13', description: 'COFFEE SHOP', amount: -4.5 },
      { date: '2026-01-14', description: 'DEPOSIT', amount: 250 },
    ]);
    expect(result.beginningBalance).toBe(100);
    expect(result.endingBalance).toBe(345.5);
  });

  test('null balances stay null (a continuation page must never hallucinate one)', () => {
    const result = normalizeStatementPageExtraction({ transactions: [], beginning_balance: null, ending_balance: null }, { isFirstPage: false });
    expect(result.beginningBalance).toBeNull();
    expect(result.endingBalance).toBeNull();
  });

  test('a completely unreadable page (non-object) normalizes to an empty, all-null result', () => {
    const result = normalizeStatementPageExtraction(null, { isFirstPage: false });
    expect(result.transactions).toEqual([]);
    expect(result.beginningBalance).toBeNull();
    expect(result.endingBalance).toBeNull();
  });

  test('header fields are only read on the first page', () => {
    const raw = { transactions: [], institution_name: 'Chase', last_four: '4432', account_type_text: 'Total Checking' };
    expect(normalizeStatementPageExtraction(raw, { isFirstPage: false }).institutionName).toBeNull();
    expect(normalizeStatementPageExtraction(raw, { isFirstPage: true }).institutionName).toBe('Chase');
  });

  test('credit_card fields default to null when absent, kept individually when present', () => {
    const raw = { transactions: [], credit_card: { due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard).toEqual({ due_date: '2026-02-10', minimum_payment: 35, issuer: null, credit_limit: null, apr: null });
  });

  test('legitimate zero values in credit_card fields are preserved, not treated as absent', () => {
    const raw = { transactions: [], credit_card: { due_date: null, minimum_payment: 0, issuer: null, credit_limit: null, apr: 0 } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard).toEqual({ due_date: null, minimum_payment: 0, issuer: null, credit_limit: null, apr: 0 });
  });

  test('a negative credit_card numeric value is invalid and normalizes to null', () => {
    // minimum_payment: 35 keeps this object from collapsing entirely to null (see the
    // dedicated "every field null" test below), isolating the apr-specific assertion.
    const raw = { transactions: [], credit_card: { due_date: null, minimum_payment: 35, issuer: null, credit_limit: null, apr: -5 } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard.apr).toBeNull();
  });

  test('a last_four that is not exactly 4 digits is discarded', () => {
    const result = normalizeStatementPageExtraction({ transactions: [], last_four: 'CARD' }, { isFirstPage: true });
    expect(result.lastFour).toBeNull();
  });

  test('a due_date with surrounding whitespace is trimmed before validation and storage', () => {
    const raw = { transactions: [], credit_card: { due_date: ' 2026-02-10 ', minimum_payment: null, issuer: null, credit_limit: null, apr: null } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard.due_date).toBe('2026-02-10');
  });

  test('a last_four provided as a number is normalized to a string', () => {
    const result = normalizeStatementPageExtraction({ transactions: [], last_four: 4432 }, { isFirstPage: true });
    expect(result.lastFour).toBe('4432');
  });

  // F1.7 final review I1: a credit_card object where every field normalizes to null must
  // collapse to a plain null, not a loosely-truthy object of nulls — otherwise callers that
  // check `data.creditCard` truthiness (accountOfferService, statementConfirmService) wrongly
  // treat a checking statement as a card statement whenever the model emits an empty credit_card key.
  test('a credit_card object with every field null/absent normalizes to a plain null, not an object of nulls', () => {
    const raw = { transactions: [], credit_card: { due_date: null, minimum_payment: null, issuer: null, credit_limit: null, apr: null } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard).toBeNull();
  });

  test('a credit_card object with at least one non-null field still normalizes to the full object', () => {
    const raw = { transactions: [], credit_card: { due_date: null, minimum_payment: 35, issuer: null, credit_limit: null, apr: null } };
    const result = normalizeStatementPageExtraction(raw, { isFirstPage: true });
    expect(result.creditCard).toEqual({ due_date: null, minimum_payment: 35, issuer: null, credit_limit: null, apr: null });
  });
});
