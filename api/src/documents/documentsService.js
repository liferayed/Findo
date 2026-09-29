const { computeDocumentStatus } = require('./documentStatus');

function createDocumentsService({ pool }) {
  async function listDocuments(userId, { from, to, accountId } = {}) {
    const conditions = ['si.user_id = $1'];
    const values = [userId];
    let transactionJoinCondition = 'ON t.id = ts.transaction_id';
    let havingClause = '';

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
      const accountParam = `$${values.length}`;
      // This must live on the transactions JOIN, not the WHERE clause: it controls which
      // linked transactions count toward transaction_count/merchant/amount (narrowing a
      // multi-account statement to just the filtered account's rows), but it must never decide
      // whether the document ROW survives at all. Putting it in WHERE let a document with zero
      // linked transactions (e.g. an in-review statement, before any row is confirmed) pass
      // unconditionally via the LEFT JOIN's t.account_id IS NULL, regardless of which account it
      // actually resolved to (extracted_data.resolvedAccountId) — leaking it into any filtered view.
      transactionJoinCondition += ` AND t.account_id = ${accountParam}`;
      // With the account filter narrowing the join above, exclude a document only when it ends
      // up with zero matching transactions AND its resolved account doesn't match the filter
      // either (covers the in-review, zero-transaction leak case above).
      havingClause = `HAVING COUNT(t.id) > 0 OR resolved_account.id = ${accountParam}`;
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
       LEFT JOIN transactions t ${transactionJoinCondition}
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts resolved_account ON resolved_account.id = (d.extracted_data->>'resolvedAccountId')::uuid
       WHERE ${conditions.join(' AND ')}
       GROUP BY si.id, si.original_filename, si.received_at, si.channel, si.parse_status, si.parsed_summary,
                si.progress, d.document_type, d.extracted_data, resolved_account.id, resolved_account.nickname
       ${havingClause}
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
