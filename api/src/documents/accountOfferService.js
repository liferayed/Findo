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
    const data = await loadRow(userId, sharedItemId);

    if (accept) {
      const resolvedInstitutionName = (await institutionsService.resolveInstitutionAlias(data.institutionName)) || data.institutionName;
      const account = await accountsService.createAccount(userId, {
        nickname: nickname || `${resolvedInstitutionName} ${data.accountTypeText || ''}`.trim(),
        type,
        institution_name: resolvedInstitutionName,
        last_four: data.lastFour,
      });
      data.resolvedAccountId = account.id;
    } else {
      data.accountOfferDeclined = true;
    }

    await pool.query(
      `UPDATE documents SET extracted_data = $1 WHERE shared_item_id = $2`,
      [JSON.stringify(data), sharedItemId]
    );
    await pool.query(`UPDATE shared_items SET parse_status = 'parsed' WHERE id = $1`, [sharedItemId]);
  }

  return { getAccountOffer, resolveAccountOffer };
}

module.exports = { createAccountOfferService };
