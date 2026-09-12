exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('transaction_source_role', ['origin', 'corroboration', 'amendment']);

  // Created by F1.5 (chat transaction capture) so every chat-originated transaction can be
  // tied back to its source shared_item via a role='origin' row — this table is nominally
  // scoped to the later F1.8 (Cross-Source Deduplication & Reconciliation) feature, but F1.5
  // needs the origin link now to satisfy its own Definition of Done. F1.8 adds the
  // matching/scoring logic and corroboration/amendment rows on top of this table later; it
  // does not create the table from scratch.
  pgm.createTable('transaction_sources', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    transaction_id: {
      type: 'uuid',
      notNull: true,
      references: 'transactions',
      onDelete: 'CASCADE',
    },
    shared_item_id: {
      type: 'uuid',
      notNull: true,
      references: 'shared_items',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'transaction_source_role',
      notNull: true,
    },
  });

  pgm.createIndex('transaction_sources', 'transaction_id');
  pgm.createIndex('transaction_sources', 'shared_item_id');
};

exports.down = (pgm) => {
  pgm.dropTable('transaction_sources');
  pgm.dropType('transaction_source_role');
};
