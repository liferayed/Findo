const { parseReceiptDate } = require('./parseReceiptDate');
const { coerceToPositiveNumber } = require('../llm/coerceToPositiveNumber');

const FALLBACK_MERCHANT = 'Receipt';

function normalizedString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeLineItems(rawLineItems) {
  if (!Array.isArray(rawLineItems)) {
    return [];
  }
  return rawLineItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      description: normalizedString(item.description) || 'Item',
      amount: coerceToPositiveNumber(item.amount),
    }))
    .filter((item) => item.amount !== null);
}

function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function buildSummary(merchantRaw, total, lineItems) {
  const base = `${merchantRaw} — ${formatCurrency(total)}`;
  if (lineItems.length === 0) {
    return base;
  }
  return `${base} (${lineItems.length} item${lineItems.length === 1 ? '' : 's'})`;
}

/**
 * Normalizes a raw vision-model receipt extraction into a defensive, fully-typed shape, and
 * decides whether the receipt was actually readable. The model is not perfectly reliable —
 * any field may be missing, malformed, or (per the brief's spike) an unreliable self-reported
 * confidence signal — so every field is treated as untrusted and this never throws.
 *
 * Critical rule from the brief: gate readability purely on whether `total` is a valid
 * positive number. Do NOT look for or trust any self-reported "legible" field — the spike
 * against the real model found it unreliable (one fixture extracted every field correctly but
 * still reported `legible: false`).
 */
function normalizeReceiptExtraction(raw, { now } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const total = coerceToPositiveNumber(source.total);
  const isReadable = total !== null;

  if (!isReadable) {
    return {
      isReadable: false,
      total: null,
      merchantRaw: null,
      transactionDate: null,
      lineItems: [],
      summary: null,
    };
  }

  const merchantRaw = normalizedString(source.merchant) || FALLBACK_MERCHANT;
  const transactionDate = parseReceiptDate(source.date, now);
  const lineItems = normalizeLineItems(source.line_items);
  const summary = buildSummary(merchantRaw, total, lineItems);

  return { isReadable: true, total, merchantRaw, transactionDate, lineItems, summary };
}

module.exports = { normalizeReceiptExtraction };
