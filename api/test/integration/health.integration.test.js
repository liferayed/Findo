// Requires real Postgres + Redis, e.g. `docker-compose up -d` from the repo root.
const { pool, pingPostgres } = require('../../src/db');
const { redisClient, pingRedis } = require('../../src/redis');
const { runNoopJob, startNoopWorker, noopQueue, noopQueueEvents, connection } = require('../../src/queue');
const { checkHealth } = require('../../src/health/checkHealth');

describe('health check against real Postgres/Redis/BullMQ', () => {
  let worker;

  beforeAll(() => {
    worker = startNoopWorker();
  });

  afterAll(async () => {
    await worker.close();
    await noopQueue.close();
    await noopQueueEvents.close();
    await connection.quit();
    await redisClient.quit();
    await pool.end();
  });

  test('pingPostgres resolves against a real database', async () => {
    await expect(pingPostgres()).resolves.toBeUndefined();
  });

  test('pingRedis resolves against a real redis instance', async () => {
    await expect(pingRedis()).resolves.toBeUndefined();
  });

  test('runNoopJob round-trips a job through the real queue', async () => {
    await expect(runNoopJob({ timeoutMs: 10000 })).resolves.toBeUndefined();
  });

  test('checkHealth reports fully healthy end to end', async () => {
    const result = await checkHealth({ pingPostgres, pingRedis, runNoopJob });
    expect(result).toEqual({
      status: 'ok',
      subsystems: {
        postgres: { status: 'ok' },
        redis: { status: 'ok' },
        queue: { status: 'ok' },
      },
    });
  });
});
