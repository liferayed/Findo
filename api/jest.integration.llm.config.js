// Separate from jest.integration.config.js: these tests call a real local
// Ollama instance. Not run in CI (no GPU/CPU budget for local LLM inference
// there) — run locally with Ollama running (`ollama serve`, `llama3.2:3b`
// pulled) via `npm run test:integration:llm --workspace=api`.
module.exports = {
  testMatch: ['**/test/integration/chatTransactionCapture.integration.test.js'],
  testTimeout: 30000,
  forceExit: true,
};
