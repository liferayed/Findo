const { validateAccountInput } = require('./validateAccountInput');
const { ValidationError, ConflictError, NotFoundError } = require('../errors');
const { redactText, redactLastFourInput } = require('../redaction/redactSensitive');

// F1.9: account input is user-typed (web form, chat, statement account offer) — every path goes
// through createAccount/updateAccount, so redacting here covers all of them. last_four is
// accept-and-truncate: a pasted full number becomes its last 4 *before* validation runs.
function redactAccountInput(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }
  return {
    ...input,
    nickname: redactText(input.nickname),
    institution_name: redactText(input.institution_name),
    last_four: redactLastFourInput(input.last_four),
  };
}

const ACCOUNT_COLUMNS =
  'id, user_id, type, institution_name, nickname, last_four, current_balance, opening_balance, balance_as_of_date, currency, is_active, created_at';

function createAccountsService({ pool }) {
  // Accepts an optional `client` (a checked-out pg client) so a caller running its own
  // BEGIN/COMMIT can create the account on that same connection, keeping it inside the caller's
  // transaction instead of committing independently via `pool`. Same optional-client convention
  // as transactionsService.createTransactionFromStatement. Defaults to `pool` when no client is
  // given, same as every other method here.
  async function createAccount(userId, input, { client } = {}) {
    const safeInput = redactAccountInput(input);
    const errors = validateAccountInput(safeInput);
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    const runner = client || pool;
    try {
      const { rows } = await runner.query(
        `INSERT INTO accounts (user_id, type, institution_name, nickname, last_four)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [userId, safeInput.type, safeInput.institution_name, safeInput.nickname, safeInput.last_four || null]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError(`an account named "${safeInput.nickname}" already exists`);
      }
      throw err;
    }
  }

  async function listAccounts(userId) {
    const { rows } = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async function updateAccount(userId, accountId, input) {
    input = redactAccountInput(input);
    if (input && input.nickname !== undefined && typeof input.nickname !== 'string') {
      throw new ValidationError(['nickname must be a string']);
    }
    const fields = [];
    const values = [];

    if (input.nickname !== undefined) {
      fields.push(`nickname = $${fields.length + 1}`);
      values.push(input.nickname);
    }
    if (input.is_active !== undefined) {
      fields.push(`is_active = $${fields.length + 1}`);
      values.push(input.is_active);
    }

    if (fields.length === 0) {
      throw new ValidationError(['at least one of nickname or is_active must be provided']);
    }

    values.push(accountId, userId);

    try {
      const { rows } = await pool.query(
        `UPDATE accounts SET ${fields.join(', ')}
         WHERE id = $${values.length - 1} AND user_id = $${values.length}
         RETURNING ${ACCOUNT_COLUMNS}`,
        values
      );
      if (rows.length === 0) {
        throw new NotFoundError('account not found');
      }
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError(`an account named "${input.nickname}" already exists`);
      }
      throw err;
    }
  }

  async function findActiveAccountsByLastFour(userId, lastFour) {
    if (!lastFour) {
      return [];
    }
    const { rows } = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = $1 AND last_four = $2 AND is_active = true`,
      [userId, lastFour]
    );
    return rows;
  }

  return { createAccount, listAccounts, updateAccount, findActiveAccountsByLastFour };
}

module.exports = { createAccountsService };
