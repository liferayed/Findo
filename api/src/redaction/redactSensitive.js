// F1.9: data minimization at ingestion. Pure and total — never throws, returns non-string input
// unchanged — so it can sit in front of every write path without adding a failure mode. Rule
// order matters: SSNs and cards are matched before the shorter labelled/bare patterns so a
// 9-digit fragment of an already-handled number can't be re-matched. Already-masked output
// (`****1234`, `[REDACTED]`) never matches again, so redacting twice equals redacting once.

const REDACTED = '[REDACTED]';

function maskLastFour(digits) {
  return `****${digits.slice(-4)}`;
}

function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// ABA routing numbers: valid Federal Reserve prefix plus the 3-7-1 weighted checksum. Both are
// required for a *bare* 9-digit run to be treated as a routing number (design §1, rule 6).
const ROUTING_PREFIX = /^(?:0\d|1[0-2]|2[1-9]|3[0-2]|6[1-9]|7[0-2]|80)/;

function isValidRoutingNumber(digits) {
  if (!/^\d{9}$/.test(digits) || !ROUTING_PREFIX.test(digits)) {
    return false;
  }
  const n = [...digits].map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

function isPlausibleSsn(area, group, serial) {
  return area !== '000' && area !== '666' && area[0] !== '9' && group !== '00' && serial !== '0000';
}

const SSN_FORMATTED = /(?<!\d)(\d{3})([- ])(\d{2})\2(\d{4})(?!\d)/g;
const SSN_LABELLED = /(\b(?:ssn\b|ss#|social\s+security\b)[^\d]{0,20})(\d{9})(?!\d)/gi;
const CARD_CANDIDATE = /(?<![\d-])\d(?:[ -]?\d){12,18}(?!\d)/g;
const ROUTING_LABELLED = /(\b(?:routing|aba|rtn)\b(?:\s*(?:#|no\.?|number|:))*\s*)(\d{9})(?!\d)/gi;
const ACCOUNT_LABELLED = /(\b(?:acct|account|a\/c|chk|sav)\b\.?(?:\s*(?:#|no\.?|number|:))*\s*)(\d{6,17})(?!\d)/gi;
const BARE_NINE_DIGITS = /(?<!\d)\d{9}(?!\d)/g;

function redactText(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .replace(SSN_FORMATTED, (match, area, _sep, group, serial) => (isPlausibleSsn(area, group, serial) ? REDACTED : match))
    .replace(SSN_LABELLED, (_match, label) => `${label}${REDACTED}`)
    .replace(CARD_CANDIDATE, (match) => {
      const digits = match.replace(/\D/g, '');
      return passesLuhn(digits) ? maskLastFour(digits) : match;
    })
    .replace(ROUTING_LABELLED, (_match, label) => `${label}${REDACTED}`)
    .replace(ACCOUNT_LABELLED, (_match, label, digits) => `${label}${maskLastFour(digits)}`)
    .replace(BARE_NINE_DIGITS, (match) => (isValidRoutingNumber(match) ? REDACTED : match));
}

// For the `last_four` form field: a pasted full card/account number is truncated to its last 4
// (accept-and-truncate, F1.9 design §1). Anything that isn't 4–19 digits once spaces/dashes are
// stripped is returned untouched, so validateAccountInput still rejects it as before.
function redactLastFourInput(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const compact = value.trim().replace(/[\s-]/g, '');
  if (/^\d{4,19}$/.test(compact)) {
    return compact.slice(-4);
  }
  return value;
}

module.exports = { redactText, redactLastFourInput };
