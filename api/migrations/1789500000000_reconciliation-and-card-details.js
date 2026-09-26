exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('adjustment_reason', ['tip', 'tax', 'fee', 'other']);

  // CP-005: F1.7 is the first writer of corroboration rows, so the two columns the schema doc
  // deferred to F1.8 arrive now.
  pgm.addColumns('transaction_sources', {
    matched_at: { type: 'timestamptz' },
    match_confidence: { type: 'numeric' },
    // Set only when an amount-differs match was accepted: the user's label for the difference
    // between the receipt total and the statement charge (CP-005, user decision 2026-09-25).
    adjustment_reason: { type: 'adjustment_reason' },
    adjustment_note: { type: 'text' },
  });
  pgm.addConstraint('transaction_sources', 'adjustment_note_requires_other', {
    check: "adjustment_reason IS DISTINCT FROM 'other' OR (adjustment_note IS NOT NULL AND btrim(adjustment_note) <> '')",
  });

  // CP-006: the table was documented in database-schema.md since F1.2 but never created.
  pgm.createTable('credit_card_details', {
    account_id: { type: 'uuid', primaryKey: true, references: 'accounts', onDelete: 'CASCADE' },
    issuer: { type: 'text' },
    credit_limit: { type: 'numeric' },
    apr: { type: 'numeric' },
    due_date: { type: 'date' },
    minimum_payment: { type: 'numeric' },
    statement_closing_day: { type: 'integer' },
    annual_fee: { type: 'numeric' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('credit_card_details');
  pgm.dropConstraint('transaction_sources', 'adjustment_note_requires_other');
  pgm.dropColumns('transaction_sources', ['matched_at', 'match_confidence', 'adjustment_reason', 'adjustment_note']);
  pgm.dropType('adjustment_reason');
};
