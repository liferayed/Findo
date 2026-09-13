exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('shared_items', {
    original_filename: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('shared_items', 'original_filename');
};
