const { normalizeMerchant } = require('../transactions/normalizeMerchant');
const { applyTransactionToBalance } = require('../accounts/balance');
const { ValidationError } = require('../errors');
const {
  scoreMatch, scoreMerchantAndDate, amountInAdjustmentRange, MATCH_THRESHOLD, WINDOW_DAYS,
} = require('./scoreMatch');
const { redactText } = require('../redaction/redactSensitive');

const ADJUSTMENT_REASONS = ['tip', 'tax', 'fee', 'other'];

function classify(matches) {
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', candidates: matches };
  }
  return matches[0];
}

// CP-005 slice of F1.8: for one extracted statement row, decide whether it corroborates an
// unconfirmed transaction (exact amount), duplicates a confirmed one, might be the same purchase
// with a different amount (tip/tax/fee — `possible`), is ambiguous, or is new. Read-only:
// writing is the apply* functions' job, so F1.7 can show the outcome in bulk-review before
// anything is committed. Exact-amount matches always take priority over `possible` ones.
async function findMatch(client, { accountId, transactionDate, amount, merchantRaw, excludeIds }) {
  const { rows } = await client.query(
    `SELECT id, account_id, transaction_date, amount, merchant_raw, merchant_normalized, reconciliation_status
     FROM transactions
     WHERE account_id = $1
       AND transaction_date BETWEEN ($2::date - $3::int) AND ($2::date + $3::int)
       AND NOT (id = ANY($4::uuid[]))`,
    [accountId, transactionDate, WINDOW_DAYS, excludeIds || []]
  );

  const extracted = { amount, transactionDate, merchantNormalized: normalizeMerchant(merchantRaw) };

  const exact = rows
    .map((candidate) => ({ candidate, confidence: scoreMatch({ extracted, candidate }) }))
    .filter((m) => m.confidence >= MATCH_THRESHOLD);
  const exactResult = classify(exact);
  if (exactResult) {
    if (exactResult.kind === 'ambiguous') {
      return exactResult;
    }
    const kind = exactResult.candidate.reconciliation_status === 'unconfirmed' ? 'corroborate' : 'duplicate';
    return { kind, candidate: exactResult.candidate, confidence: exactResult.confidence };
  }

  const possible = rows
    .filter((c) => c.reconciliation_status === 'unconfirmed' && amountInAdjustmentRange(c.amount, amount))
    .map((candidate) => ({ candidate, confidence: scoreMerchantAndDate({ extracted, candidate }) }))
    .filter((m) => m.confidence >= MATCH_THRESHOLD);
  const possibleResult = classify(possible);
  if (!possibleResult) {
    return { kind: 'new' };
  }
  if (possibleResult.kind === 'ambiguous') {
    return possibleResult;
  }
  return {
    kind: 'possible',
    candidate: possibleResult.candidate,
    confidence: possibleResult.confidence,
    difference: (Math.round(Number(amount) * 100) - Math.round(Number(possibleResult.candidate.amount) * 100)) / 100,
  };
}

// Exact-amount corroboration. Never touches amount, so it never touches the running balance.
async function applyCorroboration(client, { transactionId, sharedItemId, postedDate, confidence }) {
  const { rowCount } = await client.query(
    `UPDATE transactions SET reconciliation_status = 'confirmed', posted_date = $2
     WHERE id = $1 AND reconciliation_status = 'unconfirmed'`,
    [transactionId, postedDate]
  );
  if (rowCount === 0) {
    throw new ValidationError(['only an unconfirmed transaction can be corroborated']);
  }
  await client.query(
    `INSERT INTO transaction_sources (transaction_id, shared_item_id, role, matched_at, match_confidence)
     VALUES ($1, $2, 'corroboration', now(), $3)`,
    [transactionId, sharedItemId, confidence]
  );
}

// Amount-differs corroboration: the statement is authoritative for the amount (CP-004's ledger
// follows it), the old amount is preserved in original_amount, and the user's tag for the
// difference is stored on the provenance row. Runs on the caller's client so F1.7 can wrap it
// in its confirm transaction; validation happens before any write. The caller MUST run this inside
// BEGIN/COMMIT: the FOR UPDATE lock and the atomicity of the writes only hold inside a transaction.
async function applyAmountCorroboration(
  client,
  { transactionId, sharedItemId, postedDate, statementAmount, confidence, adjustmentReason, adjustmentNote }
) {
  if (!ADJUSTMENT_REASONS.includes(adjustmentReason)) {
    throw new ValidationError([`adjustment reason must be one of: ${ADJUSTMENT_REASONS.join(', ')}`]);
  }
  if (adjustmentReason === 'other' && !(typeof adjustmentNote === 'string' && adjustmentNote.trim())) {
    throw new ValidationError(['a note is required when the adjustment reason is "other"']);
  }

  const { rows } = await client.query(
    'SELECT account_id, amount, reconciliation_status FROM transactions WHERE id = $1 FOR UPDATE',
    [transactionId]
  );
  if (rows.length === 0 || rows[0].reconciliation_status !== 'unconfirmed') {
    throw new ValidationError(['only an unconfirmed transaction can be corroborated with an amount change']);
  }
  const { account_id: accountId, amount: oldAmount } = rows[0];
  // Subtract in SQL on numeric values: JS floats would give e.g. -8.399999999999999.
  const { rows: [{ difference }] } = await client.query(
    'SELECT ($1::numeric - $2::numeric) AS difference', [statementAmount, oldAmount]
  );

  await client.query(
    `UPDATE transactions
     SET original_amount = COALESCE(original_amount, amount), amount = $2,
         posted_date = $3, reconciliation_status = 'confirmed'
     WHERE id = $1`,
    [transactionId, statementAmount, postedDate]
  );
  await applyTransactionToBalance(client, accountId, difference);
  await client.query(
    `INSERT INTO transaction_sources
       (transaction_id, shared_item_id, role, matched_at, match_confidence, adjustment_reason, adjustment_note)
     VALUES ($1, $2, 'corroboration', now(), $3, $4, $5)`,
    [transactionId, sharedItemId, confidence, adjustmentReason, redactText(adjustmentNote) || null]
  );
}

module.exports = { findMatch, applyCorroboration, applyAmountCorroboration, ADJUSTMENT_REASONS };
