# Findo

Modular personal finance helper. See the [planning vault](../../../obsidian_docs/Findo/Findo) for the design document and phase plans — this repo is the implementation, built one feature at a time per that plan.

Currently: **Phase 1 — Foundation & Core Ingestion**, F1.1 (Platform Foundation & Health Check).

## Structure

- `api/` — Node.js + Express API, PostgreSQL, Redis, BullMQ job queue. Serves the minimal chat shell at `/chat/chat.html`.
- `web/` — React + TypeScript web shell (Vite).

## Local setup

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
