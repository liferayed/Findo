const { findMatch, applyCorroboration, applyAmountCorroboration } = require('../reconciliation/reconciliationService');
const { upsertCreditCardDetails } = require('../accounts/creditCardDetailsService');
const { ValidationError, NotFoundError } = require('../errors');

const ADJUSTMENT_REASONS = ['tip', 'tax', 'fee', 'other'];

// F1.7 Task 8: the atomic "confirm & save" write. Everything a bulk-review batch produces —
// new transactions, corroboration/amendment updates to existing ones, credit-card detail
// upserts — lands inside a single BEGIN/COMMIT so a statement is either fully applied or not
// applied at all (F1.7 design's "nothing written until confirm" rule, completed here).
function createStatementConfirmService({ pool, transactionsService }) {
  async function loadReadyRow(client, userId, sharedItemId) {
    // Lock BOTH si and d: the replay guard below reads d.extracted_data, and locking only si
    // (the earlier bug) lets a second concurrent call, once unblocked, still see the pre-confirm
    // extracted_data — Postgres only re-fetches the row(s) named in FOR UPDATE OF after the wait,
    // not every joined table. Locking d too forces the re-read to pick up the just-committed
    // confirmedAt from the first call.
    const { rows } = await client.query(
      `SELECT si.parse_status, d.extracted_data, d.document_type FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       WHERE si.id = $1 AND si.user_id = $2 FOR UPDATE OF si, d`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    const { parse_status: parseStatus, extracted_data: data, document_type: documentType } = rows[0];
    if (parseStatus !== 'parsed' || !data.resolvedAccountId) {
      throw new ValidationError(['this statement is not ready to confirm']);
    }
    // parse_status stays 'parsed' after a successful confirm by design (F1.7 §2.4), so a
    // replay/double-submit of confirm has to be caught here via confirmedAt, before any writes —
    // otherwise it would double-insert transactions and double-move the balance.
    if (data.confirmedAt) {
      throw new ValidationError(['this statement has already been confirmed']);
    }
    return { data, documentType };
  }

  async function confirmReview(userId, sharedItemId, selections) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { data, documentType } = await loadReadyRow(client, userId, sharedItemId);
      const accountId = data.resolvedAccountId;
      const selectionByIndex = new Map(selections.map((s) => [s.index, s]));
      const excludeIds = [];

      for (let index = 0; index < data.transactions.length; index += 1) {
        const row = data.transactions[index];
        const match = await findMatch(client, { accountId, transactionDate: row.date, amount: row.amount, merchantRaw: row.description, excludeIds });
        const selection = selectionByIndex.get(index);

        if (match.kind === 'corroborate') {
          await applyCorroboration(client, { transactionId: match.candidate.id, sharedItemId, postedDate: row.date, confidence: match.confidence });
          excludeIds.push(match.candidate.id);
          continue;
        }

        if (selection) {
          if (!['new', 'force', 'tag'].includes(selection.action)) {
            throw new ValidationError([`action must be one of: new, force, tag`]);
          }
          // Validate the requested action against the row's *actual* match kind — fail fast,
          // before any write, so a mismatched action rolls back the whole batch instead of
          // either crashing (tag with no candidate) or silently doing the wrong thing.
          if (selection.action === 'tag' && match.kind !== 'possible') {
            throw new ValidationError(['tag requires a possible match']);
          }
          if (selection.action === 'force' && match.kind !== 'duplicate' && match.kind !== 'ambiguous') {
            throw new ValidationError(['force is only valid for a duplicate or ambiguous match']);
          }
          if (selection.action === 'new' && match.kind !== 'new') {
            throw new ValidationError(['new is only valid when no match was found']);
          }
        }

        if (!selection) {
          // Pre-unchecked (duplicate/possible/ambiguous/new-but-unselected) and never checked — skip.
          // Mirror statementReviewService.buildReview's exact excludeIds rule here too: a
          // duplicate/possible row that's left with no accepted action still "claims" its
          // candidate, so a later row in the same batch can't silently auto-corroborate against
          // it (that candidate was already shown to the user against *this* row in review).
          if ((match.kind === 'duplicate' || match.kind === 'possible') && match.candidate) {
            excludeIds.push(match.candidate.id);
          }
          continue;
        }
        if (selection.action === 'tag') {
          if (!ADJUSTMENT_REASONS.includes(selection.adjustmentReason)) {
            throw new ValidationError([`adjustment reason must be one of: ${ADJUSTMENT_REASONS.join(', ')}`]);
          }
          await applyAmountCorroboration(client, {
            transactionId: match.candidate.id, sharedItemId, postedDate: row.date, statementAmount: row.amount,
            confidence: match.confidence, adjustmentReason: selection.adjustmentReason, adjustmentNote: selection.adjustmentNote,
          });
          excludeIds.push(match.candidate.id);
          continue;
        }
        // 'new' or 'force' — insert a genuinely new row either way; 'force' additionally
        // records which flagged candidate was overridden (F1.7 design §2.4). Ambiguous has
        // multiple tied candidates (match.candidates), not a single match.candidate — the
        // highest-confidence one is recorded so a later discrepancy has a lead to trace, even
        // though it isn't a certain match.
        let overriddenCandidateId = null;
        if (selection.action === 'force') {
          if (match.candidate) {
            overriddenCandidateId = match.candidate.id;
          } else if (match.candidates) {
            const sorted = match.candidates.slice().sort((a, b) => b.confidence - a.confidence);
            overriddenCandidateId = sorted[0].candidate.id;
            // Safer choice: exclude ALL tied candidates, not just the recorded one, so a later
            // row in this batch can't claim any of them either.
            for (const tied of sorted) {
              excludeIds.push(tied.candidate.id);
            }
          }
        }
        const transaction = await transactionsService.createTransactionFromStatement(
          userId, { accountId, transactionDate: row.date, amount: row.amount, merchantRaw: row.description }, { client }
        );
        await client.query(
          `INSERT INTO transaction_sources (transaction_id, shared_item_id, role, overridden_candidate_id)
           VALUES ($1, $2, 'origin', $3)`,
          [transaction.id, sharedItemId, overriddenCandidateId]
        );
        // Mirror statementReviewService.buildReview's excludeIds rule for this batch's own
        // inserts too: a later row in the SAME confirmReview call must not be allowed to
        // self-match against a transaction this call just created (Finding 2). The force
        // branch's overridden duplicate candidate is pushed unconditionally as well, matching
        // buildReview's push condition for duplicate/possible exactly.
        if (selection.action === 'force' && match.candidate) {
          excludeIds.push(match.candidate.id);
        }
        excludeIds.push(transaction.id);
      }

      if (documentType === 'card_statement' && data.creditCard) {
        await upsertCreditCardDetails(client, accountId, data.creditCard);
      }

      await client.query(
        `UPDATE documents SET extracted_data = jsonb_set(extracted_data, '{confirmedAt}', to_jsonb(now()::text))
         WHERE shared_item_id = $1`,
        [sharedItemId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { confirmReview };
}

module.exports = { createStatementConfirmService };
