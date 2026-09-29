const { ValidationError, NotFoundError } = require('../errors');

function createAccountOfferService({ pool, accountsService, institutionsService }) {
  async function loadRow(userId, sharedItemId) {
    const { rows } = await pool.query(
      `SELECT si.parse_status, d.extracted_data FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       WHERE si.id = $1 AND si.user_id = $2`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    if (rows[0].parse_status !== 'needs_clarification') {
      throw new ValidationError(['this statement has no pending account offer']);
    }
    return rows[0].extracted_data;
  }

  async function getAccountOffer(userId, sharedItemId) {
    const data = await loadRow(userId, sharedItemId);
    return {
      institutionName: data.institutionName,
      accountTypeText: data.accountTypeText,
      lastFour: data.lastFour,
      suggestedType: data.creditCard ? 'credit_card' : null,
    };
  }

  async function resolveAccountOffer(userId, sharedItemId, { accept, type, nickname }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT si.parse_status, d.extracted_data FROM shared_items si
         JOIN documents d ON d.shared_item_id = si.id
         WHERE si.id = $1 AND si.user_id = $2 FOR UPDATE OF si, d`,
        [sharedItemId, userId]
      );
      if (rows.length === 0) {
        throw new NotFoundError('statement not found');
      }
      if (rows[0].parse_status !== 'needs_clarification') {
        throw new ValidationError(['this statement has no pending account offer']);
      }
      const data = rows[0].extracted_data;

      if (accept) {
        const resolvedInstitutionName = (await institutionsService.resolveInstitutionAlias(data.institutionName)) || data.institutionName;
        // F1.7 final review M1: createAccount used to always write via `pool`, its own connection —
        // separate from this function's `client`/transaction — so the account was committed
        // independently the instant this call returned, regardless of what happened afterwards in
        // this function. Passing `client` here runs the INSERT on this same transaction, so if
        // anything below fails and we ROLLBACK, the account creation rolls back with it instead of
        // being left behind as an orphan.
        const account = await accountsService.createAccount(userId, {
          nickname: nickname || `${resolvedInstitutionName} ${data.accountTypeText || ''}`.trim(),
          type,
          institution_name: resolvedInstitutionName,
          last_four: data.lastFour,
        }, { client });
        data.resolvedAccountId = account.id;
      } else {
        // F1.7 gap fix: decline no longer rejects outright. It means "skip matching entirely for
        // this statement" — every row's account is picked individually in bulk-review, inserted
        // as a plain new transaction with no findMatch call (statementConfirmService's declined
        // branch). resolvedAccountId stays null; accountOfferDeclined is the signal both
        // buildReview and confirmReview check for.
        data.accountOfferDeclined = true;
      }

      await client.query(
        `UPDATE documents SET extracted_data = $1 WHERE shared_item_id = $2`,
        [JSON.stringify(data), sharedItemId]
      );
      const { rowCount } = await client.query(
        `UPDATE shared_items SET parse_status = 'parsed' WHERE id = $1 AND parse_status = 'needs_clarification'`,
        [sharedItemId]
      );
      if (rowCount === 0) {
        // Another concurrent call already resolved this offer between our SELECT ... FOR
        // UPDATE and this UPDATE is not actually reachable (the row lock covers exactly that
        // window) — this guards a future code path change, not a currently-provable race. Since
        // createAccount now runs on this same `client`, the ROLLBACK below undoes the account
        // creation along with everything else, so this path can never leave an orphan account.
        throw new ValidationError(['this statement has no pending account offer']);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { getAccountOffer, resolveAccountOffer };
}

module.exports = { createAccountOfferService };
