const { validateTransactionInput } = require('./validateTransactionInput');
const { applyTransactionToBalance } = require('../accounts/balance');
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

  // Runs `fn(client)` inside a transaction. If the caller supplied a client it already owns the
  // BEGIN/COMMIT (F1.6's confirm flow), so we just use it; otherwise we open and finish our own.
  async function inTransaction(callerClient, fn) {
    if (callerClient) {
      return fn(callerClient);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // The single INSERT + balance-update every creation path goes through (CP-004). `signedAmount`
  // is what gets stored in transactions.amount and added to current_balance.
  async function insertTransaction(client, { accountId, transactionDate, signedAmount, merchantRaw, type, isManual, reconciliationStatus }) {
    const { rows } = await client.query(
      `INSERT INTO transactions (account_id, transaction_date, amount, merchant_raw, type, is_manual, reconciliation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${TRANSACTION_COLUMNS}`,
      [accountId, transactionDate, signedAmount, merchantRaw, type, isManual, reconciliationStatus]
    );
    await applyTransactionToBalance(client, accountId, signedAmount);
    return rows[0];
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

    return inTransaction(null, (client) =>
      insertTransaction(client, {
        accountId: input.account_id,
        transactionDate: input.transaction_date,
        signedAmount,
        merchantRaw: input.merchant_raw,
        type: input.type,
        isManual: true,
        reconciliationStatus: 'confirmed',
      })
    );
  }

  // Used by the chat transaction-capture flow (F1.5). The input shape here differs enough
  // from createTransaction's HTTP-body contract to make forcing it through
  // validateTransactionInput awkward — the caller has already resolved the account and
  // validated the extracted amount/type via chat/validateExtraction.js — but the actual
  // INSERT and is_manual/reconciliation_status handling stays here rather than being forked.
  async function createTransactionFromChat(userId, { accountId, transactionDate, amount, merchantRaw, type, reconciliationStatus }) {
    await findOwnedAccount(userId, accountId, { requireActive: true });

    const signedAmount = type === 'debit' ? -amount : amount;

    return inTransaction(null, (client) =>
      insertTransaction(client, {
        accountId,
        transactionDate,
        signedAmount,
        merchantRaw,
        type,
        isManual: false,
        reconciliationStatus,
      })
    );
  }

  // Used by the receipt-upload flow (F1.6). Type is always 'debit' (a receipt is a purchase —
  // no credit/debit ambiguity to resolve, unlike F1.5's chat messages), always
  // reconciliation_status: 'confirmed' (no account-ambiguity clarification loop for this
  // feature, so there's nothing "unconfirmed" about the account resolution). is_manual defaults
  // to false (the auto-extraction confirm path) but the manual-entry fallback — reached when
  // the receipt was unreadable and the user types the transaction in by hand — passes
  // isManual: true so the column reflects what actually happened, rather than every receipt
  // upload being recorded as machine-parsed. The caller has already validated the extraction
  // via documents/validateReceiptExtraction.js; findOwnedAccount is still called here (not just
  // by the caller) so this method is safe to call on its own, same defensive posture as
  // createTransactionFromChat.
  //
  // Accepts an optional `client` (a checked-out pg client, e.g. from pool.connect()) so the
  // caller can run this INSERT as part of a larger BEGIN/COMMIT transaction alongside its own
  // writes (documents/receiptUploadService.js does this to keep the transaction row and its
  // shared_items/documents/transaction_sources provenance atomic). When no client is given, opens its
  // own transaction so the INSERT and balance update still commit together.
  async function createTransactionFromReceipt(userId, { accountId, transactionDate, amount, merchantRaw, isManual = false }, { client } = {}) {
    await findOwnedAccount(userId, accountId, { requireActive: true });

    const signedAmount = -amount;

    return inTransaction(client, (c) =>
      insertTransaction(c, {
        accountId,
        transactionDate,
        signedAmount,
        merchantRaw,
        type: 'debit',
        isManual,
        reconciliationStatus: 'confirmed',
      })
    );
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

  async function listTransactions(userId, { from, to, accountId } = {}) {
    const conditions = ['a.user_id = $1'];
    const values = [userId];

    if (from) {
      values.push(from);
      conditions.push(`t.transaction_date >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`t.transaction_date <= $${values.length}`);
    }
    if (accountId) {
      values.push(accountId);
      conditions.push(`t.account_id = $${values.length}`);
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.account_id, a.nickname AS account_nickname, t.transaction_date, t.posted_date, t.amount,
              t.original_amount, t.merchant_raw, t.merchant_normalized, t.category_id, t.type, t.is_manual,
              t.reconciliation_status, t.notes, t.created_at
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.transaction_date DESC, t.created_at DESC`,
      values
    );
    return rows;
  }

  return {
    createTransaction,
    createTransactionFromChat,
    createTransactionFromReceipt,
    listTransactionsForAccount,
    listTransactions,
    findOwnedAccount,
  };
}

module.exports = { createTransactionsService };
