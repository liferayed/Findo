const { validateTransactionInput, TRANSACTION_TYPES } = require('../../src/transactions/validateTransactionInput');

describe('validateTransactionInput', () => {
  test('returns no errors for a fully valid debit input', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 42.5,
      type: 'debit',
      merchant_raw: 'Blue Bottle Coffee',
    });
    expect(errors).toEqual([]);
  });

  test('returns no errors for a fully valid credit input', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 42.5,
      type: 'credit',
      merchant_raw: 'Payroll',
    });
    expect(errors).toEqual([]);
  });

  test('requires an account_id', () => {
    const errors = validateTransactionInput({
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('account_id is required');
  });

  test('requires a transaction_date', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('transaction_date is required');
  });

  test('rejects a transaction_date that is not a real calendar date', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-02-30',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('transaction_date must be a valid date (YYYY-MM-DD)');
  });

  test('rejects a transaction_date in the wrong format', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '01/15/2026',
      amount: 10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('transaction_date must be a valid date (YYYY-MM-DD)');
  });

  test('rejects a missing amount', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('amount must be a positive number');
  });

  test('rejects a zero amount', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 0,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('amount must be a positive number');
  });

  test('rejects a negative amount (caller must send a positive magnitude)', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: -10,
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('amount must be a positive number');
  });

  test('rejects a non-numeric amount', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: '10',
      type: 'debit',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain('amount must be a positive number');
  });

  test('rejects type outside debit/credit', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'transfer',
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`);
  });

  test('rejects a missing type', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 10,
      merchant_raw: 'Coffee',
    });
    expect(errors).toContain(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`);
  });

  test('requires a non-blank merchant_raw', () => {
    const errors = validateTransactionInput({
      account_id: 'acc-1',
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'debit',
      merchant_raw: '   ',
    });
    expect(errors).toContain('merchant_raw is required');
  });

  test('collects multiple errors at once', () => {
    const errors = validateTransactionInput({});
    expect(errors).toEqual(
      expect.arrayContaining([
        'account_id is required',
        'transaction_date is required',
        'amount must be a positive number',
        `type must be one of: ${TRANSACTION_TYPES.join(', ')}`,
        'merchant_raw is required',
      ])
    );
  });
});
