const fs = require('node:fs');
const path = require('node:path');
const { extractStatementPage } = require('../../src/llm/ollamaVisionClient');
const { normalizeStatementPageExtraction } = require('../../src/documents/validateStatementExtraction');
const { isValidCalendarDate } = require('../../src/transactions/validateTransactionInput');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'statements');

// NOTE on the fixture image: unlike receiptUpload.integration.test.js's fixtures (clean
// synthetic recreations of real receipt *layouts*), no real bank statement image exists in
// this repo to base a fixture on, and this test must not embed or approximate any real
// person's actual financial data. Rather than fabricate something that merely *looks* like a
// scanned statement, this fixture is a purpose-built synthetic image (plain white background,
// programmatically-rendered text via Pillow) laid out like a one-page checking statement:
// a bank/account header, a beginning/ending balance line, and a table of transaction rows
// with plausible-but-fake dates/descriptions/amounts. It exercises the real
// extractStatementPage() code path (real HTTP call to a real local Ollama vision model, real
// JSON-schema-constrained decoding, real prompt) exactly the way a genuine statement page
// would, without any fabricated real-world data. The PNG is checked into
// test/fixtures/statements/ alongside generate-fixture.py, the Pillow script that produced it
// (kept for reproducibility/review, not run by this test).
const FIXTURE_FILE = 'synthetic-checking-statement-page1.png';

function loadFixtureBase64(filename) {
  const buffer = fs.readFileSync(path.join(FIXTURES_DIR, filename));
  return buffer.toString('base64');
}

// Statement extraction is slower than receipt extraction (higher context window, larger
// image) — per ollamaVisionClient.js's STATEMENT_EXTRACTION_TIMEOUT_MS comment, the brainstorm
// spike observed ~50-85s/page. Generous test-level timeout on top of that.
jest.setTimeout(120000);

describe('statement page extraction (against real Ollama vision model)', () => {
  test('extractStatementPage against a synthetic statement page returns a realistic, well-formed extraction', async () => {
    const imageBase64 = loadFixtureBase64(FIXTURE_FILE);

    const raw = await extractStatementPage(imageBase64, { isFirstPage: true });

    // The raw model response is untrusted — same contract as extractReceipt. Assert the shape
    // extractStatementPage's caller (statementExtractionService) relies on before normalizing.
    expect(raw).not.toBeNull();
    expect(typeof raw).toBe('object');
    expect(Array.isArray(raw.transactions)).toBe(true);

    const normalized = normalizeStatementPageExtraction(raw, { isFirstPage: true });

    // This is a real (non-deterministic-in-principle, though temperature: 0) LLM call against
    // a clearly legible synthetic table, so we assert realistic structure and constraints
    // rather than exact values: the model should recover at least some of the six rendered
    // transaction rows, each with a real calendar date and a finite numeric amount.
    expect(normalized.transactions.length).toBeGreaterThan(0);
    for (const txn of normalized.transactions) {
      expect(isValidCalendarDate(txn.date)).toBe(true);
      expect(typeof txn.description).toBe('string');
      expect(txn.description.length).toBeGreaterThan(0);
      expect(typeof txn.amount).toBe('number');
      expect(Number.isFinite(txn.amount)).toBe(true);
    }

    // beginning/ending balance were printed on this synthetic page's header, so a competent
    // extraction should surface them as numbers (not required to match exactly, since OCR of
    // rendered text by a vision model isn't guaranteed pixel-perfect, but they must be numeric
    // if present at all).
    if (normalized.beginningBalance !== null) {
      expect(typeof normalized.beginningBalance).toBe('number');
    }
    if (normalized.endingBalance !== null) {
      expect(typeof normalized.endingBalance).toBe('number');
    }
  });
});
