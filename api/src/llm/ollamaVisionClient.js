const { config } = require('../config');
const { parseModelJson } = require('./parseModelJson');

// Vision extraction is slower than F1.5's text extraction — observed ~4.3s warm on the
// commander's spike machine, cold start can be much longer (~14s observed once). 30s gives
// real headroom without letting a stuck call hang the HTTP request indefinitely.
const EXTRACTION_TIMEOUT_MS = 30000;

// Exact prompt template proven against the real model (qwen2.5vl:3b) during the commander's
// spike — substitute nothing, use verbatim. Deliberately has NO "legible" self-reported field:
// an earlier version of this prompt included one and it was unreliable (see
// validateReceiptExtraction.js) — success is gated purely on `total` being a valid positive
// number, not on anything the model says about its own confidence.
const PROMPT_TEMPLATE = `Extract the following fields from this receipt image. Respond with ONLY a JSON object, no other text.

Schema:
{"merchant": string or null, "date": string or null, "total": number or null, "line_items": [{"description": string, "amount": number}] or [], "card_last_four": string or null}

Rules:
- If the image is too blurry, dark, cut off, or otherwise not a readable receipt, return all fields as null/empty (total: null).
- merchant: the store/business name at the top of the receipt.
- total: the final total/amount charged, not the subtotal, however it is labeled (e.g. "Total", "AMT DUE", "Balance"). Only a valid positive number if you can actually read it; null otherwise.
- date: the transaction date shown on the receipt, if legible.
- line_items: each purchased item and its price, if legible. Empty array if not legible or not itemized.
- card_last_four: the last 4 digits of the payment card if printed on the receipt (e.g. "VISA ****4821" or "ending in 4821"), as a 4-character string. Null if not present or not legible.`;

// Passed as `format` instead of the string "json" — a real JSON Schema, so Ollama constrains
// generation to conform to it (grammar-constrained decoding), not just a prompt instruction the
// model can ignore. This is what actually fixes the real bug that prompted it: a real
// photographed receipt made this model return `"total": "11.29"` as a JSON string under plain
// format:"json" mode; under this schema, the same image reliably returns a real JSON number.
// The defensive coercion in documents/validateReceiptExtraction.js (coerceToPositiveNumber)
// stays in place as a second line of defense, not a replacement for this fix.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    total: { type: ['number', 'null'] },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['description', 'amount'],
      },
    },
    card_last_four: { type: ['string', 'null'] },
  },
  required: ['merchant', 'date', 'total', 'line_items', 'card_last_four'],
};

/**
 * Calls the local Ollama vision model to extract structured receipt fields from an image.
 * Config-driven (OLLAMA_BASE_URL/OLLAMA_VISION_MODEL), same shape as F1.5's
 * llm/ollamaClient.js's extractTransaction.
 *
 * `imageBase64` is the raw base64-encoded image bytes (no `data:` URI prefix).
 *
 * Resolves with the raw parsed JSON object from the model (untrusted — callers must validate
 * it via documents/validateReceiptExtraction.js). Rejects if the endpoint is unreachable,
 * times out, or returns something that can't be parsed as JSON at all; callers are expected to
 * treat that as "couldn't read this receipt" and never let it crash the request or fabricate a
 * transaction.
 */
async function extractReceipt(imageBase64, { timeoutMs = EXTRACTION_TIMEOUT_MS } = {}) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`ollama vision extraction timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const call = (async () => {
    const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaVisionModel,
        prompt: PROMPT_TEMPLATE,
        images: [imageBase64],
        format: RESPONSE_SCHEMA,
        stream: false,
        // temperature: 0 — structured field extraction wants determinism, not creative
        // sampling. Verified (commander spike) this eliminates the run-to-run variance
        // observed at the default temperature across repeated calls on the same image.
        options: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama vision request failed with HTTP ${res.status}`);
    }

    const body = await res.json();
    return parseModelJson(body.response, 'ollama vision');
  })();

  return Promise.race([call, timeout]);
}

// Statements need a higher context window than F1.6's cropped receipt photos — the brainstorm
// spike found a single 200-DPI full statement page overflowed Ollama's default 4096-token
// context. 60s (vs. receipt's 30s) reflects the spike's ~50-85s/page observation.
const STATEMENT_EXTRACTION_TIMEOUT_MS = 60000;

const STATEMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          description: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['date', 'description', 'amount'],
      },
    },
    beginning_balance: { type: ['number', 'null'] },
    ending_balance: { type: ['number', 'null'] },
    institution_name: { type: ['string', 'null'] },
    account_type_text: { type: ['string', 'null'] },
    last_four: { type: ['string', 'null'] },
    credit_card: {
      type: ['object', 'null'],
      properties: {
        due_date: { type: ['string', 'null'] },
        minimum_payment: { type: ['number', 'null'] },
        issuer: { type: ['string', 'null'] },
        credit_limit: { type: ['number', 'null'] },
        apr: { type: ['number', 'null'] },
      },
    },
  },
  required: ['transactions', 'beginning_balance', 'ending_balance'],
};

function statementPromptFor(isFirstPage) {
  const headerFields = isFirstPage
    ? ` Also extract, from this first page only: institution_name (the bank/card issuer's name as printed), account_type_text (e.g. "Total Checking", "Platinum Card"), last_four (the last 4 digits of the account/card number, as a 4-character string), and credit_card (an object with due_date, minimum_payment, issuer, credit_limit, apr — each null if this is not a credit card statement or the field isn't printed).`
    : '';
  return `Extract every transaction row from this bank/card statement page image. Respond with ONLY a JSON object, no other text.

Schema:
{"transactions": [{"date": string, "description": string, "amount": number}], "beginning_balance": number or null, "ending_balance": number or null}

Rules:
- transactions: every row in the transaction table on this page, in order. date as YYYY-MM-DD. amount signed (debit negative, credit positive).
- beginning_balance/ending_balance: only if this exact page prints them (many continuation pages don't) — null if not printed on THIS page. Never estimate or infer one.${headerFields}`;
}

/**
 * Calls the local Ollama vision model to extract one statement page's transactions and
 * (first page only) header fields. Same shape as extractReceipt, but with the higher context
 * window and longer timeout statements need (see the F1.7 brainstorm's spike). Resolves with
 * the raw parsed JSON (untrusted — callers validate via documents/validateStatementExtraction.js).
 */
async function extractStatementPage(imageBase64, { isFirstPage = false, timeoutMs = STATEMENT_EXTRACTION_TIMEOUT_MS } = {}) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`ollama vision statement extraction timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const call = (async () => {
    const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaVisionModel,
        prompt: statementPromptFor(isFirstPage),
        images: [imageBase64],
        format: STATEMENT_RESPONSE_SCHEMA,
        stream: false,
        options: { temperature: 0, num_ctx: 8192 },
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama vision statement request failed with HTTP ${res.status}`);
    }

    const body = await res.json();
    return parseModelJson(body.response, 'ollama vision statement');
  })();

  return Promise.race([call, timeout]);
}

module.exports = {
  extractReceipt,
  extractStatementPage,
  PROMPT_TEMPLATE,
  RESPONSE_SCHEMA,
  EXTRACTION_TIMEOUT_MS,
  STATEMENT_RESPONSE_SCHEMA,
  STATEMENT_EXTRACTION_TIMEOUT_MS,
};
