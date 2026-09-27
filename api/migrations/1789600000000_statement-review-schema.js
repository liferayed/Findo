exports.shorthands = undefined;

exports.up = (pgm) => {
  // Polling target for GET /documents/:id/status while the worker is running (F1.7 design §1).
  pgm.addColumns('shared_items', {
    progress: { type: 'jsonb' },
  });

  // The full per-page extraction result (transactions, balances, header fields, account
  // resolution state) until the user confirms — nothing lands in `transactions` before that
  // (F1.7 design §1's "nothing written until confirm" rule).
  pgm.addColumns('documents', {
    extracted_data: { type: 'jsonb' },
  });

  // Set only when a bulk-review row was force-created over a flagged `duplicate`/`ambiguous`
  // candidate (F1.7 design §2.4), so a later discrepancy can be traced back to the decision.
  pgm.addColumns('transaction_sources', {
    overridden_candidate_id: { type: 'uuid', references: 'transactions', onDelete: 'SET NULL' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('transaction_sources', ['overridden_candidate_id']);
  pgm.dropColumns('documents', ['extracted_data']);
  pgm.dropColumns('shared_items', ['progress']);
};
