const { matchAccounts, resolveAccountMatch } = require('../../src/chat/matchAccounts');

const accounts = [
  { id: '1', nickname: 'Chase-Checking', institution_name: 'Chase' },
  { id: '2', nickname: 'Ally-Savings', institution_name: 'Ally' },
];

describe('matchAccounts', () => {
  test('matches on an exact nickname', () => {
    expect(matchAccounts('Chase-Checking', accounts).map((a) => a.id)).toEqual(['1']);
  });

  test('matches when the nickname is a substring of a longer message', () => {
    expect(matchAccounts('paid from my Chase-Checking account', accounts).map((a) => a.id)).toEqual(['1']);
  });

  test('matches on institution_name', () => {
    expect(matchAccounts('Ally', accounts).map((a) => a.id)).toEqual(['2']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(matchAccounts('Wells Fargo', accounts)).toEqual([]);
  });

  test('returns every matching account when the input is ambiguous', () => {
    const bothChecking = [
      { id: '1', nickname: 'Chase-Checking', institution_name: 'Chase' },
      { id: '3', nickname: 'Ally-Checking', institution_name: 'Ally' },
    ];
    expect(
      matchAccounts('checking', bothChecking)
        .map((a) => a.id)
        .sort()
    ).toEqual(['1', '3']);
  });

  test('is case-insensitive', () => {
    expect(matchAccounts('CHASE-checking', accounts).map((a) => a.id)).toEqual(['1']);
  });

  test('handles empty/null input and an empty accounts list without throwing', () => {
    expect(matchAccounts('', accounts)).toEqual([]);
    expect(matchAccounts(null, accounts)).toEqual([]);
    expect(matchAccounts('Chase', [])).toEqual([]);
  });
});

describe('resolveAccountMatch', () => {
  test('returns the single matching account', () => {
    expect(resolveAccountMatch('Chase-Checking', accounts).id).toBe('1');
  });

  test('returns null when there is no match', () => {
    expect(resolveAccountMatch('Wells Fargo', accounts)).toBeNull();
  });

  test('returns null when the match is ambiguous (2+ matches)', () => {
    const bothChecking = [
      { id: '1', nickname: 'Chase-Checking', institution_name: 'Chase' },
      { id: '3', nickname: 'Ally-Checking', institution_name: 'Ally' },
    ];
    expect(resolveAccountMatch('checking', bothChecking)).toBeNull();
  });

  test('returns null for empty/null input', () => {
    expect(resolveAccountMatch('', accounts)).toBeNull();
    expect(resolveAccountMatch(null, accounts)).toBeNull();
  });
});
