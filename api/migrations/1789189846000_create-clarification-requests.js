exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('clarification_requests', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    shared_item_id: {
      type: 'uuid',
      notNull: true,
      references: 'shared_items',
      onDelete: 'CASCADE',
    },
    question: {
      type: 'text',
      notNull: true,
    },
    user_response: {
      type: 'text',
    },
    resolved_at: {
      type: 'timestamptz',
    },
    // Not in the vault's original table list for clarification_requests — added the same way
    // accounts/transactions picked up created_at in earlier features (F1.5). Needed to find
    // "the oldest unresolved clarification" for a user deterministically.
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('clarification_requests', 'shared_item_id');
};

exports.down = (pgm) => {
  pgm.dropTable('clarification_requests');
};
