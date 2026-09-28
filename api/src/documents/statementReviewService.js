const { findMatch } = require('../reconciliation/reconciliationService');
const { getBalanceAsOf } = require('../accounts/balance');
const { ValidationError, NotFoundError } = require('../errors');

function createStatementReviewService({ pool }) {
  async function loadReadyRow(userId, sharedItemId) {
    const { rows } = await pool.query(
      `SELECT si.parse_status, d.extracted_data FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       WHERE si.id = $1 AND si.user_id = $2`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    const { parse_status: parseStatus, extracted_data: data } = rows[0];
    if (parseStatus !== 'parsed' || !data.resolvedAccountId) {
      throw new ValidationError(['this statement is not ready for review']);
    }
    return data;
  }

  async function buildReview(userId, sharedItemId) {
    const data = await loadReadyRow(userId, sharedItemId);
    const accountId = data.resolvedAccountId;

    const excludeIds = [];
    const rows = [];
    for (let index = 0; index < data.transactions.length; index += 1) {
      const row = data.transactions[index];
      const result = await findMatch(pool, {
        accountId, transactionDate: row.date, amount: row.amount, merchantRaw: row.description, excludeIds,
      });
      if ((result.kind === 'corroborate' || result.kind === 'duplicate' || result.kind === 'possible') && result.candidate) {
        excludeIds.push(result.candidate.id);
      }
      rows.push({ index, date: row.date, merchant: row.description, amount: row.amount, ...result });
    }

    let balanceMismatch = null;
    if (data.endingBalance !== null) {
      const periodEnd = data.transactions.length > 0 ? data.transactions[data.transactions.length - 1].date : new Date().toISOString().slice(0, 10);
      const reconstructed = await getBalanceAsOf(pool, accountId, periodEnd);
      const gap = Math.round((reconstructed - Number(data.endingBalance)) * 100) / 100;
      if (gap !== 0) {
        balanceMismatch = { statementEndingBalance: data.endingBalance, reconstructedBalance: reconstructed, gap };
      }
    }

    return { accountId, rows, balanceMismatch };
  }

  return { buildReview };
}

module.exports = { createStatementReviewService };
