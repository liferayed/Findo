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
    // F1.7 final review I3 (Task 7 Minor): two distinct messages instead of one generic one, so
    // a caller (and a future decline-supporting feature) can tell "still processing / needs an
    // account offer resolved / failed" apart from "parsed, but no account was ever resolved onto
    // it" (e.g. the not-yet-supported decline path).
    if (parseStatus !== 'parsed') {
      throw new ValidationError(['this statement is not parsed yet — it is not ready for review']);
    }
    if (!data.resolvedAccountId) {
      throw new ValidationError(['this statement has no resolved account — it is not ready for review']);
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
      // F1.7 final review I4: getBalanceAsOf reflects the CURRENT ledger, before this
      // statement's own rows are inserted — but endingBalance assumes they WILL be. Add back
      // what confirming this review will actually add to the ledger: every 'new' row's own
      // amount, plus every unresolved 'possible' row's difference (its candidate is already in
      // the ledger; the difference is the part that isn't yet). 'corroborate'/'duplicate' rows
      // change nothing — they're already counted (corroborate) or already confirmed (duplicate).
      const todayIsoString = new Date().toISOString().slice(0, 10);
      const periodEnd = data.transactions.length > 0
        ? data.transactions.reduce((max, t) => (t.date > max ? t.date : max), data.transactions[0].date)
        : todayIsoString;
      const reconstructed = await getBalanceAsOf(pool, accountId, periodEnd);
      const projectedAdjustment = rows.reduce((sum, row) => {
        if (row.kind === 'new') {
          return sum + Number(row.amount);
        }
        if (row.kind === 'possible') {
          return sum + Number(row.difference);
        }
        return sum;
      }, 0);
      const gap = Math.round((reconstructed + projectedAdjustment - Number(data.endingBalance)) * 100) / 100;
      if (gap !== 0) {
        balanceMismatch = { statementEndingBalance: data.endingBalance, reconstructedBalance: reconstructed, gap };
      }
    }

    return { accountId, rows, balanceMismatch };
  }

  return { buildReview };
}

module.exports = { createStatementReviewService };
