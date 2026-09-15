const { config } = require('./config');
const { createApp } = require('./app');
const { checkHealth } = require('./health/checkHealth');
const { pool, pingPostgres } = require('./db');
const { pingRedis } = require('./redis');
const { runNoopJob, startNoopWorker } = require('./queue');
const { createAccountsService } = require('./accounts/accountsService');
const { createInstitutionsService } = require('./institutions/institutionsService');
const { createTransactionsService } = require('./transactions/transactionsService');
const { getCurrentUserId } = require('./currentUser');
const { extractTransaction } = require('./llm/ollamaClient');
const { extractReceipt } = require('./llm/ollamaVisionClient');
const { createChatTransactionHandler } = require('./chat/chatTransactionHandler');
const { createReceiptUploadHandler } = require('./documents/receiptUploadService');
const { createDocumentsService } = require('./documents/documentsService');

startNoopWorker();

const transactionsService = createTransactionsService({ pool });
const accountsService = createAccountsService({ pool });
const institutionsService = createInstitutionsService({ pool });
const chatTransactionHandler = createChatTransactionHandler({ pool, transactionsService, extractTransaction });
const receiptUploadHandler = createReceiptUploadHandler({ pool, transactionsService, accountsService, extractReceipt });
const documentsService = createDocumentsService({ pool });

const app = createApp({
  checkHealth: () => checkHealth({ pingPostgres, pingRedis, runNoopJob }),
  accountsService,
  institutionsService,
  transactionsService,
  resolveCurrentUserId: () => getCurrentUserId(pool),
  chatTransactionHandler: chatTransactionHandler.handleMessage,
  receiptUploadHandler,
  documentsService,
});

app.listen(config.port, () => {
  console.log(`Findo API listening on port ${config.port}`);
});
