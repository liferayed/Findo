const TYPE_KEYWORDS = [
  { pattern: /credit\s*card/i, type: 'credit_card' },
  { pattern: /checking/i, type: 'checking' },
  { pattern: /savings/i, type: 'savings' },
  { pattern: /brokerage/i, type: 'brokerage' },
  { pattern: /loan/i, type: 'loan' },
];

const TYPE_LABELS = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  brokerage: 'Brokerage',
  loan: 'Loan',
};

function looksLikeAccountCreation(text) {
  return /\badd\b.*\baccount\b/i.test(text || '');
}

function findType(text) {
  for (const { pattern, type } of TYPE_KEYWORDS) {
    if (pattern.test(text)) {
      return { type, match: text.match(pattern)[0] };
    }
  }
  return null;
}

function findInstitutionName(text, typeMatch) {
  const beforeType = text.slice(0, text.toLowerCase().indexOf(typeMatch.toLowerCase()));
  const afterMy = beforeType.match(/\bmy\s+(.+?)\s*$/i);
  return afterMy ? afterMy[1].trim() : null;
}

function findExplicitNickname(text) {
  const match = text.match(/\b(?:call it|name it|nickname(?:d)?)\s+([A-Za-z0-9&' -]+)/i);
  return match ? match[1].trim().replace(/[.,]$/, '') : null;
}

function parseAccountMessage(text) {
  const found = findType(text);
  if (!found) {
    return null;
  }

  const institutionName = findInstitutionName(text, found.match);
  if (!institutionName) {
    return null;
  }

  const nickname = findExplicitNickname(text) || `${institutionName} ${TYPE_LABELS[found.type]}`;

  return {
    institution_name: institutionName,
    type: found.type,
    nickname,
  };
}

module.exports = { looksLikeAccountCreation, parseAccountMessage };
