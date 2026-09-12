const { config } = require('../config');

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
{"merchant": string or null, "date": string or null, "total": number or null, "line_items": [{"description": string, "amount": number}] or []}

Rules:
- If the image is too blurry, dark, cut off, or otherwise not a readable receipt, return all fields as null/empty (total: null).
- merchant: the store/business name at the top of the receipt.
- total: the final total/amount charged, not the subtotal, however it is labeled (e.g. "Total", "AMT DUE", "Balance"). Only a valid positive number if you can actually read it; null otherwise.
- date: the transaction date shown on the receipt, if legible.
- line_items: each purchased item and its price, if legible. Empty array if not legible or not itemized.`;

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
    throw new Error(`ollama vision response was not valid JSON: ${err.message}`);
  }
}

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
        format: 'json',
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
    return parseModelJson(body.response);
  })();

  return Promise.race([call, timeout]);
}

module.exports = { extractReceipt, PROMPT_TEMPLATE, EXTRACTION_TIMEOUT_MS };
