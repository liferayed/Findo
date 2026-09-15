function createInstitutionsService({ pool }) {
  async function listInstitutions() {
    const { rows } = await pool.query(
      `SELECT i.id, i.canonical_name,
              COALESCE(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.alias IS NOT NULL), ARRAY[]::text[]) AS aliases
       FROM institutions i
       LEFT JOIN institution_aliases a ON a.institution_id = i.id
       GROUP BY i.id, i.canonical_name
       ORDER BY i.canonical_name ASC`
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
