const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { upsertCreditCardDetails } = require('../../src/accounts/creditCardDetailsService');
const { ValidationError } = require('../../src/errors');

afterAll(async () => {
  await pool.end();
});

describe('schema for CP-005 / CP-006 (against real Postgres)', () => {
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

describe('upsertCreditCardDetails (against real Postgres)', () => {
  const accountsService = createAccountsService({ pool });
  let userId;
  let card;

  beforeEach(async () => {
    const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, 'T') RETURNING id`, [
      `card-${Date.now()}-${Math.random()}@findo.test`,
    ]);
    userId = rows[0].id;
    card = await accountsService.createAccount(userId, { nickname: 'Sapphire', type: 'credit_card', institution_name: 'Chase' });
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  test('first write creates the row with the given fields', async () => {
    const row = await upsertCreditCardDetails(pool, card.id, { due_date: '2026-02-10', minimum_payment: 35 });
    expect(Number(row.minimum_payment)).toBe(35);
    expect(row.issuer).toBeNull();
  });

  test('a second statement overwrites non-null fields and preserves the rest', async () => {
    await upsertCreditCardDetails(pool, card.id, { minimum_payment: 35, credit_limit: 5000, issuer: 'Chase' });
    const row = await upsertCreditCardDetails(pool, card.id, { minimum_payment: 42, credit_limit: null });
    expect(Number(row.minimum_payment)).toBe(42);
    expect(Number(row.credit_limit)).toBe(5000);
    expect(row.issuer).toBe('Chase');
  });

  test('rejects a non-credit-card account', async () => {
    const checking = await accountsService.createAccount(userId, { nickname: 'Chk', type: 'checking', institution_name: 'Chase' });
    await expect(upsertCreditCardDetails(pool, checking.id, { apr: 19.99 })).rejects.toThrow(ValidationError);
  });

  test('rejects an unknown field', async () => {
    await expect(upsertCreditCardDetails(pool, card.id, { bogus: 1 })).rejects.toThrow(ValidationError);
  });

  test('empty fields creates an all-null row on a new card and leaves an existing row unchanged', async () => {
    const created = await upsertCreditCardDetails(pool, card.id, {});
    for (const f of ['issuer', 'credit_limit', 'apr', 'due_date', 'minimum_payment', 'statement_closing_day', 'annual_fee']) {
      expect(created[f]).toBeNull();
    }
    await upsertCreditCardDetails(pool, card.id, { issuer: 'Chase', apr: 19.99 });
    const row = await upsertCreditCardDetails(pool, card.id, {});
    expect(row.issuer).toBe('Chase');
    expect(Number(row.apr)).toBe(19.99);
  });
});
