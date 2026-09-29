const { pool } = require('../../src/db');
const { createAccountsService } = require('../../src/accounts/accountsService');
const { createTransactionsService } = require('../../src/transactions/transactionsService');
const { createReceiptUploadHandler } = require('../../src/documents/receiptUploadService');
const { createDocumentsService } = require('../../src/documents/documentsService');

const accountsService = createAccountsService({ pool });
const transactionsService = createTransactionsService({ pool });
const receiptUploadHandler = createReceiptUploadHandler({ pool, transactionsService, accountsService, extractReceipt: async () => null });
const documentsService = createDocumentsService({ pool });

async function createTestUser(email) {
  const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [email, 'Test User']);
  return rows[0].id;
}

describe('documentsService.listDocuments', () => {
  let userId;
  let account;

  beforeEach(async () => {
    userId = await createTestUser(`docsvc-${Date.now()}-${Math.random().toString(36).slice(2)}@findo.test`);
    account = await accountsService.createAccount(userId, { type: 'checking', institution_name: 'Chase', nickname: 'Chase Checking', last_four: '4821' });
  });

  afterEach(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  it('lists a confirmed upload with its transaction joined in', async () => {
    const extractResult = await receiptUploadHandler.handleExtract(userId, {
      file: { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1, originalname: 'test.png' },
      channel: 'web_upload',
    });
    await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: 'test.png',
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: 'Coffee Shop',
      transactionDate: '2026-09-01',
      amount: 4.5,
      lineItems: [],
    });

    const results = await documentsService.listDocuments(userId);

    expect(results).toHaveLength(1);
    expect(results[0].original_filename).toBe('test.png');
    expect(results[0].parse_status).toBe('parsed');
    expect(results[0].account_nickname).toBe('Chase Checking');
    expect(results[0].transaction_merchant_raw).toBe('Coffee Shop');
  });

  it('never returns another user\'s documents', async () => {
    const otherUserId = await createTestUser(`docsvc-other-${Date.now()}@findo.test`);
    const otherAccount = await accountsService.createAccount(otherUserId, { type: 'checking', institution_name: 'Chase', nickname: 'Other', last_four: '0000' });
    const extractResult = await receiptUploadHandler.handleExtract(otherUserId, {
      file: { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1, originalname: 'other.png' },
      channel: 'web_upload',
    });
    await receiptUploadHandler.handleConfirm(otherUserId, {
      fileRef: extractResult.fileRef,
      originalFilename: 'other.png',
      channel: 'web_upload',
      accountId: otherAccount.id,
      merchantRaw: 'Not Mine',
      transactionDate: '2026-09-01',
      amount: 1,
      lineItems: [],
    });

    const results = await documentsService.listDocuments(userId);

    expect(results).toHaveLength(0);
    await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
  });

  it('a document with no resulting transaction appears with null account/transaction fields', async () => {
    // Directly insert a shared_item with failed parse status and a documents row that references it,
    // simulating a document that exists in the system but has no associated transaction
    const { rows: sharedItemRows } = await pool.query(
      `INSERT INTO shared_items (user_id, original_filename, received_at, channel, parse_status, content_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, 'failed-parse.png', new Date(), 'web_upload', 'failed', 'file']
    );
    const sharedItemId = sharedItemRows[0].id;

    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, page_count) VALUES ($1, $2, $3)`,
      [sharedItemId, 'receipt', 1]
    );

    const results = await documentsService.listDocuments(userId);

    expect(results).toHaveLength(1);
    expect(results[0].original_filename).toBe('failed-parse.png');
    expect(results[0].parse_status).toBe('failed');
    expect(results[0].transaction_count).toBe(0);
    expect(results[0].account_nickname).toBeNull();
    expect(results[0].transaction_merchant_raw).toBeNull();
    expect(results[0].status).toBe('failed');
  });

  it('a cross-tenant accountId filter returns empty, preventing data leakage', async () => {
    // Create user A with a document and transaction
    const extractResult = await receiptUploadHandler.handleExtract(userId, {
      file: { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1, originalname: 'test.png' },
      channel: 'web_upload',
    });
    await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: 'test.png',
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: 'Coffee Shop',
      transactionDate: '2026-09-01',
      amount: 4.5,
      lineItems: [],
    });

    // Create user B with their own account
    const otherUserId = await createTestUser(`docsvc-b-${Date.now()}@findo.test`);
    const otherAccount = await accountsService.createAccount(otherUserId, { type: 'checking', institution_name: 'Wells Fargo', nickname: 'Wells', last_four: '5555' });

    try {
      // Attempt to list user A's documents filtered by user B's account ID
      const results = await documentsService.listDocuments(userId, { accountId: otherAccount.id });

      // Should return empty, not user A's documents
      expect(results).toHaveLength(0);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
    }
  });

  it('a receipt still returns one row with its transaction amount/merchant, unchanged', async () => {
    const extractResult = await receiptUploadHandler.handleExtract(userId, {
      file: { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1, originalname: 'receipt.png' },
      channel: 'web_upload',
    });
    await receiptUploadHandler.handleConfirm(userId, {
      fileRef: extractResult.fileRef,
      originalFilename: 'receipt.png',
      channel: 'web_upload',
      accountId: account.id,
      merchantRaw: 'Coffee Shop',
      transactionDate: '2026-09-01',
      amount: 4.5,
      lineItems: [],
    });

    const docs = await documentsService.listDocuments(userId);

    expect(docs).toHaveLength(1);
    expect(docs[0].document_type).toBe('receipt');
    expect(docs[0].transaction_count).toBe(1);
    expect(Number(docs[0].transaction_amount)).toBeCloseTo(-4.5);
    expect(docs[0].status).toBe('parsed');
  });

  it('a confirmed statement with several transactions returns exactly one row with the right count', async () => {
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: account.id, confirmedAt: new Date().toISOString() })]
    );
    for (const [date, desc, amount] of [['2026-01-14', 'Target', -48.23], ['2026-01-15', 'Shell', -30]]) {
      const t = await transactionsService.createTransactionFromStatement(userId, { accountId: account.id, transactionDate: date, amount, merchantRaw: desc });
      await pool.query(`INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`, [t.id, sharedItem.id]);
    }

    const docs = await documentsService.listDocuments(userId);

    expect(docs).toHaveLength(1);
    expect(docs[0].document_type).toBe('bank_statement');
    expect(docs[0].transaction_count).toBe(2);
    expect(docs[0].status).toBe('confirmed');
    expect(docs[0].account_nickname).toBe('Chase Checking');
    expect(docs[0].transaction_merchant_raw).toBeNull(); // ambiguous for >1 transaction, not shown
  });

  it('a statement still being reviewed (no transactions inserted yet) has a resolved account nickname but 0 transaction_count and ready_for_review status', async () => {
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: account.id })]
    );

    const docs = await documentsService.listDocuments(userId);

    expect(docs).toHaveLength(1);
    expect(docs[0].transaction_count).toBe(0);
    expect(docs[0].account_nickname).toBe('Chase Checking');
    expect(docs[0].status).toBe('ready_for_review');
  });

  it('an in-review statement resolved to a different account does not leak into an account-filtered list (F1.7 gap fix Task 6 review)', async () => {
    const otherAccount = await accountsService.createAccount(userId, { type: 'savings', institution_name: 'Chase', nickname: 'Chase Savings', last_four: '9999' });
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    // Resolved to otherAccount, but has zero linked transactions yet (still in review).
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: otherAccount.id })]
    );

    // Filtered by the *original* account (not the one this statement resolved to) — must not appear.
    const docs = await documentsService.listDocuments(userId, { accountId: account.id });

    expect(docs).toHaveLength(0);
  });

  it('an in-review statement resolved to the filtered account still appears with 0 transaction_count', async () => {
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: account.id })]
    );

    const docs = await documentsService.listDocuments(userId, { accountId: account.id });

    expect(docs).toHaveLength(1);
    expect(docs[0].transaction_count).toBe(0);
    expect(docs[0].account_nickname).toBe('Chase Checking');
  });

  it('a statement with transactions in two accounts, filtered by one, is shown with the count narrowed to just that account (partial match)', async () => {
    const otherAccount = await accountsService.createAccount(userId, { type: 'savings', institution_name: 'Chase', nickname: 'Chase Savings', last_four: '9999' });
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: account.id, confirmedAt: new Date().toISOString() })]
    );
    const t1 = await transactionsService.createTransactionFromStatement(userId, { accountId: account.id, transactionDate: '2026-01-14', amount: -48.23, merchantRaw: 'Target' });
    await pool.query(`INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`, [t1.id, sharedItem.id]);
    const t2 = await transactionsService.createTransactionFromStatement(userId, { accountId: otherAccount.id, transactionDate: '2026-01-15', amount: -30, merchantRaw: 'Shell' });
    await pool.query(`INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`, [t2.id, sharedItem.id]);

    const docs = await documentsService.listDocuments(userId, { accountId: account.id });

    expect(docs).toHaveLength(1);
    expect(docs[0].transaction_count).toBe(1);
    expect(Number(docs[0].transaction_amount)).toBeCloseTo(-48.23);
    expect(docs[0].transaction_merchant_raw).toBe('Target');
  });

  it('a statement with transactions in only a different account is hidden entirely by the filter (full mismatch)', async () => {
    const otherAccount = await accountsService.createAccount(userId, { type: 'savings', institution_name: 'Chase', nickname: 'Chase Savings', last_four: '9999' });
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, parse_status) VALUES ($1, 'web_upload', 'file', 'x.png', 'parsed') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO documents (shared_item_id, document_type, extracted_data) VALUES ($1, 'bank_statement', $2)`,
      [sharedItem.id, JSON.stringify({ resolvedAccountId: otherAccount.id, confirmedAt: new Date().toISOString() })]
    );
    const t1 = await transactionsService.createTransactionFromStatement(userId, { accountId: otherAccount.id, transactionDate: '2026-01-14', amount: -48.23, merchantRaw: 'Target' });
    await pool.query(`INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`, [t1.id, sharedItem.id]);

    const docs = await documentsService.listDocuments(userId, { accountId: account.id });

    expect(docs).toHaveLength(0);
  });
});
