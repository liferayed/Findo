const path = require('node:path');
const express = require('express');
const { buildChatReply } = require('./chat/buildChatReply');

function createApp({ checkHealth }) {
  const app = express();

  app.use(express.json());
  app.use('/chat', express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', async (req, res) => {
    const result = await checkHealth();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  });

  app.post('/chat/messages', (req, res) => {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'text is required' });
    }
    res.status(201).json({ received: text, reply: buildChatReply(text) });
  });

  return app;
}

module.exports = { createApp };
