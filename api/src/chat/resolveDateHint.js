const RELATIVE_HINTS = new Set(['today', 'yesterday']);

function toUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function tryParseExplicitDate(hint) {
  // Straightforward YYYY-MM-DD, validated for real calendar dates (not just regex shape).
  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.exec(hint);
  if (isoMatch) {
    const [year, month, day] = hint.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const isReal =
      candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
    return isReal ? candidate : null;
  }

  // Fall back to whatever Date.parse can make of it (e.g. "June 1, 2026"). Garbage
  // strings like "on Checking" reliably produce NaN here, which we treat as "no date".
  const parsedMs = Date.parse(hint);
  if (Number.isNaN(parsedMs)) {
    return null;
  }
  const parsed = new Date(parsedMs);
  return toUtcMidnight(parsed);
}

/**
 * Resolves an LLM-extracted `date_hint` (untrusted, possibly missing/null/garbage) into a
 * real `transaction_date` string (YYYY-MM-DD). Never throws — anything it can't confidently
 * parse falls back to `now` (today), per the brief's "never block transaction creation on a
 * bad date_hint" rule.
 */
function resolveDateHint(dateHint, now = new Date()) {
  const today = toUtcMidnight(now);

  if (typeof dateHint !== 'string') {
    return formatUtcDate(today);
  }

  const trimmed = dateHint.trim();
  if (trimmed === '') {
    return formatUtcDate(today);
  }

  const lower = trimmed.toLowerCase();
  if (RELATIVE_HINTS.has(lower)) {
    return formatUtcDate(lower === 'yesterday' ? addUtcDays(today, -1) : today);
  }

  const explicit = tryParseExplicitDate(trimmed);
  return formatUtcDate(explicit || today);
}

module.exports = { resolveDateHint };
