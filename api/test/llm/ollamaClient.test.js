// Regression guard for the actual edge case found in production use: a model can ignore a
// plain `format: "json"` string instruction and return a "number" field as a JSON string.
// The fix is that `format` must be a real JSON Schema (grammar-constrained decoding), not just
// the loose "json" string — this test locks in that the request Ollama actually receives
// carries the schema, so a future edit can't silently regress back to the old behavior without
// a fast, deterministic test catching it (rather than relying on the real, sometimes
// non-deterministic model to happen to reproduce the bug).
const { extractTransaction, RESPONSE_SCHEMA } = require('../../src/llm/ollamaClient');

describe('extractTransaction request contract', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('sends the JSON Schema object as `format`, not the string "json"', async () => {
    let capturedBody;
    global.fetch = jest.fn(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ response: '{}' }) };
    });

    await extractTransaction('Spent $12.50 at Starbucks today');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(capturedBody.format).toEqual(RESPONSE_SCHEMA);
    expect(typeof capturedBody.format).toBe('object');
  });

  test('the schema requires every field the prompt promises and types `amount` as a number', () => {
    expect(RESPONSE_SCHEMA.required).toEqual(
      expect.arrayContaining(['is_transaction', 'amount', 'merchant', 'type', 'date_hint', 'account_hint'])
    );
    expect(RESPONSE_SCHEMA.properties.amount.type).toEqual(expect.arrayContaining(['number']));
    expect(RESPONSE_SCHEMA.properties.amount.type).not.toEqual(expect.arrayContaining(['string']));
  });
});
