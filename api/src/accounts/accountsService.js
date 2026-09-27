const { validateAccountInput } = require('./validateAccountInput');
const { ValidationError, ConflictError, NotFoundError } = require('../errors');

const ACCOUNT_COLUMNS =
  'id, user_id, type, institution_name, nickname, last_four, current_balance, opening_balance, balance_as_of_date, currency, is_active, created_at';

function createAccountsService({ pool }) {
  async function createAccount(userId, input) {
    const errors = validateAccountInput(input);
    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO accounts (user_id, type, institution_name, nickname, last_four)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [userId, input.type, input.institution_name, input.nickname, input.last_four || null]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError(`an account named "${input.nickname}" already exists`);
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
