const { computeDocumentStatus } = require('./documentStatus');

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
      // Filters which linked transactions count toward this document at all — for a statement
      // this narrows transaction_count/merchant/amount to just the matching account's rows,
      // same spirit as the pre-existing per-transaction filter this replaces.
      conditions.push(`(t.account_id = $${values.length} OR t.account_id IS NULL)`);
    }

    const { rows } = await pool.query(
      `SELECT si.id, si.original_filename, si.received_at, si.channel, si.parse_status, si.parsed_summary,
              si.progress, d.document_type, d.extracted_data,
              COUNT(t.id) AS transaction_count,
              COALESCE(resolved_account.nickname, MAX(a.nickname)) AS account_nickname,
              CASE WHEN COUNT(t.id) = 1 THEN MAX(t.amount) END AS transaction_amount,
              CASE WHEN COUNT(t.id) = 1 THEN MAX(t.merchant_raw) END AS transaction_merchant_raw
       FROM shared_items si
       JOIN documents d ON d.shared_item_id = si.id
       LEFT JOIN transaction_sources ts ON ts.shared_item_id = si.id
       LEFT JOIN transactions t ON t.id = ts.transaction_id
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts resolved_account ON resolved_account.id = (d.extracted_data->>'resolvedAccountId')::uuid
       WHERE ${conditions.join(' AND ')}
       GROUP BY si.id, si.original_filename, si.received_at, si.channel, si.parse_status, si.parsed_summary,
                si.progress, d.document_type, d.extracted_data, resolved_account.nickname
       ORDER BY si.received_at DESC`,
      values
    );
    return rows.map((row) => ({
      ...row,
      status: computeDocumentStatus({
        documentType: row.document_type, parseStatus: row.parse_status, progress: row.progress, extractedData: row.extracted_data,
      }),
      transaction_count: Number(row.transaction_count),
    }));
  }

  return { listDocuments };
}

module.exports = { createDocumentsService };
