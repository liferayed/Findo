const { pool } = require('../../src/db');

describe('schema for CP-005 / CP-006 (against real Postgres)', () => {
  afterAll(async () => {
    await pool.end();
  });

  async function columnsOf(table) {
    const { rows } = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [table]
    );
    return rows.map((r) => r.column_name);
  }

  test('transaction_sources has matched_at and match_confidence', async () => {
    const cols = await columnsOf('transaction_sources');
    expect(cols).toEqual(expect.arrayContaining(['matched_at', 'match_confidence', 'adjustment_reason', 'adjustment_note']));
  });

  test('adjustment_reason other requires a note (CHECK constraint)', async () => {
    const { rows: [u] } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [`chk-${Date.now()}@findo.test`]);
    try {
      const { rows: [a] } = await pool.query(
        `INSERT INTO accounts (user_id, type, institution_name, nickname) VALUES ($1, 'checking', 'Chase', 'C') RETURNING id`, [u.id]);
      const { rows: [t] } = await pool.query(
        `INSERT INTO transactions (account_id, transaction_date, amount, merchant_raw, type, reconciliation_status)
         VALUES ($1, '2026-01-01', -1, 'x', 'debit', 'unconfirmed') RETURNING id`, [a.id]);
      const { rows: [s] } = await pool.query(
        `INSERT INTO shared_items (user_id, channel, content_type, parse_status) VALUES ($1, 'web_upload', 'file', 'parsed') RETURNING id`, [u.id]);
      await expect(
        pool.query(
          `INSERT INTO transaction_sources (transaction_id, shared_item_id, role, adjustment_reason) VALUES ($1, $2, 'corroboration', 'other')`,
          [t.id, s.id])
      ).rejects.toThrow(/adjustment_note_requires_other/);
      await pool.query(
        `INSERT INTO transaction_sources (transaction_id, shared_item_id, role, adjustment_reason, adjustment_note) VALUES ($1, $2, 'corroboration', 'other', 'valet')`,
        [t.id, s.id]);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
    }
  });

  test('credit_card_details exists with minimum_payment', async () => {
    const cols = await columnsOf('credit_card_details');
    expect(cols).toEqual(
      expect.arrayContaining([
        'account_id', 'issuer', 'credit_limit', 'apr', 'due_date',
        'minimum_payment', 'statement_closing_day', 'annual_fee',
      ])
    );
  });
});
