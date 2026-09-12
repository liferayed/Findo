const { normalizeExtraction } = require('./validateExtraction');
const { resolveAccountMatch } = require('./matchAccounts');
const { resolveDateHint } = require('./resolveDateHint');

const NO_ACCOUNTS_REPLY = "You don't have any accounts yet — add one first, then I can log transactions against it.";
const LLM_UNAVAILABLE_REPLY = "Sorry, I couldn't process that message right now — please try again in a moment.";
const LOST_TRACK_REPLY = 'Sorry, I lost track of that transaction — could you resend it?';
const CREATE_FAILED_REPLY = 'Sorry, something went wrong logging that transaction — please try again.';

function fallbackMerchant(type) {
  return type === 'credit' ? 'Income' : 'Purchase';
}

function formatAmount(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function buildParsedSummary(extraction) {
  const amountStr = formatAmount(extraction.amount);
  return extraction.merchant ? `${amountStr} at ${extraction.merchant} (${extraction.type})` : `${amountStr} (${extraction.type})`;
}

function buildConfirmationReply(extraction, accountNickname) {
  const amountStr = formatAmount(extraction.amount);
  const merchantPart = extraction.merchant ? ` at ${extraction.merchant}` : '';
  return `Got it — logged ${amountStr}${merchantPart} (${extraction.type}) on ${accountNickname}.`;
}

function buildClarificationQuestion(activeAccounts) {
  const list = activeAccounts.map((a) => a.nickname).join(', ');
  return `Which account was this on? You have: ${list}.`;
}

function buildNoMatchReply(activeAccounts) {
  if (activeAccounts.length === 0) {
    return "I couldn't match that to an account, and you don't have any active accounts right now — add one, then resend your answer.";
  }
  const list = activeAccounts.map((a) => a.nickname).join(', ');
  return `I couldn't match that to one of your accounts: ${list}. Which one was this on?`;
}

async function getPendingClarification(pool, userId) {
  const { rows } = await pool.query(
    `SELECT cr.id, cr.shared_item_id, si.raw_text
     FROM clarification_requests cr
     JOIN shared_items si ON si.id = cr.shared_item_id
     WHERE si.user_id = $1 AND cr.resolved_at IS NULL
     ORDER BY cr.created_at ASC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getActiveAccounts(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, nickname, institution_name FROM accounts WHERE user_id = $1 AND is_active = true ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

async function insertSharedItem(pool, userId, rawText, parseStatus, parsedSummary) {
  const { rows } = await pool.query(
    `INSERT INTO shared_items (user_id, channel, content_type, raw_text, parse_status, parsed_summary)
     VALUES ($1, 'chat', 'text', $2, $3, $4)
     RETURNING id`,
    [userId, rawText, parseStatus, parsedSummary || null]
  );
  return rows[0];
}

async function insertTransactionSource(pool, transactionId, sharedItemId) {
  await pool.query(`INSERT INTO transaction_sources (transaction_id, shared_item_id, role) VALUES ($1, $2, 'origin')`, [
    transactionId,
    sharedItemId,
  ]);
}

function createChatTransactionHandler({ pool, transactionsService, extractTransaction }) {
  async function handlePendingClarification(userId, replyText, pending) {
    const activeAccounts = await getActiveAccounts(pool, userId);
    const matched = resolveAccountMatch(replyText, activeAccounts);

    if (!matched) {
      // Deliberately no DB writes here — the clarification stays pending and we just re-ask.
      return { statusCode: 200, reply: buildNoMatchReply(activeAccounts) };
    }

    let extraction = null;
    try {
      extraction = normalizeExtraction(await extractTransaction(pending.raw_text));
    } catch {
      extraction = null;
    }

    // Mark the clarification resolved either way — never leave the user stuck on it forever,
    // per the brief's explicit guidance for this (rare) re-extraction-failure branch.
    await pool.query(`UPDATE clarification_requests SET user_response = $1, resolved_at = now() WHERE id = $2`, [
      replyText,
      pending.id,
    ]);

    if (!extraction || !extraction.isActionable) {
      await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [pending.shared_item_id]);
      return { statusCode: 200, reply: LOST_TRACK_REPLY };
    }

    const transactionDate = resolveDateHint(extraction.dateHint);
    const merchantRaw = extraction.merchant || fallbackMerchant(extraction.type);
    const summary = buildParsedSummary(extraction);

    try {
      const transaction = await transactionsService.createTransactionFromChat(userId, {
        accountId: matched.id,
        transactionDate,
        amount: extraction.amount,
        merchantRaw,
        type: extraction.type,
        reconciliationStatus: 'unconfirmed',
      });
      await insertTransactionSource(pool, transaction.id, pending.shared_item_id);
      await pool.query(`UPDATE shared_items SET parse_status = 'parsed', parsed_summary = $1 WHERE id = $2`, [
        summary,
        pending.shared_item_id,
      ]);

      return { statusCode: 201, reply: buildConfirmationReply(extraction, matched.nickname) };
    } catch {
      await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [pending.shared_item_id]);
      return { statusCode: 200, reply: CREATE_FAILED_REPLY };
    }
  }

  async function handleNewMessage(userId, text) {
    let rawExtraction;
    try {
      rawExtraction = await extractTransaction(text);
    } catch {
      return { statusCode: 200, reply: LLM_UNAVAILABLE_REPLY };
    }

    const extraction = normalizeExtraction(rawExtraction);
    if (!extraction.isActionable) {
      // Not a usable transaction — fall through to the generic chat echo. No shared_items
      // row: this message did not "result in ingestion" per the vault's own phrasing.
      return null;
    }

    const activeAccounts = await getActiveAccounts(pool, userId);

    if (activeAccounts.length === 0) {
      return { statusCode: 200, reply: NO_ACCOUNTS_REPLY };
    }

    let matched = null;
    if (extraction.accountHint) {
      matched = resolveAccountMatch(extraction.accountHint, activeAccounts);
    } else if (activeAccounts.length === 1) {
      matched = activeAccounts[0];
    }
    // Otherwise (hint present but unmatched/ambiguous, or no hint with 2+ accounts):
    // matched stays null and we fall into the ambiguous/clarification branch below.

    const summary = buildParsedSummary(extraction);

    if (matched) {
      const sharedItem = await insertSharedItem(pool, userId, text, 'parsed', summary);
      const transactionDate = resolveDateHint(extraction.dateHint);
      const merchantRaw = extraction.merchant || fallbackMerchant(extraction.type);

      try {
        const transaction = await transactionsService.createTransactionFromChat(userId, {
          accountId: matched.id,
          transactionDate,
          amount: extraction.amount,
          merchantRaw,
          type: extraction.type,
          reconciliationStatus: 'confirmed',
        });
        await insertTransactionSource(pool, transaction.id, sharedItem.id);

        return { statusCode: 201, reply: buildConfirmationReply(extraction, matched.nickname) };
      } catch {
        await pool.query(`UPDATE shared_items SET parse_status = 'failed' WHERE id = $1`, [sharedItem.id]);
        return { statusCode: 200, reply: CREATE_FAILED_REPLY };
      }
    }

    const sharedItem = await insertSharedItem(pool, userId, text, 'needs_clarification', summary);
    const question = buildClarificationQuestion(activeAccounts);
    await pool.query(`INSERT INTO clarification_requests (shared_item_id, question) VALUES ($1, $2)`, [
      sharedItem.id,
      question,
    ]);

    return { statusCode: 201, reply: question };
  }

  async function handleMessage(userId, text) {
    const pending = await getPendingClarification(pool, userId);
    if (pending) {
      return handlePendingClarification(userId, text, pending);
    }
    return handleNewMessage(userId, text);
  }

  return { handleMessage };
}

module.exports = { createChatTransactionHandler };
