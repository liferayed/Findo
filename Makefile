.PHONY: help up down setup install dev migrate seed lint test test-integration test-integration-llm smoke build check reset-db

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Start Postgres, Redis, api, and web (detached)
	docker compose up -d

down: ## Stop and remove all containers
	docker compose down

install: ## Build (or rebuild) all service images — runs npm ci inside each
	docker compose build

setup: install up ## First-time setup: build images, start everything, migrate, seed
	docker compose exec api npm run migrate -- up
	docker compose exec api npm run seed
	@echo "Setup complete. Also make sure Ollama is running locally with llama3.2:3b and qwen2.5vl:3b pulled (see README)."
	@echo "Everything is already up in the background — run 'make dev' if you want the logs attached in this terminal."

dev: ## Run Postgres, Redis, api, and web together with logs attached (Ctrl+C stops all)
	docker compose up

migrate: ## Apply database migrations (inside the api container)
	docker compose exec api npm run migrate -- up

seed: ## Seed the single dev user (inside the api container)
	docker compose exec api npm run seed

lint: ## Lint the whole repo (inside the api container)
	docker compose exec --workdir /app api npm run lint

test: ## Lint + unit tests, both workspaces (inside their containers)
	docker compose exec --workdir /app api npm run lint
	docker compose exec api npm test
	docker compose exec web npm test

test-integration: ## Integration tests against live Postgres/Redis (inside the api container)
	docker compose exec api npm run test:integration

test-integration-llm: ## LLM-dependent integration tests (needs Ollama running on the host, reached via host.docker.internal)
	docker compose exec api npm run test:integration:llm

smoke: ## Boot the real server and hit it over HTTP (inside the api container)
	docker compose exec --workdir /app api npm run smoke

build: ## Type-check + build the web app (inside the web container)
	docker compose exec web npm run build

check: test test-integration smoke build ## Run everything CI runs (mirrors .github/workflows/ci.yml)

reset-db: ## DESTRUCTIVE: wipe the local dev database, then re-migrate and re-seed
	@echo "This will drop and recreate the public schema in the local dev Postgres. Ctrl+C to cancel."
	@sleep 3
	docker compose exec postgres psql -U findo -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) migrate
	$(MAKE) seed
