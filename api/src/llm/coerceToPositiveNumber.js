// Shared across every place that validates a numeric field pulled out of an LLM response
// (chat/validateExtraction.js, documents/validateReceiptExtraction.js). A prompt schema asking
// for a JSON number is a request, not a guarantee — observed in production use: a real receipt
// made the vision model return `"total": "11.29"` as a JSON string instead of a number, which a
// strict `typeof === 'number'` check rejected outright. Accepts a genuine number OR a numeric
// string (optionally with a leading "$" and/or thousands commas, since a real-world money value
// can come back formatted either way) rather than rejecting a value the model actually got right.
function coerceToPositiveNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/^\$/, '').replace(/,/g, '');
    if (cleaned === '') {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

module.exports = { coerceToPositiveNumber };
