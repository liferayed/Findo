#!/usr/bin/env node
// Boots the real API server as a black box and hits it over HTTP, to catch
// anything a unit or integration test wouldn't (wrong entry point, crash on
// boot, wrong port wiring, static files not actually served).
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const API_PORT = process.env.SMOKE_API_PORT || 3999;
const REPO_ROOT = path.join(__dirname, '..');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
  });
}

function httpRequestJson(method, url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpPostJson(url, payload) {
  return httpRequestJson('POST', url, payload);
}

function httpPatchJson(url, payload) {
  return httpRequestJson('PATCH', url, payload);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await httpGet(url);
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`server at ${url} did not become ready: ${lastErr && lastErr.message}`);
}

function assertThat(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`  ok - ${message}`);
}

async function isOllamaReachable() {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  try {
    const res = await httpGet(`${ollamaBaseUrl}/api/version`);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function run() {
  console.log(`Starting API on port ${API_PORT}...`);

  const api = spawn('node', ['src/server.js'], {
    cwd: path.join(REPO_ROOT, 'api'),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://findo:findo@localhost:5432/findo',
      REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let apiOutput = '';
  api.stdout.on('data', (chunk) => (apiOutput += chunk.toString()));
  api.stderr.on('data', (chunk) => (apiOutput += chunk.toString()));

  try {
    await waitForServer(`http://localhost:${API_PORT}/health`, 15000);

    const health = await httpGet(`http://localhost:${API_PORT}/health`);
    assertThat(health.status === 200, 'GET /health returns 200');
    const healthBody = JSON.parse(health.body);
    assertThat(healthBody.status === 'ok', 'GET /health reports overall status ok');
    assertThat(healthBody.subsystems.postgres.status === 'ok', 'postgres subsystem healthy');
    assertThat(healthBody.subsystems.redis.status === 'ok', 'redis subsystem healthy');
    assertThat(healthBody.subsystems.queue.status === 'ok', 'queue subsystem healthy');

    // Since F1.5, a non-account-creation message is routed through LLM-based transaction
    // extraction first. With Ollama reachable, "not a transaction" falls through to the
    // original generic echo (201). With Ollama unreachable (e.g. CI, no Ollama installed),
    // the handler degrades gracefully to an apologetic reply (200) instead of erroring —
    // both are correct, environment-dependent outcomes, not a pass/fail signal on their own.
    const chat = await httpPostJson(`http://localhost:${API_PORT}/chat/messages`, { text: 'smoke test message' });
    assertThat(chat.status === 201 || chat.status === 200, 'POST /chat/messages returns 200 or 201');
    const chatBody = JSON.parse(chat.body);
    assertThat(chatBody.received === 'smoke test message', 'chat echo returns the submitted text');

    const chatShell = await httpGet(`http://localhost:${API_PORT}/chat/chat.html`);
    assertThat(chatShell.status === 200, 'chat shell static page is served');

    const uniqueSuffix = Date.now();
    const created = await httpPostJson(`http://localhost:${API_PORT}/accounts`, {
      nickname: `Smoke-Test-Checking-${uniqueSuffix}`,
      type: 'checking',
      institution_name: 'Smoke Bank',
      last_four: '4242',
    });
    assertThat(created.status === 201, 'POST /accounts returns 201');
    const createdAccount = JSON.parse(created.body);
    assertThat(createdAccount.nickname === `Smoke-Test-Checking-${uniqueSuffix}`, 'created account has the submitted nickname');

    const list = await httpGet(`http://localhost:${API_PORT}/accounts`);
    assertThat(list.status === 200, 'GET /accounts returns 200');
    const accounts = JSON.parse(list.body);
    assertThat(
      accounts.some((a) => a.id === createdAccount.id),
      'the newly created account appears in GET /accounts'
    );

    const updated = await httpPatchJson(`http://localhost:${API_PORT}/accounts/${createdAccount.id}`, {
      is_active: false,
    });
    assertThat(updated.status === 200, 'PATCH /accounts/:id returns 200');
    assertThat(JSON.parse(updated.body).is_active === false, 'PATCH /accounts/:id applies the update');

    const duplicate = await httpPostJson(`http://localhost:${API_PORT}/accounts`, {
      nickname: `Smoke-Test-Checking-${uniqueSuffix}`,
      type: 'savings',
      institution_name: 'Smoke Bank',
    });
    assertThat(duplicate.status === 409, 'POST /accounts rejects a duplicate nickname with 409');

    const smokeTxnAccount = await httpPostJson(`http://localhost:${API_PORT}/accounts`, {
      nickname: `Smoke-Test-Txn-Checking-${uniqueSuffix}`,
      type: 'checking',
      institution_name: 'Smoke Bank',
    });
    assertThat(smokeTxnAccount.status === 201, 'POST /accounts (for transaction smoke coverage) returns 201');
    const smokeTxnAccountBody = JSON.parse(smokeTxnAccount.body);

    const createdDebit = await httpPostJson(`http://localhost:${API_PORT}/transactions`, {
      account_id: smokeTxnAccountBody.id,
      transaction_date: '2026-01-15',
      amount: 42.5,
      type: 'debit',
      merchant_raw: 'Smoke Test Coffee',
    });
    assertThat(createdDebit.status === 201, 'POST /transactions returns 201');
    const createdDebitBody = JSON.parse(createdDebit.body);
    assertThat(Number(createdDebitBody.amount) === -42.5, 'a debit transaction is stored with a negative amount');

    const invalidTxn = await httpPostJson(`http://localhost:${API_PORT}/transactions`, {
      account_id: smokeTxnAccountBody.id,
      transaction_date: '2026-01-15',
      amount: 10,
      type: 'transfer',
      merchant_raw: 'Smoke Test Transfer',
    });
    assertThat(invalidTxn.status === 400, 'POST /transactions rejects a transfer type with 400');

    const txnList = await httpGet(`http://localhost:${API_PORT}/accounts/${smokeTxnAccountBody.id}/transactions`);
    assertThat(txnList.status === 200, 'GET /accounts/:id/transactions returns 200');
    const txnListBody = JSON.parse(txnList.body);
    assertThat(
      txnListBody.some((t) => t.id === createdDebitBody.id),
      'the newly created transaction appears in GET /accounts/:id/transactions'
    );

    const chatAccount = await httpPostJson(`http://localhost:${API_PORT}/chat/messages`, {
      text: `Add my Smoke Chat Bank checking account, call it Smoke-Chat-Checking-${uniqueSuffix}`,
    });
    assertThat(chatAccount.status === 201, 'chat "add account" message creates an account (201)');
    assertThat(
      JSON.parse(chatAccount.body).reply.includes(`Smoke-Chat-Checking-${uniqueSuffix}`),
      'chat reply confirms the account nickname'
    );

    // F1.5: chat-based transaction capture, against the real local Ollama instance. Skipped
    // when Ollama isn't reachable (e.g. CI, which has no GPU/CPU budget for local LLM
    // inference) rather than failing the whole smoke run — run `npm run test:integration:llm
    // --workspace=api` locally for full coverage of this path.
    if (await isOllamaReachable()) {
      const chatTxnAccount = await httpPostJson(`http://localhost:${API_PORT}/accounts`, {
        nickname: `Smoke-Chat-Txn-Checking-${uniqueSuffix}`,
        type: 'checking',
        institution_name: 'Smoke Bank',
      });
      assertThat(chatTxnAccount.status === 201, 'POST /accounts (for chat transaction smoke coverage) returns 201');
      const chatTxnAccountBody = JSON.parse(chatTxnAccount.body);

      // Deactivate every other active account for the seeded user so exactly one is active,
      // making the "no account_hint, single active account" auto-resolve path deterministic
      // regardless of how many accounts earlier smoke runs (or earlier steps in this run)
      // have left active.
      const allAccountsRes = await httpGet(`http://localhost:${API_PORT}/accounts`);
      const allAccounts = JSON.parse(allAccountsRes.body);
      for (const acct of allAccounts) {
        if (acct.id !== chatTxnAccountBody.id && acct.is_active) {
          await httpPatchJson(`http://localhost:${API_PORT}/accounts/${acct.id}`, { is_active: false });
        }
      }

      const chatTxn = await httpPostJson(`http://localhost:${API_PORT}/chat/messages`, {
        text: 'Spent $12.50 at Starbucks today',
      });
      assertThat(chatTxn.status === 201, 'a clear chat transaction message returns 201');
      const chatTxnBody = JSON.parse(chatTxn.body);
      assertThat(chatTxnBody.reply.includes('Starbucks'), 'chat transaction reply mentions the merchant');
      assertThat(
        chatTxnBody.reply.includes(`Smoke-Chat-Txn-Checking-${uniqueSuffix}`),
        'chat transaction reply confirms the resolved account nickname'
      );

      const chatTxnList = await httpGet(`http://localhost:${API_PORT}/accounts/${chatTxnAccountBody.id}/transactions`);
      assertThat(chatTxnList.status === 200, 'GET /accounts/:id/transactions returns 200 for the chat-resolved account');
      const chatTxnListBody = JSON.parse(chatTxnList.body);
      assertThat(chatTxnListBody.length === 1, 'the chat-created transaction appears against the resolved account');
      assertThat(Number(chatTxnListBody[0].amount) === -12.5, 'the chat-created transaction has the correct signed amount');
      assertThat(chatTxnListBody[0].is_manual === false, 'the chat-created transaction is marked is_manual: false');
    } else {
      console.log('  skip - chat transaction capture (Ollama not reachable, expected in CI)');
    }

    console.log('\nSmoke test passed.');
    api.kill('SIGTERM');
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    console.error('\n--- API process output ---\n' + apiOutput);
    api.kill('SIGTERM');
    process.exitCode = 1;
  }
}

run();
