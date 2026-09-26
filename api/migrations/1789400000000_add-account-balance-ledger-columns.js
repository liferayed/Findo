exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('accounts', {
    opening_balance: { type: 'numeric', notNull: true, default: 0 },
    balance_as_of_date: { type: 'date' },
  });
  // Pre-existing accounts can't have their transaction history reconstructed, so
  // their anchor is whatever current_balance holds today (CP-004 §1).
  pgm.sql('UPDATE accounts SET opening_balance = current_balance');
};

exports.down = (pgm) => {
  pgm.dropColumns('accounts', ['opening_balance', 'balance_as_of_date']);
};
