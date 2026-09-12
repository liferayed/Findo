exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('document_type', [
    'bank_statement',
    'card_statement',
    'brokerage_statement',
    'receipt',
    'tax_form',
    'loan_statement',
  ]);

  // A specialization of shared_items for anything file-based (F1.6 only ever writes
  // document_type = 'receipt', but the enum covers the statement/tax-form types future
  // features (F1.7+) will use against the same table). 1:1 with shared_items via the unique
  // FK, cascading so deleting a shared_item cleans up its document row too.
  pgm.createTable('documents', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    shared_item_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'shared_items',
      onDelete: 'CASCADE',
    },
    document_type: {
      type: 'document_type',
      notNull: true,
    },
    page_count: {
      type: 'integer',
    },
    parse_confidence: {
      type: 'numeric',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('documents');
  pgm.dropType('document_type');
};
