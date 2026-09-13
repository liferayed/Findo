const TRANSACTION_TYPES = ['debit', 'credit'];

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateString) {
  if (!DATE_FORMAT.test(dateString)) {
    return false;
  }
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateTransactionInput(input) {
  const errors = [];
  const { account_id: accountId, transaction_date: transactionDate, amount, type, merchant_raw: merchantRaw } =
    input || {};

  if (typeof accountId !== 'string' || accountId.trim() === '') {
    errors.push('account_id is required');
  }

  if (typeof transactionDate !== 'string' || transactionDate.trim() === '') {
    errors.push('transaction_date is required');
  } else if (!isValidCalendarDate(transactionDate)) {
    errors.push('transaction_date must be a valid date (YYYY-MM-DD)');
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    errors.push('amount must be a positive number');
  }

  if (!TRANSACTION_TYPES.includes(type)) {
    errors.push(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`);
  }

  if (typeof merchantRaw !== 'string' || merchantRaw.trim() === '') {
    errors.push('merchant_raw is required');
  }

  return errors;
}

module.exports = { validateTransactionInput, TRANSACTION_TYPES, isValidCalendarDate };
