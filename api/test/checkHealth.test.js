const { checkHealth } = require('../src/health/checkHealth');

describe('checkHealth', () => {
  test('reports ok status when all subsystems succeed', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {},
      runNoopJob: async () => {},
    });

    expect(result.status).toBe('ok');
    expect(result.subsystems.postgres).toEqual({ status: 'ok' });
    expect(result.subsystems.redis).toEqual({ status: 'ok' });
    expect(result.subsystems.queue).toEqual({ status: 'ok' });
  });

  test('reports degraded status with a clear message when postgres fails', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {
        throw new Error('connection refused');
      },
      pingRedis: async () => {},
      runNoopJob: async () => {},
    });

    expect(result.status).toBe('degraded');
    expect(result.subsystems.postgres).toEqual({ status: 'error', message: 'connection refused' });
    expect(result.subsystems.redis).toEqual({ status: 'ok' });
    expect(result.subsystems.queue).toEqual({ status: 'ok' });
  });

  test('reports degraded status when redis fails, independent of the other subsystems', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {
        throw new Error('ECONNREFUSED');
      },
      runNoopJob: async () => {},
    });

    expect(result.status).toBe('degraded');
    expect(result.subsystems.postgres).toEqual({ status: 'ok' });
    expect(result.subsystems.redis).toEqual({ status: 'error', message: 'ECONNREFUSED' });
    expect(result.subsystems.queue).toEqual({ status: 'ok' });
  });

  test('reports degraded status when the queue job fails', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {},
      runNoopJob: async () => {
        throw new Error('job timed out');
      },
    });

    expect(result.status).toBe('degraded');
    expect(result.subsystems.queue).toEqual({ status: 'error', message: 'job timed out' });
  });
});
