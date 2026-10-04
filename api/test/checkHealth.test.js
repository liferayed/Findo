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

  const LLM_UNAVAILABLE = {
    status: 'unavailable',
    message: 'Ollama not reachable at http://ollama.test:11434',
    models: { chat: { name: 'llama3.2:3b', status: 'unknown' }, vision: { name: 'qwen2.5vl:3b', status: 'unknown' } },
  };

  test('CP-007: includes the llm result as a separate top-level key', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {},
      runNoopJob: async () => {},
      checkLlm: async () => LLM_UNAVAILABLE,
    });
    expect(result.llm).toEqual(LLM_UNAVAILABLE);
    expect(Object.keys(result.subsystems)).toEqual(['postgres', 'redis', 'queue']);
  });

  test('CP-007: an unavailable LLM does not degrade the core status', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {},
      runNoopJob: async () => {},
      checkLlm: async () => LLM_UNAVAILABLE,
    });
    expect(result.status).toBe('ok');
  });

  test('CP-007: without checkLlm the response has no llm key (unchanged shape)', async () => {
    const result = await checkHealth({ pingPostgres: async () => {}, pingRedis: async () => {}, runNoopJob: async () => {} });
    expect(result).not.toHaveProperty('llm');
  });

  test('CP-007: a rejecting checkLlm reports the LLM unavailable and never affects the core status', async () => {
    const result = await checkHealth({
      pingPostgres: async () => {},
      pingRedis: async () => {},
      runNoopJob: async () => {},
      checkLlm: async () => {
        throw new Error('boom');
      },
    });
    expect(result.status).toBe('ok');
    expect(result.llm).toEqual({ status: 'unavailable', message: 'LLM check failed', models: {} });
  });
});
