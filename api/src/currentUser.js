const SEED_USER_EMAIL = 'founder@findo.local';

async function getCurrentUserId(pool) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [SEED_USER_EMAIL]);
  if (rows.length === 0) {
    throw new Error(`no seeded user found (expected email ${SEED_USER_EMAIL}) — run \`npm run seed\``);
  }
  return rows[0].id;
}

module.exports = { SEED_USER_EMAIL, getCurrentUserId };
