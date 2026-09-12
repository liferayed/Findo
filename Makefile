DATABASE_URL ?= postgres://findo:findo@localhost:5432/findo
REDIS_URL ?= redis://localhost:6379
API_PORT ?= 3000
WEB_PORT ?= 5173

.PHONY: help up down install migrate seed setup dev dev-api dev-web \
        test test-integration test-integration-llm smoke check build reset-db

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Start Postgres + Redis (docker compose)
	docker compose up -d

down: ## Stop Postgres + Redis
	docker compose down

install: ## Install all workspace dependencies
	npm install

migrate: ## Apply database migrations
	DATABASE_URL="$(DATABASE_URL)" npm run migrate --workspace=api -- up

seed: ## Seed the single dev user
	DATABASE_URL="$(DATABASE_URL)" npm run seed --workspace=api

setup: up install migrate seed ## First-time setup: start services, install deps, migrate, seed
	@echo "Setup complete. Also make sure Ollama is running locally with llama3.2:3b and qwen2.5vl:3b pulled (see README)."
	@echo "Run 'make dev' to start the app."

dev: ## Run API + web dev servers together in this terminal (Ctrl+C stops both)
	@trap 'kill 0' EXIT INT TERM; \
	(cd api && DATABASE_URL="$(DATABASE_URL)" REDIS_URL="$(REDIS_URL)" PORT=$(API_PORT) node --watch src/server.js) & \
	(cd web && npx vite --port $(WEB_PORT)) & \
	wait

dev-api: ## Run only the API dev server (http://localhost:3000 by default)
	cd api && DATABASE_URL="$(DATABASE_URL)" REDIS_URL="$(REDIS_URL)" PORT=$(API_PORT) node --watch src/server.js

dev-web: ## Run only the web dev server (http://localhost:5173 by default)
	cd web && npx vite --port $(WEB_PORT)

test: ## Lint + unit tests
	npm run lint
	npm test

test-integration: ## Integration tests against live Postgres/Redis (no LLM required)
	DATABASE_URL="$(DATABASE_URL)" npm run test:integration --workspace=api

test-integration-llm: ## LLM-dependent integration tests (needs Ollama running locally)
	DATABASE_URL="$(DATABASE_URL)" npm run test:integration:llm --workspace=api

smoke: ## Boot the real server and hit it over HTTP (LLM assertions auto-skip if Ollama isn't reachable)
	DATABASE_URL="$(DATABASE_URL)" REDIS_URL="$(REDIS_URL)" npm run smoke

build: ## Type-check + build the web app
	npm run build --workspace=web

check: test test-integration smoke build ## Run everything CI runs (mirrors .github/workflows/ci.yml)

reset-db: ## DESTRUCTIVE: wipe the local dev database, then re-migrate and re-seed
	@echo "This will drop and recreate the public schema in the local dev Postgres. Ctrl+C to cancel."
	@sleep 3
	docker exec -i findo-postgres-1 psql -U findo -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) migrate
	$(MAKE) seed
