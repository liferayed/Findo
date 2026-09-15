function createInstitutionsService({ pool }) {
  async function listInstitutions() {
    const { rows } = await pool.query(
      'SELECT id, canonical_name FROM institutions ORDER BY canonical_name ASC'
    );
    return rows;
  }

  async function resolveInstitutionAlias(rawText) {
    if (typeof rawText !== 'string' || rawText.trim() === '') {
      return null;
    }

    const { rows } = await pool.query(
      `SELECT i.canonical_name
       FROM institution_aliases a
       JOIN institutions i ON i.id = a.institution_id
       WHERE lower(a.alias) = lower($1)
       LIMIT 1`,
      [rawText.trim()]
    );

    return rows.length > 0 ? rows[0].canonical_name : null;
  }

  return { listInstitutions, resolveInstitutionAlias };
}

module.exports = { createInstitutionsService };
