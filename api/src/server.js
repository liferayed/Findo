const { config } = require('./config');
const { createApp } = require('./app');
const { checkHealth } = require('./health/checkHealth');
const { pool, pingPostgres } = require('./db');
const { pingRedis } = require('./redis');
const { runNoopJob, startNoopWorker } = require('./queue');
const { createAccountsService } = require('./accounts/accountsService');
const { createTransactionsService } = require('./transactions/transactionsService');
const { getCurrentUserId } = require('./currentUser');
const { extractTransaction } = require('./llm/ollamaClient');
const { extractReceipt } = require('./llm/ollamaVisionClient');
const { createChatTransactionHandler } = require('./chat/chatTransactionHandler');
const { createReceiptUploadHandler } = require('./documents/receiptUploadService');

startNoopWorker();

const transactionsService = createTransactionsService({ pool });
const chatTransactionHandler = createChatTransactionHandler({ pool, transactionsService, extractTransaction });
const receiptUploadHandler = createReceiptUploadHandler({ pool, transactionsService, extractReceipt });

const app = createApp({
  checkHealth: () => checkHealth({ pingPostgres, pingRedis, runNoopJob }),
  accountsService: createAccountsService({ pool }),
  transactionsService,
  resolveCurrentUserId: () => getCurrentUserId(pool),
  chatTransactionHandler: chatTransactionHandler.handleMessage,
  receiptUploadHandler,
});

app.listen(config.port, () => {
  console.log(`Findo API listening on port ${config.port}`);
});
