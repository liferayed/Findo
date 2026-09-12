require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://findo:findo@localhost:5432/findo',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  // Separate from OLLAMA_MODEL (F1.5's text model) — a different, vision-capable model for a
  // different purpose (F1.6 receipt image extraction). Config-driven so swapping models later
  // is a config change, not a redesign.
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b',
};

module.exports = { config };
