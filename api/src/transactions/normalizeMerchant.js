const PROCESSOR_PREFIX = /^(sq|tst|pp|sp)\s*\*\s*|^sp\s+/;

// Produces the comparison key stored in transactions.merchant_normalized. Deliberately
// simple: it removes noise (processor prefixes, store numbers, punctuation, case) but keeps
// every real word, leaving fuzzy matching to reconciliation/scoreMatch.js. The F1.9 redaction
// marker [REDACTED] is dropped so it can't create false reconciliation matches.
function normalizeMerchant(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw
    .toLowerCase()
    .replace(/\[redacted\]/g, ' ')
    .trim()
    .replace(PROCESSOR_PREFIX, '')
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !/^\d+$/.test(token))
    .join(' ');
}

module.exports = { normalizeMerchant };
