const { ValidationError } = require('../errors');

const FIELDS = ['issuer', 'credit_limit', 'apr', 'due_date', 'minimum_payment', 'statement_closing_day', 'annual_fee'];

// CP-006: the statement is authoritative for its own account, so any non-null extracted value
// overwrites what's stored; null/undefined means "not printed on this statement" and leaves
// the stored value alone (COALESCE). Takes a client so F1.7 can run it inside its confirm transaction.
async function upsertCreditCardDetails(client, accountId, fields) {
  const unknown = Object.keys(fields).filter((key) => !FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError([`unknown credit card field(s): ${unknown.join(', ')}`]);
  }

  const { rows: accounts } = await client.query('SELECT type FROM accounts WHERE id = $1', [accountId]);
  if (accounts.length === 0 || accounts[0].type !== 'credit_card') {
    throw new ValidationError(['credit card details apply only to credit_card accounts']);
  }

  const values = FIELDS.map((field) => (fields[field] === undefined ? null : fields[field]));
  const { rows } = await client.query(
    `INSERT INTO credit_card_details (account_id, ${FIELDS.join(', ')})
     VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (account_id) DO UPDATE SET
       ${FIELDS.map((f) => `${f} = COALESCE(EXCLUDED.${f}, credit_card_details.${f})`).join(',\n       ')}
     RETURNING account_id, ${FIELDS.join(', ')}`,
    [accountId, ...values]
  );
  return rows[0];
}

module.exports = { upsertCreditCardDetails };
