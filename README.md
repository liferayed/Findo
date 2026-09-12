# Findo

Modular personal finance helper. See the [planning vault](../../../obsidian_docs/Findo/Findo) for the design document and phase plans — this repo is the implementation, built one feature at a time per that plan.

Currently: **Phase 1 — Foundation & Core Ingestion**, F1.5 (Chat Text-Based Transaction Capture).

## Feature workflow

Each feature is built on its own branch off `main` (e.g. `feature/f1-2-account-management`), with unit tests, lint, and smoke test coverage added alongside the implementation and passing before a PR is opened back to `main`.

## Structure

- `api/` — Node.js + Express API, PostgreSQL, Redis, BullMQ job queue. Serves the minimal chat shell at `/chat/chat.html`.
- `web/` — React + TypeScript web shell (Vite).

## Local setup

Also requires [Ollama](https://ollama.com) running locally with `llama3.2:3b` pulled (`ollama pull llama3.2:3b`) for chat-based transaction parsing (F1.5) — see `api/.env.example` for `OLLAMA_BASE_URL`/`OLLAMA_MODEL` if you're pointing at a different host/model.

```bash
docker compose up -d      # Postgres + Redis
npm install
npm run migrate           # apply DB migrations
npm run seed               # seed the single dev user
npm run dev:api            # http://localhost:3000
npm run dev:web            # http://localhost:5173
```

## Tests

```bash
npm run lint                                # eslint across api + web
npm test                                    # unit tests (api)
npm run test:integration --workspace=api    # integration tests against live Postgres/Redis (needs docker compose up)
npm run smoke                               # boots the real server, hits it over HTTP (needs docker compose up)
```

CI (`.github/workflows/ci.yml`) runs all four on every push and PR: `lint` and `unit-tests` in parallel, then `smoke` (migrations + integration tests + the smoke script) against real Postgres/Redis service containers.

## Health check

`GET /health` reports the status of Postgres, Redis, and the job queue individually:

```json
{
  "status": "ok",
  "subsystems": {
    "postgres": { "status": "ok" },
    "redis": { "status": "ok" },
    "queue": { "status": "ok" }
  }
}
```

Returns `200` when everything is healthy, `503` with per-subsystem detail otherwise.

## Accounts (F1.2)

- `POST /accounts` — `{ nickname, type, institution_name, last_four? }` → `201` with the created account. `type` is one of `checking`, `savings`, `credit_card`, `brokerage`, `loan`. Duplicate nicknames for the same user return `409`.
- `GET /accounts` — lists the current user's accounts, newest first.
- `PATCH /accounts/:id` — `{ nickname?, is_active? }` → `200` with the updated account, `404` if it doesn't belong to the current user.
- Chat: a message like `"Add my Chase checking account, call it Chase-Checking"` is parsed and routed through the same service `POST /accounts` uses. If the account type can't be determined, Findo asks for it rather than guessing.

Multi-tenant auth doesn't exist yet (single-user system, per F1.1) — every request resolves to the one seeded user from `npm run seed`.

## Transactions (F1.3)

- `POST /transactions` — `{ account_id, transaction_date, amount, type, merchant_raw }` → `201` with the created transaction. `amount` is a **positive magnitude**; `type` is `"debit"` or `"credit"` (`"transfer"` is rejected — not supported by this feature). The server computes the stored signed `amount` (negative for a debit, positive for a credit), and always sets `is_manual: true`, `reconciliation_status: "confirmed"`, `category_id: null`. `account_id` must belong to the current user and be active, or the request is rejected with `404` (the same error regardless of whether the account doesn't exist, isn't the caller's, or is inactive).
- `GET /accounts/:id/transactions` — lists transactions for that account, newest first (by `transaction_date`, then `created_at` as a tiebreaker). The same ownership check applies, but an inactive account's existing transactions can still be listed — only *creating* against an inactive account is blocked.
- Web: each account in the Accounts panel has a "View Transactions" toggle that shows a per-account transaction form and list.
- Chat entry, receipt/statement parsing, categorization, and transfers are out of scope for this feature.

## Chat Transactions (F1.5)

- `POST /chat/messages` now also parses free-text transaction mentions (e.g. `"Spent $12.50 at Starbucks today"`) via a locally-hosted LLM (Ollama, `llama3.2:3b` by default — configurable via `OLLAMA_BASE_URL`/`OLLAMA_MODEL`, see `api/.env.example`). Account-creation phrasing (F1.2) is still checked first and unchanged.
- If the account is unambiguous (named and matched, or the user has exactly one active account), the transaction is created immediately (`is_manual: false`, `reconciliation_status: "confirmed"`). If it's ambiguous, Findo asks which account and holds the transaction until the next message answers it (`reconciliation_status: "unconfirmed"` once resolved).
- Every chat-originated transaction is tied back to its source message via `shared_items` + `transaction_sources` (`role: "origin"`).
- Messages that aren't a recognizable transaction (a question, small talk) fall through to a generic reply — no data is persisted for them.
- Receipt/statement parsing (vision-model work) and cross-source deduplication are out of scope for this feature.
