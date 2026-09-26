exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('accounts', {
    opening_balance: { type: 'numeric', notNull: true, default: 0 },
    balance_as_of_date: { type: 'date' },
  });
  // opening_balance anchors what the balance was before any recorded
  // transaction, so it is seeded from today's current_balance (order matters:
  // this runs first). current_balance then becomes live by including all
  // existing transactions, so opening_balance + SUM(transactions) = current_balance.
  pgm.sql('UPDATE accounts SET opening_balance = current_balance');
  pgm.sql(
    'UPDATE accounts a SET current_balance = a.current_balance + ' +
      'COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id), 0)',
  );
};

exports.down = (pgm) => {
  // Drops the columns only; it does NOT undo the current_balance change from up.
  pgm.dropColumns('accounts', ['opening_balance', 'balance_as_of_date']);
};
