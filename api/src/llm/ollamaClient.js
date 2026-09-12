const { config } = require('../config');

// Cold-start model load can take several seconds; warm calls are ~1-2s per the brief's
// spike. 20s gives real headroom without letting a stuck call hang the HTTP request.
const EXTRACTION_TIMEOUT_MS = 20000;

// Exact prompt template proven against the real model — substitute {{MESSAGE}} verbatim,
// do not paraphrase or wrap it further.
const PROMPT_TEMPLATE = `Extract transaction details from this chat message. Respond with ONLY a JSON object, no other text.

Schema:
{"is_transaction": boolean, "amount": number or null, "merchant": string or null, "type": "debit" or "credit" or null, "date_hint": string or null, "account_hint": string or null}

Rules:
- is_transaction: false if the message is not describing a purchase, expense, payment, or income (e.g. a question).
- type: "debit" for money spent/paid out (a purchase, a bill payment), "credit" for money received (a paycheck, a refund, a deposit). null if unclear.
- amount: always a positive number (the magnitude), never negative.
- date_hint: capture relative date words like "today", "yesterday", or an explicit date, as the user wrote it. null if not mentioned.
- account_hint: capture any account name/nickname the user mentioned. null if not mentioned.

Message: "{{MESSAGE}}"`;

function buildPrompt(message) {
  return PROMPT_TEMPLATE.replace('{{MESSAGE}}', message);
}

function parseModelJson(responseText) {
  try {
    return JSON.parse(responseText);
  } catch (err) {
    // Defensive fallback: the model is asked for pure JSON via format:"json", but strip a
    // stray markdown code fence before giving up, rather than crashing the caller.
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(responseText || '');
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // fall through to throw below
      }
    }
    throw new Error(`ollama response was not valid JSON: ${err.message}`);
  }
}

/**
 * Calls the local Ollama instance to extract structured transaction fields from a raw chat
 * message. Config-driven (OLLAMA_BASE_URL/OLLAMA_MODEL) per Decision 11, so moving to a
 * home-server-hosted instance later is a config change, not a redesign.
 *
 * Resolves with the raw parsed JSON object from the model (untrusted — callers must validate
 * it, see chat/validateExtraction.js). Rejects if the endpoint is unreachable, times out, or
 * returns something that can't be parsed as JSON at all; callers are expected to treat that
 * as "couldn't process this message right now" and never let it crash the request.
 */
async function extractTransaction(message, { timeoutMs = EXTRACTION_TIMEOUT_MS } = {}) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`ollama extraction timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const call = (async () => {
    const res = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: buildPrompt(message),
        format: 'json',
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama request failed with HTTP ${res.status}`);
    }

    const body = await res.json();
    return parseModelJson(body.response);
  })();

  return Promise.race([call, timeout]);
}

module.exports = { extractTransaction, buildPrompt, PROMPT_TEMPLATE, EXTRACTION_TIMEOUT_MS };
