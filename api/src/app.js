const path = require('node:path');
const express = require('express');
const { buildChatReply } = require('./chat/buildChatReply');
const { looksLikeAccountCreation, parseAccountMessage } = require('./accounts/parseAccountMessage');
const { ACCOUNT_TYPES } = require('./accounts/validateAccountInput');

function statusCodeFor(err) {
  return err.statusCode || 500;
}

function createApp({ checkHealth, accountsService, transactionsService, resolveCurrentUserId, chatTransactionHandler }) {
  const app = express();

  app.use(express.json());
  app.use('/chat', express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', async (req, res) => {
    const result = await checkHealth();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  });

  app.post('/accounts', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const account = await accountsService.createAccount(userId, req.body || {});
      res.status(201).json(account);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.get('/accounts', async (req, res) => {
    const userId = await resolveCurrentUserId();
    const accounts = await accountsService.listAccounts(userId);
    res.status(200).json(accounts);
  });

  app.patch('/accounts/:id', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const account = await accountsService.updateAccount(userId, req.params.id, req.body || {});
      res.status(200).json(account);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.post('/transactions', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const transaction = await transactionsService.createTransaction(userId, req.body || {});
      res.status(201).json(transaction);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.get('/accounts/:id/transactions', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const transactions = await transactionsService.listTransactionsForAccount(userId, req.params.id);
      res.status(200).json(transactions);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.post('/chat/messages', async (req, res) => {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'text is required' });
    }

    if (looksLikeAccountCreation(text)) {
      const parsed = parseAccountMessage(text);
      if (!parsed) {
        return res.status(200).json({
          received: text,
          reply: `I couldn't tell what type of account that is — please say which one: ${ACCOUNT_TYPES.join(
            ', '
          ).replace('credit_card', 'credit card')}.`,
        });
      }

      try {
        const userId = await resolveCurrentUserId();
        const account = await accountsService.createAccount(userId, parsed);
        return res
          .status(201)
          .json({ received: text, reply: `Got it — added ${account.nickname} (${account.institution_name}, ${account.type}).` });
      } catch (err) {
        if (err.statusCode) {
          const message = err.errors ? err.errors.join(', ') : err.message;
          return res.status(statusCodeFor(err)).json({ received: text, reply: `I couldn't add that account: ${message}` });
        }
        throw err;
      }
    }

    // F1.5: not an account-creation message — try LLM-based transaction capture. Handler
    // returns null when the message isn't an actionable transaction, in which case we fall
    // through to the existing generic chat echo below (same as before F1.5 existed).
    const userId = await resolveCurrentUserId();
    const result = await chatTransactionHandler(userId, text);
    if (result) {
      return res.status(result.statusCode).json({ received: text, reply: result.reply });
    }

    res.status(201).json({ received: text, reply: buildChatReply(text) });
  });

  return app;
}

module.exports = { createApp };
