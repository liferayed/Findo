const { config } = require('./config');
const { createApp } = require('./app');
const { checkHealth } = require('./health/checkHealth');
const { pingPostgres } = require('./db');
const { pingRedis } = require('./redis');
const { runNoopJob, startNoopWorker } = require('./queue');

startNoopWorker();

const app = createApp({
  checkHealth: () => checkHealth({ pingPostgres, pingRedis, runNoopJob }),
});

app.listen(config.port, () => {
  console.log(`Findo API listening on port ${config.port}`);
});
