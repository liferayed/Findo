const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { buildChatReply } = require('./chat/buildChatReply');
const { looksLikeAccountCreation, parseAccountMessage } = require('./accounts/parseAccountMessage');
const { ACCOUNT_TYPES } = require('./accounts/validateAccountInput');
const { MAX_FILE_SIZE_BYTES, FILE_TOO_LARGE_MESSAGE } = require('./documents/validateReceiptUpload');

function statusCodeFor(err) {
  return err.statusCode || 500;
}

// Memory storage — the file is small (10MB cap), and the handler writes it to
// api/uploads/receipts/<uuid>.<ext> itself rather than relying on multer's own disk-storage
// defaults for the final path naming. `limits.fileSize` is set to the same 10MB cap
// documents/validateReceiptUpload.js enforces, so an oversized upload is rejected by multer
// itself — before the whole request body is buffered into memory — rather than only being
// caught after the fact by our own check. No fileFilter here: type rejection still goes
// through validateReceiptUpload so there is exactly one place producing that message.
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES } });

// multer's own size-limit rejection happens inside the upload.single() middleware itself,
// before our route handler (and thus validateReceiptUpload) ever runs — so it surfaces as a
// MulterError passed to this callback, not as a thrown error our route's try/catch would see.
// Normalized here to the exact same 400 shape/message validateReceiptUpload's own oversize
// check produces, so callers see one consistent "file too large" response either way.
function uploadReceiptFile(req, res, next) {
  receiptUpload.single('file')(req, res, (err) => {
    if (!err) {
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ errors: [FILE_TOO_LARGE_MESSAGE] });
    }
    next(err);
  });
}

function createApp({
  checkHealth,
  accountsService,
  institutionsService,
  transactionsService,
  resolveCurrentUserId,
  chatTransactionHandler,
  receiptUploadHandler,
  documentsService,
}) {
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

  app.get('/institutions', async (req, res) => {
    const institutions = await institutionsService.listInstitutions();
    res.status(200).json(institutions);
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

  app.get('/transactions', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const transactions = await transactionsService.listTransactions(userId, {
        from: req.query.from,
        to: req.query.to,
        accountId: req.query.account_id,
      });
      res.status(200).json(transactions);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.get('/documents', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const documents = await documentsService.listDocuments(userId, {
        from: req.query.from,
        to: req.query.to,
        accountId: req.query.account_id,
      });
      res.status(200).json(documents);
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.post('/documents/extract', uploadReceiptFile, async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const result = await receiptUploadHandler.handleExtract(userId, {
        file: req.file,
        channel: req.body && req.body.channel,
      });
      res.status(200).json({
        file_ref: result.fileRef,
        original_filename: req.file ? req.file.originalname : null,
        is_readable: result.isReadable,
        extraction: result.extraction
          ? {
              merchant: result.extraction.merchant,
              transaction_date: result.extraction.transactionDate,
              total: result.extraction.total,
              line_items: result.extraction.lineItems,
            }
          : null,
        detected_account_id: result.detectedAccountId,
      });
    } catch (err) {
      if (err.statusCode) {
        res.status(statusCodeFor(err)).json(err.errors ? { errors: err.errors } : { error: err.message });
      } else {
        throw err;
      }
    }
  });

  app.post('/documents/confirm', async (req, res) => {
    try {
      const userId = await resolveCurrentUserId();
      const body = req.body || {};
      const result = await receiptUploadHandler.handleConfirm(userId, {
        fileRef: body.file_ref,
        originalFilename: body.original_filename,
        channel: body.channel,
        accountId: body.account_id,
        merchantRaw: body.merchant,
        transactionDate: body.transaction_date,
        amount: body.amount,
        lineItems: body.line_items,
        isManual: Boolean(body.is_manual),
      });
      res.status(result.statusCode).json({
        document_id: result.documentId,
        transaction: result.transaction,
        message: result.message,
      });
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
