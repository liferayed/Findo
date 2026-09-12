exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('account_type', ['checking', 'savings', 'credit_card', 'brokerage', 'loan']);

  pgm.createTable('accounts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    type: {
      type: 'account_type',
      notNull: true,
    },
    institution_name: {
      type: 'text',
      notNull: true,
    },
    nickname: {
      type: 'text',
      notNull: true,
    },
    last_four: {
      type: 'text',
    },
    current_balance: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    currency: {
      type: 'text',
      notNull: true,
      default: 'USD',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    last_updated_at: {
      type: 'timestamptz',
    },
    last_source_shared_item_id: {
      type: 'uuid',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Duplicate nickname for the same user is rejected (F1.2 edge case) rather than
  // silently creating a second account.
  pgm.addConstraint('accounts', 'accounts_user_id_nickname_key', {
    unique: ['user_id', 'nickname'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('accounts');
  pgm.dropType('account_type');
};
