const { isValidCalendarDate } = require('../transactions/validateTransactionInput');

function coerceToNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}

function coerceToNullableString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Unlike coerceToPositiveNumber (still used by receipts, where a total is always positive),
// credit-card fields such as a 0% promotional APR or a $0 minimum payment due are legitimate
// zero values, not absent data. Only negative/non-finite/non-numeric values normalize to null.
function coerceToNullableNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num >= 0 ? num : null;
}

function normalizeTransactionRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const date = coerceToNullableString(row.date);
  const description = coerceToNullableString(row.description);
  const amount = coerceToNumber(row.amount);
  if (!date || !isValidCalendarDate(date) || !description || amount === null) {
    return null;
  }
  return { date, description, amount };
}

function normalizeCreditCardFields(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const dueDate = coerceToNullableString(raw.due_date);
  return {
    due_date: dueDate && isValidCalendarDate(dueDate) ? dueDate : null,
    minimum_payment: coerceToNullableNumber(raw.minimum_payment),
    issuer: coerceToNullableString(raw.issuer),
    credit_limit: coerceToNullableNumber(raw.credit_limit),
    apr: coerceToNullableNumber(raw.apr),
  };
}

// Defensive normalization of one page's raw model output — mirrors validateReceiptExtraction's
// per-field coercion, not a schema validator that rejects the whole page. A malformed
// transaction row is dropped, not fatal; header fields are only read when isFirstPage (the
// worker only asks for them on page 1, per the design doc's extraction schema).
function normalizeStatementPageExtraction(raw, { isFirstPage } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const transactions = Array.isArray(source.transactions)
    ? source.transactions.map(normalizeTransactionRow).filter(Boolean)
    : [];

  return {
    transactions,
    beginningBalance: coerceToNumber(source.beginning_balance),
    endingBalance: coerceToNumber(source.ending_balance),
    institutionName: isFirstPage ? coerceToNullableString(source.institution_name) : null,
    accountTypeText: isFirstPage ? coerceToNullableString(source.account_type_text) : null,
    lastFour: (() => {
      const lastFourStr = typeof source.last_four === 'string' ? source.last_four : String(source.last_four ?? '');
      return isFirstPage && /^\d{4}$/.test(lastFourStr) ? lastFourStr : null;
    })(),
    creditCard: isFirstPage ? normalizeCreditCardFields(source.credit_card) : null,
  };
}

module.exports = { normalizeStatementPageExtraction };
