const request = require('supertest');
const { createApp } = require('../src/app');
const { ValidationError, ConflictError, NotFoundError } = require('../src/errors');

const FAKE_USER_ID = '11111111-1111-1111-1111-111111111111';

function buildApp(overrides = {}) {
  return createApp({
    checkHealth: async () => ({ status: 'ok', subsystems: {} }),
    accountsService: {
      createAccount: async () => {
        throw new Error('createAccount not stubbed');
      },
      listAccounts: async () => {
        throw new Error('listAccounts not stubbed');
      },
      updateAccount: async () => {
        throw new Error('updateAccount not stubbed');
      },
    },
    institutionsService: {
      listInstitutions: async () => {
        throw new Error('listInstitutions not stubbed');
      },
      resolveInstitutionAlias: async () => {
        throw new Error('resolveInstitutionAlias not stubbed');
      },
    },
    transactionsService: {
      createTransaction: async () => {
        throw new Error('createTransaction not stubbed');
      },
      listTransactionsForAccount: async () => {
        throw new Error('listTransactionsForAccount not stubbed');
      },
    },
    resolveCurrentUserId: async () => FAKE_USER_ID,
    // Defaults to "not a transaction" so existing generic-echo behavior is unaffected;
    // F1.5-specific tests below override this to exercise the chat transaction-capture path.
    chatTransactionHandler: async () => null,
    receiptUploadHandler: {
      handleExtract: async () => {
        throw new Error('handleExtract not stubbed');
      },
      handleConfirm: async () => {
        throw new Error('handleConfirm not stubbed');
      },
    },
    ...overrides,
  });
}

function appWithHealth(healthResult) {
  return buildApp({ checkHealth: async () => healthResult });
}

describe('GET /health', () => {
  test('returns 200 with the health payload when all subsystems are ok', async () => {
    const res = await request(
      appWithHealth({
        status: 'ok',
        subsystems: {
          postgres: { status: 'ok' },
          redis: { status: 'ok' },
          queue: { status: 'ok' },
        },
      })
    ).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.subsystems.postgres).toEqual({ status: 'ok' });
  });

  test('returns 503 with per-subsystem detail when a subsystem is degraded', async () => {
    const res = await request(
      appWithHealth({
        status: 'degraded',
        subsystems: {
          postgres: { status: 'error', message: 'connection refused' },
          redis: { status: 'ok' },
          queue: { status: 'ok' },
        },
      })
    ).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.subsystems.postgres).toEqual({ status: 'error', message: 'connection refused' });
    expect(res.body.subsystems.redis).toEqual({ status: 'ok' });
  });
});

