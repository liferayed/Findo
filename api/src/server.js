const { config } = require('./config');
const { createApp } = require('./app');
const { checkHealth } = require('./health/checkHealth');
const { pool, pingPostgres } = require('./db');
const { pingRedis } = require('./redis');
const { runNoopJob, startNoopWorker } = require('./queue');
const { createAccountsService } = require('./accounts/accountsService');
const { getCurrentUserId } = require('./currentUser');

startNoopWorker();

const app = createApp({
  checkHealth: () => checkHealth({ pingPostgres, pingRedis, runNoopJob }),
  accountsService: createAccountsService({ pool }),
  resolveCurrentUserId: () => getCurrentUserId(pool),
});

app.listen(config.port, () => {
  console.log(`Findo API listening on port ${config.port}`);
});
