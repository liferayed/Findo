/**
 * Case-insensitive, bidirectional substring match against each account's `nickname` and
 * `institution_name`: a candidate matches if the (lowercased) input contains the (lowercased)
 * field, or vice versa. Used both for resolving an extraction's `account_hint` and for
 * resolving a user's reply while a clarification is pending — same rule either way.
 */
function matchAccounts(inputText, accounts) {
  const input = typeof inputText === 'string' ? inputText.trim().toLowerCase() : '';
  if (input === '' || !Array.isArray(accounts)) {
    return [];
  }

  const fieldMatches = (field) => {
    if (typeof field !== 'string' || field.trim() === '') {
      return false;
    }
    const lowerField = field.toLowerCase();
    return input.includes(lowerField) || lowerField.includes(input);
  };

  return accounts.filter((account) => fieldMatches(account.nickname) || fieldMatches(account.institution_name));
}

/**
 * Resolves to exactly one account, or null if the input matched zero or more than one
 * (both are "not resolved" — the caller falls back to the clarification loop either way).
 */
function resolveAccountMatch(inputText, accounts) {
  const matches = matchAccounts(inputText, accounts);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { matchAccounts, resolveAccountMatch };