describe('POST /transactions', () => {
  test('creates a transaction and returns 201', async () => {
    const app = buildApp({
      transactionsService: {
        createTransaction: async (userId, input) => ({ id: 'txn-1', account_id: input.account_id, ...input }),
      },
    });

    const res = await request(app)
      .post('/transactions')
      .send({
        account_id: 'acc-1',
        transaction_date: '2026-01-15',
        amount: 42.5,
        type: 'debit',
        merchant_raw: 'Blue Bottle Coffee',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'txn-1', account_id: 'acc-1' });
  });

  test('returns 400 with the validation errors when the service rejects the input', async () => {
    const app = buildApp({
      transactionsService: {
        createTransaction: async () => {
          throw new ValidationError(['merchant_raw is required']);
        },
      },
    });

    const res = await request(app).post('/transactions').send({ account_id: 'acc-1' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('merchant_raw is required');
  });

  test('returns 404 when the account does not belong to the current user (or does not exist)', async () => {
    const app = buildApp({
      transactionsService: {
        createTransaction: async () => {
          throw new NotFoundError('account not found');
        },
      },
    });

    const res = await request(app)
      .post('/transactions')
      .send({ account_id: 'does-not-exist', transaction_date: '2026-01-15', amount: 10, type: 'debit', merchant_raw: 'Coffee' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('account not found');
  });
});

describe('GET /accounts/:id/transactions', () => {
  test('lists transactions for the given account', async () => {
    const app = buildApp({
      transactionsService: {
        listTransactionsForAccount: async (userId, accountId) => [{ id: 'txn-1', account_id: accountId }],
      },
    });

    const res = await request(app).get('/accounts/acc-1/transactions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'txn-1', account_id: 'acc-1' }]);
  });

  test('returns 404 when the account does not belong to the current user (or does not exist)', async () => {
    const app = buildApp({
      transactionsService: {
        listTransactionsForAccount: async () => {
          throw new NotFoundError('account not found');
        },
      },
    });

    const res = await request(app).get('/accounts/does-not-exist/transactions');

    expect(res.status).toBe(404);
  });
});

describe('POST /chat/messages', () => {
  test('echoes the message back with a reply', async () => {
    const res = await request(appWithHealth({ status: 'ok', subsystems: {} }))
      .post('/chat/messages')
      .send({ text: 'Spent $12 at Starbucks' });

    expect(res.status).toBe(201);
    expect(res.body.received).toBe('Spent $12 at Starbucks');
    expect(res.body.reply).toEqual(expect.stringContaining('Spent $12 at Starbucks'));
  });

  test('rejects blank text with 400 instead of creating anything', async () => {
    const res = await request(appWithHealth({ status: 'ok', subsystems: {} }))
      .post('/chat/messages')
      .send({ text: '   ' });

    expect(res.status).toBe(400);
  });

  test('an "add my ... account" message creates an account via the shared service', async () => {
    let receivedInput;
    const app = buildApp({
      institutionsService: {
        listInstitutions: async () => [],
        resolveInstitutionAlias: async () => null,
      },
      accountsService: {
        createAccount: async (userId, input) => {
          receivedInput = { userId, input };
          return { id: 'acc-1', nickname: input.nickname, type: input.type, institution_name: input.institution_name };
        },
      },
    });

    const res = await request(app)
      .post('/chat/messages')
      .send({ text: 'Add my Chase checking account, call it Chase-Checking' });

    expect(res.status).toBe(201);
    expect(receivedInput).toEqual({
      userId: FAKE_USER_ID,
      input: { institution_name: 'Chase', type: 'checking', nickname: 'Chase-Checking' },
    });
    expect(res.body.reply).toEqual(expect.stringContaining('Chase-Checking'));
  });

  test('an unparseable "add ... account" message asks for the account type instead of guessing', async () => {
    let called = false;
    const app = buildApp({
      accountsService: {
        createAccount: async () => {
          called = true;
        },
      },
    });

    const res = await request(app).post('/chat/messages').send({ text: 'Add my Chase account please' });

    expect(called).toBe(false);
    expect(res.status).toBe(200);
    expect(res.body.reply.toLowerCase()).toContain('checking, savings, credit card, brokerage, loan');
  });

  test('a duplicate-nickname account-creation message surfaces the conflict in the chat reply', async () => {
    const app = buildApp({
      institutionsService: {
        listInstitutions: async () => [],
        resolveInstitutionAlias: async () => null,
      },
      accountsService: {
        createAccount: async () => {
          throw new ConflictError('an account named "Chase-Checking" already exists');
        },
      },
    });

    const res = await request(app)
      .post('/chat/messages')
      .send({ text: 'Add my Chase checking account, call it Chase-Checking' });

    expect(res.status).toBe(409);
    expect(res.body.reply).toEqual(expect.stringContaining('already exists'));
  });
});

describe('POST /chat/messages — account creation resolves institution aliases', () => {
  test('resolves a known alias to its canonical name before creating the account', async () => {
    let capturedInput = null;
    const res = await request(
      buildApp({
        institutionsService: {
          listInstitutions: async () => [],
          // Deliberately returns a value that DIFFERS from the raw parsed text ("Chase"), so
          // this test can only pass once the route actually uses the resolver's return value —
          // if it stubbed resolveInstitutionAlias to return "Chase" itself, the raw-text
          // fallback path would produce the same result by coincidence and the test would pass
          // before the feature is wired up, hiding a real red-green gap.
          resolveInstitutionAlias: async (rawText) => (rawText === 'Chase' ? 'Chase Canonical Test' : null),
        },
        accountsService: {
          createAccount: async (userId, input) => {
            capturedInput = input;
            return { id: 'a1', nickname: input.nickname, institution_name: input.institution_name, type: input.type };
          },
          listAccounts: async () => [],
          updateAccount: async () => {
            throw new Error('updateAccount not stubbed');
          },
        },
      })
    ).post('/chat/messages').send({ text: 'Add my Chase checking account' });

    expect(res.status).toBe(201);
    expect(capturedInput.institution_name).toBe('Chase Canonical Test');
  });

  test('falls back to the raw parsed text when no alias matches', async () => {
    let capturedInput = null;
    const res = await request(
      buildApp({
        institutionsService: {
          listInstitutions: async () => [],
          resolveInstitutionAlias: async () => null,
        },
        accountsService: {
          createAccount: async (userId, input) => {
            capturedInput = input;
            return { id: 'a1', nickname: input.nickname, institution_name: input.institution_name, type: input.type };
          },
          listAccounts: async () => [],
          updateAccount: async () => {
            throw new Error('updateAccount not stubbed');
          },
        },
      })
    ).post('/chat/messages').send({ text: 'Add my Local Credit Union checking account' });

    expect(res.status).toBe(201);
    expect(capturedInput.institution_name).toBe('Local Credit Union');
  });
});

describe('POST /chat/messages — F1.5 transaction capture wiring', () => {
  test('delegates non-account-creation messages to chatTransactionHandler with the resolved user id and text', async () => {
    let received;
    const app = buildApp({
      chatTransactionHandler: async (userId, text) => {
        received = { userId, text };
        return { statusCode: 201, reply: 'Got it — logged $12.50 at Starbucks (debit) on Chase-Checking.' };
      },
    });

    const res = await request(app).post('/chat/messages').send({ text: 'Spent $12.50 at Starbucks today' });

    expect(received).toEqual({ userId: FAKE_USER_ID, text: 'Spent $12.50 at Starbucks today' });
    expect(res.status).toBe(201);
    expect(res.body.reply).toBe('Got it — logged $12.50 at Starbucks (debit) on Chase-Checking.');
  });

  test('uses the statusCode chatTransactionHandler returns (e.g. 200 for a clarification question)', async () => {
    const app = buildApp({
      chatTransactionHandler: async () => ({
        statusCode: 200,
        reply: 'Which account was this on? You have: Chase-Checking, Ally-Savings.',
      }),
    });

    const res = await request(app).post('/chat/messages').send({ text: 'Spent $45 on my Chase checking' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Which account was this on? You have: Chase-Checking, Ally-Savings.');
  });

  test('falls through to the generic chat echo when chatTransactionHandler returns null (not a transaction)', async () => {
    const app = buildApp({ chatTransactionHandler: async () => null });

    const res = await request(app).post('/chat/messages').send({ text: 'How is my balance looking?' });

    expect(res.status).toBe(201);
    expect(res.body.reply).toEqual(expect.stringContaining('How is my balance looking?'));
  });

  test('an "add ... account" message never reaches chatTransactionHandler', async () => {
    let called = false;
    const app = buildApp({
      institutionsService: {
        listInstitutions: async () => [],
        resolveInstitutionAlias: async () => null,
      },
      accountsService: {
        createAccount: async (userId, input) => ({ id: 'acc-1', ...input }),
      },
      chatTransactionHandler: async () => {
        called = true;
        return null;
      },
    });

    const res = await request(app)
      .post('/chat/messages')
      .send({ text: 'Add my Chase checking account, call it Chase-Checking' });

    expect(res.status).toBe(201);
    expect(called).toBe(false);
  });
});

describe('POST /documents/extract', () => {
  test('a successful extraction returns 200 with file_ref, extraction, and detected_account_id', async () => {
    let received;
    const app = buildApp({
      receiptUploadHandler: {
        handleExtract: async (userId, args) => {
          received = { userId, ...args, fileFieldPresent: Boolean(args.file) };
          return {
            fileRef: 'api/uploads/receipts/abc123.png',
            isReadable: true,
            extraction: {
              merchant: 'Blue Bottle Coffee',
              transactionDate: '2026-01-15',
              total: 15.75,
              lineItems: [],
            },
            detectedAccountId: 'acc-1',
          };
        },
      },
    });

    const res = await request(app)
      .post('/documents/extract')
      .field('channel', 'web_upload')
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'receipt.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      file_ref: 'api/uploads/receipts/abc123.png',
      original_filename: 'receipt.png',
      is_readable: true,
      extraction: {
        merchant: 'Blue Bottle Coffee',
        transaction_date: '2026-01-15',
        total: 15.75,
        line_items: [],
      },
      detected_account_id: 'acc-1',
    });
    expect(received.userId).toBe(FAKE_USER_ID);
    expect(received.channel).toBe('web_upload');
    expect(received.fileFieldPresent).toBe(true);
  });

  test('an illegible-receipt outcome returns 200 with is_readable false and a null extraction', async () => {
    const app = buildApp({
      receiptUploadHandler: {
        handleExtract: async () => ({
          fileRef: 'api/uploads/receipts/blurry.png',
          isReadable: false,
          extraction: null,
          detectedAccountId: null,
        }),
      },
    });

    const res = await request(app)
      .post('/documents/extract')
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'blurry.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.is_readable).toBe(false);
    expect(res.body.extraction).toBeNull();
  });

  test('propagates a ValidationError from the handler as 400', async () => {
    const app = buildApp({
      receiptUploadHandler: {
        handleExtract: async () => {
          throw new ValidationError(["Only JPEG/PNG images are supported right now — PDF receipts aren't yet handled."]);
        },
      },
    });

    const res = await request(app)
      .post('/documents/extract')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'receipt.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Only JPEG/PNG images are supported right now — PDF receipts aren't yet handled.");
  });

  test('a request with no file at all still reaches the handler, which rejects it', async () => {
    const app = buildApp({
      receiptUploadHandler: {
        handleExtract: async (userId, { file }) => {
          expect(file).toBeUndefined();
          throw new ValidationError(['file is required']);
        },
      },
    });

    const res = await request(app).post('/documents/extract');

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('file is required');
  });

  // Guards against buffering an unbounded upload into memory before rejecting it: multer's own
  // `limits.fileSize` (wired in app.js) must reject an oversized file during the multipart
  // parse itself, before receiptUploadHandler.handleExtract — and thus
  // documents/validateReceiptUpload.js — is ever reached, while still producing the exact same
  // 400 shape/message a request that did reach validateReceiptUpload would get.
  test('an oversized file is rejected by multer itself, before the extract handler ever runs', async () => {
    let handlerCalled = false;
    const app = buildApp({
      receiptUploadHandler: {
        handleExtract: async () => {
          handlerCalled = true;
          throw new Error('should not be reached — multer should reject this upload first');
        },
      },
    });

    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 1);

    const res = await request(app)
      .post('/documents/extract')
      .attach('file', oversizedBuffer, { filename: 'huge.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('File is too large — receipts must be 10MB or smaller.');
    expect(handlerCalled).toBe(false);
  });
});

describe('POST /documents/confirm', () => {
  test('a successful confirm returns 201 with document_id, transaction, and message', async () => {
    let received;
    const app = buildApp({
      receiptUploadHandler: {
        handleConfirm: async (userId, args) => {
          received = { userId, ...args };
          return {
            statusCode: 201,
            documentId: 'doc-1',
            transaction: { id: 'txn-1', amount: '-15.75' },
            message: 'Got it — logged $15.75 at Blue Bottle Coffee (debit).',
          };
        },
      },
    });

    const res = await request(app).post('/documents/confirm').send({
      file_ref: 'api/uploads/receipts/abc123.png',
      original_filename: 'receipt.png',
      channel: 'web_upload',
      account_id: 'acc-1',
      merchant: 'Blue Bottle Coffee',
      transaction_date: '2026-01-15',
      amount: 15.75,
      line_items: [],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      document_id: 'doc-1',
      transaction: { id: 'txn-1', amount: '-15.75' },
      message: 'Got it — logged $15.75 at Blue Bottle Coffee (debit).',
    });
    expect(received.userId).toBe(FAKE_USER_ID);
    expect(received.fileRef).toBe('api/uploads/receipts/abc123.png');
    expect(received.originalFilename).toBe('receipt.png');
    expect(received.accountId).toBe('acc-1');
    expect(received.merchantRaw).toBe('Blue Bottle Coffee');
    expect(received.transactionDate).toBe('2026-01-15');
    expect(received.amount).toBe(15.75);
    expect(received.lineItems).toEqual([]);
  });

  test('propagates a ValidationError from the handler as 400', async () => {
    const app = buildApp({
      receiptUploadHandler: {
        handleConfirm: async () => {
          throw new ValidationError(['account_id is required']);
        },
      },
    });

    const res = await request(app).post('/documents/confirm').send({ merchant: 'Blue Bottle Coffee', amount: 15.75 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('account_id is required');
  });

  test('propagates a NotFoundError from the handler as 404 (bad account_id)', async () => {
    const app = buildApp({
      receiptUploadHandler: {
        handleConfirm: async () => {
          throw new NotFoundError('account not found');
        },
      },
    });

    const res = await request(app).post('/documents/confirm').send({
      file_ref: 'api/uploads/receipts/abc123.png',
      account_id: 'does-not-exist',
      merchant: 'Blue Bottle Coffee',
      amount: 15.75,
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('account not found');
  });
});

describe('POST /accounts', () => {
  test('creates an account and returns 201', async () => {
    const app = buildApp({
      accountsService: {
        createAccount: async (userId, input) => ({ id: 'acc-1', user_id: userId, ...input }),
      },
    });

    const res = await request(app)
      .post('/accounts')
      .send({ nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'acc-1', nickname: 'Chase-Checking' });
  });

  test('returns 400 with the validation errors when the service rejects the input', async () => {
    const app = buildApp({
      accountsService: {
        createAccount: async () => {
          throw new ValidationError(['nickname is required']);
        },
      },
    });

    const res = await request(app).post('/accounts').send({ type: 'checking', institution_name: 'Chase' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('nickname is required');
  });

  test('returns 409 when the service reports a duplicate nickname', async () => {
    const app = buildApp({
      accountsService: {
        createAccount: async () => {
          throw new ConflictError('an account named "Chase-Checking" already exists');
        },
      },
    });

    const res = await request(app)
      .post('/accounts')
      .send({ nickname: 'Chase-Checking', type: 'checking', institution_name: 'Chase' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });
});

describe('GET /accounts', () => {
  test('lists accounts for the current user', async () => {
    const app = buildApp({
      accountsService: {
        listAccounts: async (userId) => [{ id: 'acc-1', user_id: userId, nickname: 'Chase-Checking' }],
      },
    });

    const res = await request(app).get('/accounts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'acc-1', user_id: FAKE_USER_ID, nickname: 'Chase-Checking' }]);
  });
});

describe('PATCH /accounts/:id', () => {
  test('updates an account and returns it', async () => {
    const app = buildApp({
      accountsService: {
        updateAccount: async (userId, accountId, input) => ({ id: accountId, user_id: userId, ...input }),
      },
    });

    const res = await request(app).patch('/accounts/acc-1').send({ nickname: 'New-Name' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'acc-1', nickname: 'New-Name' });
  });

  test('returns 404 when the account does not belong to the current user (or does not exist)', async () => {
    const app = buildApp({
      accountsService: {
        updateAccount: async () => {
          throw new NotFoundError('account not found');
        },
      },
    });

    const res = await request(app).patch('/accounts/does-not-exist').send({ nickname: 'New-Name' });

    expect(res.status).toBe(404);
  });
});

describe('GET /institutions', () => {
  test('returns 200 with the institution list', async () => {
    const res = await request(
      buildApp({
        institutionsService: {
          listInstitutions: async () => [
            { id: 'i1', canonical_name: 'Chase', aliases: ['Chase', 'Chase Bank'] },
            { id: 'i2', canonical_name: 'Wells Fargo', aliases: ['Wells Fargo'] },
          ],
          resolveInstitutionAlias: async () => null,
        },
      })
    ).get('/institutions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'i1', canonical_name: 'Chase', aliases: ['Chase', 'Chase Bank'] },
      { id: 'i2', canonical_name: 'Wells Fargo', aliases: ['Wells Fargo'] },
    ]);
  });
});
