const { pool } = require('../src/db');
const { SEED_USER_EMAIL } = require('../src/currentUser');

async function seed() {
  await pool.query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [SEED_USER_EMAIL, 'Findo Founder']
  );
  const { rows } = await pool.query('SELECT id, email, name, timezone FROM users WHERE email = $1', [
    SEED_USER_EMAIL,
  ]);
  console.log('Seeded user:', rows[0]);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
