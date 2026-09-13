// Shared by ollamaClient.js and ollamaVisionClient.js — was duplicated identically between the
// two (only the error label differed) until this extraction.
//
// `format` being a JSON Schema (see coerceToPositiveNumber.js's callers) constrains field
// *types* once the model does return valid JSON, but doesn't guarantee the response is valid
// JSON in the first place — a model can still occasionally wrap its output in a markdown code
// fence despite instructions not to. Strip that before giving up, rather than crashing the
// caller.
function parseModelJson(responseText, label = 'ollama') {
  try {
    return JSON.parse(responseText);
  } catch (err) {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(responseText || '');
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // fall through to throw below
      }
    }
    throw new Error(`${label} response was not valid JSON: ${err.message}`);
  }
}

module.exports = { parseModelJson };
