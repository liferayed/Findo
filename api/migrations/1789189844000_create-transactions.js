exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('transaction_type', ['debit', 'credit', 'transfer']);
  pgm.createType('reconciliation_status', ['unconfirmed', 'confirmed']);

  pgm.createTable('transactions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    account_id: {
      type: 'uuid',
      notNull: true,
      references: 'accounts',
      onDelete: 'CASCADE',
    },
    transaction_date: {
      type: 'date',
      notNull: true,
    },
    posted_date: {
      type: 'date',
    },
    amount: {
      type: 'numeric',
      notNull: true,
    },
    original_amount: {
      type: 'numeric',
    },
    merchant_raw: {
      type: 'text',
      notNull: true,
    },
    merchant_normalized: {
      type: 'text',
    },
    // No FK constraint yet — `categories` doesn't exist until Phase 2. Plain
    // nullable UUID column per the F1.3 task brief.
    category_id: {
      type: 'uuid',
    },
    type: {
      type: 'transaction_type',
      notNull: true,
    },
    is_manual: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    reconciliation_status: {
      type: 'reconciliation_status',
      notNull: true,
    },
    notes: {
      type: 'text',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('transactions', 'account_id');
};

exports.down = (pgm) => {
  pgm.dropTable('transactions');
  pgm.dropType('reconciliation_status');
  pgm.dropType('transaction_type');
};
