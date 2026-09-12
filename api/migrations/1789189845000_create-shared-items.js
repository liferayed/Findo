exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('shared_item_channel', ['chat', 'web_upload', 'web_manual']);
  pgm.createType('shared_item_content_type', ['text', 'file']);
  pgm.createType('shared_item_parse_status', ['pending', 'parsed', 'needs_clarification', 'failed']);

  pgm.createTable('shared_items', {
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
    channel: {
      type: 'shared_item_channel',
      notNull: true,
    },
    content_type: {
      type: 'shared_item_content_type',
      notNull: true,
    },
    raw_text: {
      type: 'text',
    },
    file_ref: {
      type: 'text',
    },
    received_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    parse_status: {
      type: 'shared_item_parse_status',
      notNull: true,
    },
    parsed_summary: {
      type: 'text',
    },
  });

  pgm.createIndex('shared_items', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('shared_items');
  pgm.dropType('shared_item_parse_status');
  pgm.dropType('shared_item_content_type');
  pgm.dropType('shared_item_channel');
};
