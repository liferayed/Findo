const { parseModelJson } = require('../../src/llm/parseModelJson');

describe('parseModelJson', () => {
  test('parses a clean JSON response', () => {
    expect(parseModelJson('{"total": 11.29}')).toEqual({ total: 11.29 });
  });

  test('strips a stray markdown code fence before giving up', () => {
    expect(parseModelJson('```json\n{"total": 11.29}\n```')).toEqual({ total: 11.29 });
    expect(parseModelJson('```\n{"total": 11.29}\n```')).toEqual({ total: 11.29 });
  });

  test('throws a clear, labeled error when the response is not valid JSON at all', () => {
    expect(() => parseModelJson('not json at all', 'ollama vision')).toThrow(
      /ollama vision response was not valid JSON/
    );
  });

  test('defaults the error label to a generic "ollama" if none is given', () => {
    expect(() => parseModelJson('not json')).toThrow(/ollama response was not valid JSON/);
  });
});
