const { validateTransactionInput } = require('./validateTransactionInput');
const { ValidationError, NotFoundError } = require('../errors');

const TRANSACTION_COLUMNS =
  'id, account_id, transaction_date, posted_date, amount, original_amount, merchant_raw, ' +
  'merchant_normalized, category_id, type, is_manual, reconciliation_status, notes, created_at';

function createTransactionsService({ pool }) {
  async function findOwnedAccount(userId, accountId, { requireActive }) {
    const { rows } = await pool.query(
      `SELECT id FROM accounts WHERE id = $1 AND user_id = $2${requireActive ? ' AND is_active = true' : ''}`,
      [accountId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('account not found');
    }
  }

  async function createTransaction(userId, input) {
    const errors = validateTransactionInput(input);
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    // Reject unless the account is both the caller's and active — same
    // NotFoundError for "not mine", "not found", or "inactive" so we don't
    // leak which one, mirroring accountsService.updateAccount.
    await findOwnedAccount(userId, input.account_id, { requireActive: true });

    const signedAmount = input.type === 'debit' ? -input.amount : input.amount;

    const { rows } = await pool.query(
      `INSERT INTO transactions (account_id, transaction_date, amount, merchant_raw, type, is_manual, reconciliation_status)
       VALUES ($1, $2, $3, $4, $5, true, 'confirmed')
       RETURNING ${TRANSACTION_COLUMNS}`,
      [input.account_id, input.transaction_date, signedAmount, input.merchant_raw, input.type]
    );
    return rows[0];
  }

  // Used by the chat transaction-capture flow (F1.5). The input shape here differs enough
  // from createTransaction's HTTP-body contract to make forcing it through
  // validateTransactionInput awkward — the caller has already resolved the account and
  // validated the extracted amount/type via chat/validateExtraction.js — but the actual
  // INSERT and is_manual/reconciliation_status handling stays here rather than being forked.
  async function createTransactionFromChat(userId, { accountId, transactionDate, amount, merchantRaw, type, reconciliationStatus }) {
    await findOwnedAccount(userId, accountId, { requireActive: true });

    const signedAmount = type === 'debit' ? -amount : amount;

    const { rows } = await pool.query(
      `INSERT INTO transactions (account_id, transaction_date, amount, merchant_raw, type, is_manual, reconciliation_status)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING ${TRANSACTION_COLUMNS}`,
      [accountId, transactionDate, signedAmount, merchantRaw, type, reconciliationStatus]
    );
    return rows[0];
  }

  // Used by the receipt-upload flow (F1.6). Type is always 'debit' (a receipt is a purchase —
  // no credit/debit ambiguity to resolve, unlike F1.5's chat messages), always is_manual:
  // false, always reconciliation_status: 'confirmed' (no account-ambiguity clarification loop
  // for this feature, so there's nothing "unconfirmed" about the account resolution). The
  // caller has already validated the extraction via documents/validateReceiptExtraction.js;
  // findOwnedAccount is still called here (not just by the caller) so this method is safe to
  // call on its own, same defensive posture as createTransactionFromChat.
  async function createTransactionFromReceipt(userId, { accountId, transactionDate, amount, merchantRaw }) {
    await findOwnedAccount(userId, accountId, { requireActive: true });

    const signedAmount = -amount;

    const { rows } = await pool.query(
      `INSERT INTO transactions (account_id, transaction_date, amount, merchant_raw, type, is_manual, reconciliation_status)
       VALUES ($1, $2, $3, $4, 'debit', false, 'confirmed')
       RETURNING ${TRANSACTION_COLUMNS}`,
      [accountId, transactionDate, signedAmount, merchantRaw]
    );
    return rows[0];
  }

  async function listTransactionsForAccount(userId, accountId) {
    // Listing is allowed against an inactive account (only creation is blocked).
    await findOwnedAccount(userId, accountId, { requireActive: false });

    const { rows } = await pool.query(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions
       WHERE account_id = $1
       ORDER BY transaction_date DESC, created_at DESC`,
      [accountId]
    );
    return rows;
  }

  return {
    createTransaction,
    createTransactionFromChat,
    createTransactionFromReceipt,
    listTransactionsForAccount,
    findOwnedAccount,
  };
}

module.exports = { createTransactionsService };
