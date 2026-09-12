// Parses a receipt's own printed date (explicit formats: "01/15/2026", "01-15-2026",
// "2026-01-15") into a `transaction_date` string (YYYY-MM-DD). This is deliberately separate
// from chat/resolveDateHint.js, which solves a different problem (relative hints like
// "today"/"yesterday" extracted from a casual chat sentence) — receipts show explicit printed
// dates, not relative ones, so there is no relative-hint handling here at all. Never throws;
// anything that isn't one of the explicit formats above (including a relative word like
// "today", an unparseable string, or an impossible calendar date) defaults to today.

function toUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function isRealCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function tryParseExplicitDate(dateString) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (isoMatch) {
    const [, yearStr, monthStr, dayStr] = isoMatch;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    return isRealCalendarDate(year, month, day) ? new Date(Date.UTC(year, month - 1, day)) : null;
  }

  // MM/DD/YYYY or MM-DD-YYYY (1 or 2 digit month/day).
  const usMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(dateString);
  if (usMatch) {
    const [, monthStr, dayStr, yearStr] = usMatch;
    const month = Number(monthStr);
    const day = Number(dayStr);
    const year = Number(yearStr);
    return isRealCalendarDate(year, month, day) ? new Date(Date.UTC(year, month - 1, day)) : null;
  }

  return null;
}

function parseReceiptDate(dateHint, now = new Date()) {
  const today = toUtcMidnight(now);

  if (typeof dateHint !== 'string') {
    return formatUtcDate(today);
  }

  const trimmed = dateHint.trim();
  if (trimmed === '') {
    return formatUtcDate(today);
  }

  const explicit = tryParseExplicitDate(trimmed);
  return formatUtcDate(explicit || today);
}

module.exports = { parseReceiptDate };
