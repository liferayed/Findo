const Redis = require('ioredis');
const { config } = require('./config');

const PING_TIMEOUT_MS = 3000;

const redisClient = new Redis(config.redisUrl, {
  connectTimeout: PING_TIMEOUT_MS,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: false,
});
redisClient.on('error', () => {});

async function pingRedis() {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`redis ping timed out after ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS);
  });

  const reply = await Promise.race([redisClient.ping(), timeout]);
  if (reply !== 'PONG') {
    throw new Error(`unexpected redis PING reply: ${reply}`);
  }
}

module.exports = { redisClient, pingRedis };
