const { coerceToPositiveNumber } = require('../llm/coerceToPositiveNumber');

const VALID_TYPES = new Set(['debit', 'credit']);

function normalizedString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Normalizes a raw LLM extraction result into a defensive, fully-typed shape, and decides
 * whether it describes an actionable transaction. The model is not perfectly reliable — any
 * field may be missing (not just null), malformed, or out of range — so every field is
 * treated as untrusted and this never throws, regardless of input shape.
 *
 * "Actionable" per the brief's decision tree: `is_transaction` is `true` AND `amount` is a
 * positive number AND `type` is exactly "debit" or "credit". Anything else (including a
 * completely missing/garbage object) is not actionable.
 */
function normalizeExtraction(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const isTransaction = source.is_transaction === true;
  const amount = coerceToPositiveNumber(source.amount);
  const type = VALID_TYPES.has(source.type) ? source.type : null;
  const merchant = normalizedString(source.merchant);
  const dateHint = normalizedString(source.date_hint);
  const accountHint = normalizedString(source.account_hint);

  // coerceToPositiveNumber's own contract already guarantees `amount` is either null or a
  // genuinely positive finite number — no need to re-check `> 0` here.
  const hasUsableAmount = amount !== null;
  const isActionable = isTransaction && hasUsableAmount && type !== null;

  return {
    isTransaction,
    isActionable,
    amount,
    merchant,
    type,
    dateHint,
    accountHint,
  };
}

module.exports = { normalizeExtraction };
