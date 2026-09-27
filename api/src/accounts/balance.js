// Adds an already-signed transaction amount to an account's running balance. Must be called
// with the same client (inside the same BEGIN/COMMIT) as the transactions INSERT it accompanies
// — CP-004 requires the two to commit together. The single UPDATE ... SET x = x + $1 statement
// is atomic at the row level, so concurrent writers can't lose updates.
async function applyTransactionToBalance(client, accountId, amount) {
  await client.query('UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2', [amount, accountId]);
}

// Balance at the end of `asOfDate` (inclusive): the immutable opening anchor plus every
// transaction dated on or before it. Works for a statement of any age, unlike comparing against
// current_balance (CP-004 §3).
async function getBalanceAsOf(client, accountId, asOfDate) {
  const { rows } = await client.query(
    `SELECT a.opening_balance + COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_date <= $2), 0) AS balance
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.id = $1
     GROUP BY a.opening_balance`,
    [accountId, asOfDate]
  );
  return Number(rows[0].balance);
}

module.exports = { applyTransactionToBalance, getBalanceAsOf };
