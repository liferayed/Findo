const { Worker } = require('bullmq');
const { STATEMENT_QUEUE_NAME, connection } = require('./statementQueue');
// Called through the module object (not destructured) so integration tests can
// jest.spyOn(require('./statementStorage'), 'renderPagesToImages') and have it take effect here —
// destructuring at require-time would capture the original function reference before any spy is
// installed, so the mock would silently never be hit.
const statementStorage = require('./statementStorage');
const { normalizeStatementPageExtraction } = require('./validateStatementExtraction');

function pickFirstNonNull(values) {
  return values.find((v) => v !== null && v !== undefined) ?? null;
}

async function resolveAccount({ accountsService, institutionsService }, userId, { institutionName, lastFour }) {
  if (!lastFour) {
    return null;
  }
  const candidates = await accountsService.findActiveAccountsByLastFour(userId, lastFour);
  if (candidates.length === 0) {
    return null;
  }
  const canonical = (await institutionsService.resolveInstitutionAlias(institutionName)) || institutionName;
  const matches = candidates.filter((a) => canonical && a.institution_name.toLowerCase() === canonical.toLowerCase());
  return matches.length === 1 ? matches[0].id : null;
}

async function processStatementJob({ pool, accountsService, institutionsService, extractPage }, { sharedItemId, userId }) {
  const { rows: [sharedItem] } = await pool.query('SELECT file_ref FROM shared_items WHERE id = $1', [sharedItemId]);

  let pages;
  try {
    pages = await statementStorage.renderPagesToImages(sharedItem.file_ref);
  } catch {
    await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [sharedItemId]);
    return;
  }

  const transactions = [];
  const beginningBalances = [];
  const endingBalances = [];
  let header = { institutionName: null, accountTypeText: null, lastFour: null, creditCard: null };
  let anyPageSucceeded = false;

  for (let i = 0; i < pages.length; i += 1) {
    const isFirstPage = i === 0;
    try {
      const raw = await extractPage(pages[i], { isFirstPage });
      const page = normalizeStatementPageExtraction(raw, { isFirstPage });
      transactions.push(...page.transactions);
      beginningBalances.push(page.beginningBalance);
      endingBalances.push(page.endingBalance);
      if (isFirstPage) {
        header = { institutionName: page.institutionName, accountTypeText: page.accountTypeText, lastFour: page.lastFour, creditCard: page.creditCard };
      }
      anyPageSucceeded = true;
    } catch {
      // Per F1.6's "never fabricate" rule: an unreadable page contributes nothing, not a
      // hard failure, unless every page fails (checked after the loop).
    }
    await pool.query(`UPDATE shared_items SET progress = $1 WHERE id = $2`, [
      JSON.stringify({ page: i + 1, totalPages: pages.length }),
      sharedItemId,
    ]);
  }

  if (!anyPageSucceeded) {
    await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [sharedItemId]);
    return;
  }

  try {
    const resolvedAccountId = await resolveAccount({ accountsService, institutionsService }, userId, header);
    const extractedData = {
      transactions,
      beginningBalance: pickFirstNonNull(beginningBalances),
      endingBalance: [...endingBalances].reverse().find((v) => v !== null && v !== undefined) ?? null,
      institutionName: header.institutionName,
      accountTypeText: header.accountTypeText,
      lastFour: header.lastFour,
      creditCard: header.creditCard,
      resolvedAccountId,
      accountOfferDeclined: false,
    };

    await pool.query(
      `UPDATE documents SET extracted_data = $1 WHERE shared_item_id = $2`,
      [JSON.stringify(extractedData), sharedItemId]
    );
    await pool.query(`UPDATE shared_items SET parse_status = $1 WHERE id = $2`, [
      resolvedAccountId ? 'parsed' : 'needs_clarification',
      sharedItemId,
    ]);
  } catch {
    // Matches the renderPagesToImages failure convention above: any error from account
    // resolution or the final writes must still flip parse_status away from 'pending',
    // or the shared_item is stuck forever with no caller awaiting this job's rejection.
    await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [sharedItemId]);
  }
}

// `extractPage` is injectable (tests never call the real vision model — same pattern
// receiptUploadService's `extractReceipt` parameter already uses). `processJobDirectly` is a
// test seam: BullMQ's Worker only invokes its processor via its own internal polling loop, so
// integration tests call this directly with a fake `{ data }` job object rather than spinning
// up real queue polling — the Worker returned here still wires the same function as its
// processor for production use via startStatementExtractionWorker.
function createStatementExtractionWorker({ pool, accountsService, institutionsService, extractPage }) {
  const processor = (job) => processStatementJob({ pool, accountsService, institutionsService, extractPage }, job.data);
  return { processJobDirectly: processor };
}

function startStatementExtractionWorker(deps) {
  const { processJobDirectly } = createStatementExtractionWorker(deps);
  return new Worker(STATEMENT_QUEUE_NAME, (job) => processJobDirectly(job), { connection });
}

module.exports = { createStatementExtractionWorker, startStatementExtractionWorker };
