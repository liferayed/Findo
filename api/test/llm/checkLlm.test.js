const { checkLlm } = require('../../src/llm/checkLlm');

const BASE_URL = 'http://ollama.test:11434';
const MODELS = { chat: 'llama3.2:3b', vision: 'qwen2.5vl:3b' };

function tagsResponse(names) {
  return async () => ({ ok: true, json: async () => ({ models: names.map((name) => ({ name, model: name })) }) });
}

describe('checkLlm', () => {
  test('ok when Ollama lists both configured models', async () => {
    const result = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: tagsResponse(['llama3.2:3b', 'qwen2.5vl:3b', 'other:1b']) });
    expect(result).toEqual({
      status: 'ok',
      models: { chat: { name: 'llama3.2:3b', status: 'ok' }, vision: { name: 'qwen2.5vl:3b', status: 'ok' } },
    });
  });

  test('calls /api/tags on the configured base URL with an abort signal', async () => {
    const fetchImpl = jest.fn(tagsResponse(['llama3.2:3b', 'qwen2.5vl:3b']));
    await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/api/tags`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  test('degraded, naming the missing model, when one model is not pulled', async () => {
    const result = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: tagsResponse(['llama3.2:3b']) });
    expect(result).toEqual({
      status: 'degraded',
      message: 'Model not pulled: qwen2.5vl:3b',
      models: { chat: { name: 'llama3.2:3b', status: 'ok' }, vision: { name: 'qwen2.5vl:3b', status: 'missing' } },
    });
  });

  test('degraded, naming both, when neither model is pulled', async () => {
    const result = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: tagsResponse([]) });
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('Model not pulled: llama3.2:3b, qwen2.5vl:3b');
  });

  test('a configured name without a tag matches Ollama\'s ":latest" listing', async () => {
    const result = await checkLlm({
      baseUrl: BASE_URL,
      models: { chat: 'llama3.2', vision: 'qwen2.5vl:3b' },
      fetchImpl: tagsResponse(['llama3.2:latest', 'qwen2.5vl:3b']),
    });
    expect(result.status).toBe('ok');
    expect(result.models.chat).toEqual({ name: 'llama3.2', status: 'ok' });
  });

  test('unavailable when Ollama answers with a non-2xx status', async () => {
    const result = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
    expect(result).toEqual({
      status: 'unavailable',
      message: `Ollama not reachable at ${BASE_URL}`,
      models: { chat: { name: 'llama3.2:3b', status: 'unknown' }, vision: { name: 'qwen2.5vl:3b', status: 'unknown' } },
    });
  });

  test('unavailable (never throws) when the request fails or times out', async () => {
    const refused = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(refused.status).toBe('unavailable');
    const timedOut = await checkLlm({
      baseUrl: BASE_URL,
      models: MODELS,
      timeoutMs: 5,
      fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    });
    expect(timedOut.status).toBe('unavailable');
  });

  test('a malformed /api/tags body counts as no models pulled', async () => {
    const result = await checkLlm({ baseUrl: BASE_URL, models: MODELS, fetchImpl: async () => ({ ok: true, json: async () => ({ models: 'nope' }) }) });
    expect(result.status).toBe('degraded');
  });
});
