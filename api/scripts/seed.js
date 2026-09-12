const { pool } = require('../src/db');

const SEED_EMAIL = 'founder@findo.local';

async function seed() {
  await pool.query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [SEED_EMAIL, 'Findo Founder']
  );
  const { rows } = await pool.query('SELECT id, email, name, timezone FROM users WHERE email = $1', [SEED_EMAIL]);
  console.log('Seeded user:', rows[0]);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
