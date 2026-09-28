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
    // F1.7 final review I3: declining used to write accountOfferDeclined:true and flip
    // parse_status to 'parsed' — but getStatementStatus then reports ready_for_review, and both
    // /review and /confirm-review correctly reject a statement with no resolvedAccountId,
    // leaving no way forward. Until a per-row account picker exists (option b from the review,
    // the simplest safe choice), decline is rejected outright rather than written as a dead end.
    if (!accept) {
      throw new ValidationError(['declining an account offer is not yet supported — please create the account']);
    }

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

      const resolvedInstitutionName = (await institutionsService.resolveInstitutionAlias(data.institutionName)) || data.institutionName;
      const account = await accountsService.createAccount(userId, {
        nickname: nickname || `${resolvedInstitutionName} ${data.accountTypeText || ''}`.trim(),
        type,
        institution_name: resolvedInstitutionName,
        last_four: data.lastFour,
      });
      data.resolvedAccountId = account.id;

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
        // window) — this guards a future code path change, not a currently-provable race, and
        // keeps the account creation from being committed as an orphan if it ever becomes one.
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
