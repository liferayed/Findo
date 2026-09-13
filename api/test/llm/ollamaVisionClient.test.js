// Regression guard for the actual edge case found in production use: a real photographed
// receipt made the vision model return `"total": "11.29"` as a JSON string under plain
// `format: "json"` mode. The fix is that `format` must be a real JSON Schema (grammar-
// constrained decoding) — this test locks in that the request Ollama actually receives carries
// the schema, so a future edit can't silently regress without a fast, deterministic test
// catching it (rather than relying on the real, sometimes non-deterministic model to happen to
// reproduce the bug).
const { extractReceipt, RESPONSE_SCHEMA } = require('../../src/llm/ollamaVisionClient');

describe('extractReceipt request contract', () => {
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

    await extractReceipt(Buffer.from('fake-image-bytes').toString('base64'));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(capturedBody.format).toEqual(RESPONSE_SCHEMA);
    expect(typeof capturedBody.format).toBe('object');
  });

  test('the schema types `total` and line-item `amount` as numbers, never strings', () => {
    expect(RESPONSE_SCHEMA.properties.total.type).toEqual(expect.arrayContaining(['number']));
    expect(RESPONSE_SCHEMA.properties.total.type).not.toEqual(expect.arrayContaining(['string']));
    expect(RESPONSE_SCHEMA.properties.line_items.items.properties.amount.type).toBe('number');
  });
});
