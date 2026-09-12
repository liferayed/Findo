const { Pool } = require('pg');
const { config } = require('./config');

const PING_TIMEOUT_MS = 3000;

const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: PING_TIMEOUT_MS });

async function pingPostgres() {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`postgres ping timed out after ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS);
  });

  await Promise.race([pool.query('SELECT 1'), timeout]);
}

module.exports = { pool, pingPostgres };
