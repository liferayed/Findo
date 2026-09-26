const WINDOW_DAYS = 5;
const MATCH_THRESHOLD = 0.6;
const ADJUSTMENT_MAX_RATIO = 1.4;
const MERCHANT_WEIGHT = 0.6;
const DATE_WEIGHT = 0.4;
const MIN_PREFIX_LENGTH = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function tokensMatch(a, b) {
  if (a === b) {
    return true;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PREFIX_LENGTH && longer.startsWith(shorter);
}

// Matched-token count over the smaller token count, so a statement descriptor carrying extra
// city/state tokens still matches a short receipt merchant (and vice versa).
function merchantSimilarity(a, b) {
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return 0;
  }
  const remaining = [...tokensB];
  let matched = 0;
  for (const token of tokensA) {
    const idx = remaining.findIndex((other) => tokensMatch(token, other));
    if (idx !== -1) {
      matched += 1;
      remaining.splice(idx, 1);
    }
  }
  return matched / Math.min(tokensA.length, tokensB.length);
}

// Accepts 'YYYY-MM-DD' strings or Date objects (pg returns `date` columns as local-midnight
// Dates). Both are reduced to a UTC day number so DST can't skew the day count.
function toDayNumber(value) {
  if (value instanceof Date) {
    return Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY);
  }
  const [y, m, d] = value.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function dateProximity(dateA, dateB) {
  const days = Math.abs(toDayNumber(dateA) - toDayNumber(dateB));
  return Math.max(0, 1 - days / WINDOW_DAYS);
}

function scoreMerchantAndDate({ extracted, candidate }) {
  const score =
    MERCHANT_WEIGHT * merchantSimilarity(extracted.merchantNormalized || '', candidate.merchant_normalized || '') +
    DATE_WEIGHT * dateProximity(extracted.transactionDate, candidate.transaction_date);
  // Rounded so the exact-threshold case (merchant 1, date 0 => 0.6) isn't lost to float error.
  return Math.round(score * 1e6) / 1e6;
}

function scoreMatch({ extracted, candidate }) {
  if (Number(candidate.amount) !== Number(extracted.amount)) {
    return 0;
  }
  return scoreMerchantAndDate({ extracted, candidate });
}

// The amount-differs case (typically a tip, tax or fee added between receipt and statement).
// Signed amounts: debits are negative, so compare magnitudes but require the same sign.
// Note: the ADJUSTMENT_MAX_RATIO (1.4 == 14/10) is applied using integer cents to avoid float errors.
function amountInAdjustmentRange(candidateAmount, statementAmount) {
  const candidate = Number(candidateAmount);
  const statement = Number(statementAmount);
  if (candidate === 0 || statement === 0 || Math.sign(candidate) !== Math.sign(statement)) {
    return false;
  }
  // Convert to integer cents to avoid float comparison errors (e.g., 3*1.4 = 4.199999999999999)
  const c = Math.round(Math.abs(candidate) * 100);
  const s = Math.round(Math.abs(statement) * 100);
  return s > c && s * 10 <= c * 14;
}

module.exports = {
  WINDOW_DAYS, MATCH_THRESHOLD, ADJUSTMENT_MAX_RATIO,
  merchantSimilarity, dateProximity, scoreMerchantAndDate, scoreMatch, amountInAdjustmentRange,
};
