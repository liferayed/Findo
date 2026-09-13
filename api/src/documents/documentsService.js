function createDocumentsService({ pool }) {
  async function listDocuments(userId, { from, to, accountId } = {}) {
    const conditions = ['si.user_id = $1'];
    const values = [userId];

    if (from) {
      values.push(from);
      conditions.push(`si.received_at >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`si.received_at <= $${values.length}::date + interval '1 day'`);
    }
    if (accountId) {
      values.push(accountId);
      conditions.push(`t.account_id = $${values.length}`);
    }

    const { rows } = await pool.query(
      `SELECT si.id, si.original_filename, si.received_at, si.channel, si.parse_status, si.parsed_summary,
              t.id AS transaction_id, t.account_id, a.nickname AS account_nickname,
              t.amount AS transaction_amount, t.merchant_raw AS transaction_merchant_raw
       FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       LEFT JOIN transaction_sources ts ON ts.shared_item_id = si.id
       LEFT JOIN transactions t ON t.id = ts.transaction_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY si.received_at DESC`,
      values
    );
    return rows;
  }

  return { listDocuments };
}

module.exports = { createDocumentsService };
