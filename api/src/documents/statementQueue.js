const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const { config } = require('../config');

const STATEMENT_QUEUE_NAME = 'findo-statement-extraction';

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
connection.on('error', () => {});

const statementQueue = new Queue(STATEMENT_QUEUE_NAME, { connection });

async function enqueueStatementExtraction(sharedItemId, userId) {
  await statementQueue.add('extract', { sharedItemId, userId }, { removeOnComplete: true, removeOnFail: false });
}

module.exports = { STATEMENT_QUEUE_NAME, statementQueue, connection, enqueueStatementExtraction };
