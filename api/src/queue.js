const IORedis = require('ioredis');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { config } = require('./config');

const NOOP_QUEUE_NAME = 'findo-noop';
const DEFAULT_TIMEOUT_MS = 3000;

const connection = new IORedis(config.redisUrl, {
  connectTimeout: DEFAULT_TIMEOUT_MS,
  maxRetriesPerRequest: null,
});
connection.on('error', () => {});

const noopQueue = new Queue(NOOP_QUEUE_NAME, { connection });
const noopQueueEvents = new QueueEvents(NOOP_QUEUE_NAME, { connection });

let noopWorker = null;

function startNoopWorker() {
  if (!noopWorker) {
    noopWorker = new Worker(NOOP_QUEUE_NAME, async () => ({ ok: true }), { connection });
  }
  return noopWorker;
}

async function runNoopJob({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`noop job timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const run = (async () => {
    const job = await noopQueue.add('noop', {}, { removeOnComplete: true, removeOnFail: true });
    await job.waitUntilFinished(noopQueueEvents, timeoutMs);
  })();

  await Promise.race([run, timeout]);
}

module.exports = { NOOP_QUEUE_NAME, noopQueue, noopQueueEvents, startNoopWorker, runNoopJob, connection };
