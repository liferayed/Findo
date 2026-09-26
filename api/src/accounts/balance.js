// Adds an already-signed transaction amount to an account's running balance. Must be called
// with the same client (inside the same BEGIN/COMMIT) as the transactions INSERT it accompanies
// — CP-004 requires the two to commit together. The single UPDATE ... SET x = x + $1 statement
// is atomic at the row level, so concurrent writers can't lose updates.
async function applyTransactionToBalance(client, accountId, amount) {
  await client.query('UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2', [amount, accountId]);
}

module.exports = { applyTransactionToBalance };
