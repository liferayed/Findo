// Separate from jest.integration.config.js: these tests call a real local
// Ollama instance (text model for chat capture, vision model for receipt upload). Not run in
// CI (no GPU/CPU budget for local LLM inference there) — run locally with Ollama running
// (`ollama serve`, `llama3.2:3b` and `qwen2.5vl:3b` pulled) via
// `npm run test:integration:llm --workspace=api`.
module.exports = {
  testMatch: [
    '**/test/integration/chatTransactionCapture.integration.test.js',
    '**/test/integration/receiptUpload.integration.test.js',
  ],
  testTimeout: 30000,
  forceExit: true,
};
