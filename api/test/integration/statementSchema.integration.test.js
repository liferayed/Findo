const { pool } = require('../../src/db');

describe('statement review schema (against real Postgres)', () => {
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

  test('shared_items has progress', async () => {
    expect(await columnsOf('shared_items')).toContain('progress');
  });

  test('documents has extracted_data', async () => {
    expect(await columnsOf('documents')).toContain('extracted_data');
  });

  test('transaction_sources has overridden_candidate_id', async () => {
    expect(await columnsOf('transaction_sources')).toContain('overridden_candidate_id');
  });
});
