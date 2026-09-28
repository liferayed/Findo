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
    const { rows } = await client.query(
      `SELECT si.parse_status, d.extracted_data, d.document_type FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       WHERE si.id = $1 AND si.user_id = $2 FOR UPDATE OF si`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    const { parse_status: parseStatus, extracted_data: data, document_type: documentType } = rows[0];
    if (parseStatus !== 'parsed' || !data.resolvedAccountId) {
      throw new ValidationError(['this statement is not ready to confirm']);
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
        if (!selection) {
          continue; // pre-unchecked (duplicate/possible/ambiguous/new-but-unselected) and never checked — skip
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
        // records which flagged candidate was overridden (F1.7 design §2.4).
        const transaction = await transactionsService.createTransactionFromStatement(
          userId, { accountId, transactionDate: row.date, amount: row.amount, merchantRaw: row.description }, { client }
        );
        await client.query(
          `INSERT INTO transaction_sources (transaction_id, shared_item_id, role, overridden_candidate_id)
           VALUES ($1, $2, 'origin', $3)`,
          [transaction.id, sharedItemId, selection.action === 'force' && match.candidate ? match.candidate.id : null]
        );
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
