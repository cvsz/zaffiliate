# =============================================================================
# zaffiliate - unified build, setup, and deployment automation
# =============================================================================
.PHONY: help setup install dev test check verify security migrate backup \
        restore healthcheck selfhost build deploy release clean clean-all \
        docker-build docker-push compose-up compose-down compose-ps \
        compose-logs compose-restart

SHELL := /usr/bin/env bash

# ---- paths ------------------------------------------------------------------
ROOT        := $(CURDIR)
SCRIPT_DIR  := $(ROOT)/scripts
COMPOSE     := $(ROOT)/compose.yaml
COMPOSE_SH  := $(ROOT)/compose.selfhost.yaml
ENV_EXAMPLE := $(ROOT)/.env.example
ENV_FILE    := $(ROOT)/.env
SELFHOST_ENV:= $(ROOT)/.env.selfhost

# ---- docker -----------------------------------------------------------------
DOCKER       := docker
COMPOSE_CMD  := $(DOCKER) compose
COMPOSE_FILE := $(COMPOSE)

# ---- runtime ----------------------------------------------------------------
NODE_MAJOR   := 22
PORT         ?= 8080
WEB_PORT     ?= 3000

# =============================================================================
# help
# =============================================================================
help: ## Show this help (default target)
	@printf "\nzaffiliate - automated build & deployment control\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-18s %s\n", $$1, $$2}'
	@printf "\n"

# =============================================================================
# setup / install
# =============================================================================
setup: install env migrate ## Full local dev setup (install deps, env, migrate)

install: ## Install Node.js dependencies
	@echo "[install] npm ci (production + dev)"
	npm ci

env: ## Create .env from .env.example and generate secrets
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(ENV_EXAMPLE) $(ENV_FILE); \
		echo "[env] created .env from .env.example"; \
	else \
		echo "[env] .env already exists — skipping copy"; \
	fi
	@$(SCRIPT_DIR)/ensure-secrets.sh
	@mkdir -p dist logs
	@echo "[env] generated SESSION_SECRET, ENCRYPTION_KEY, VISITOR_SALT"

check-node: ## Verify Node.js >= 22 is installed
	@node_major=$$(node -v | sed 's/^v//' | cut -d. -f1); \
	if [ "$$node_major" -lt $(NODE_MAJOR) ]; then \
		echo "[check-node] node >= $(NODE_MAJOR) required (found v$$node_major)" >&2; exit 1; \
	fi
	@echo "[check-node] node $$(node -v) OK"

check-docker: ## Verify Docker + Compose are available
	@command -v $(DOCKER) >/dev/null 2>&1 || { echo "[check-docker] docker not found" >&2; exit 1; }
	@$(COMPOSE_CMD) version >/dev/null 2>&1 || { echo "[check-docker] docker compose plugin not found" >&2; exit 1; }
	@echo "[check-docker] docker + compose OK"

bootstrap: check-node env ## Run full bootstrap (env + secrets + dirs)
	@echo "[bootstrap] verifying global postgres + redis"
	@pg_isready -h 127.0.0.1 -p 5432 -U zaffiliate -d zaffiliate >/dev/null 2>&1 || { echo "[bootstrap] postgres not ready at 127.0.0.1:5432" >&2; exit 1; }
	@redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1 || { echo "[bootstrap] redis not ready at 127.0.0.1:6379" >&2; exit 1; }
	@echo "[bootstrap] done — run 'make dev' to start the API"

# =============================================================================
# docker
# =============================================================================
build: ## Build Docker image (multi-stage)
	@echo "[build] docker build -t zaffiliate:local ."
	$(DOCKER) build -t zaffiliate:local .

docker-build: build ## Alias: build Docker image

# =============================================================================
# dev stack (compose.yaml)
# =============================================================================
compose-up: ## Start API (connects to global postgres + redis)
	$(COMPOSE_CMD) -f $(COMPOSE) up -d

compose-down: ## Stop dev stack
	$(COMPOSE_CMD) -f $(COMPOSE) down

compose-ps: ## Show dev stack status
	$(COMPOSE_CMD) -f $(COMPOSE) ps

compose-logs: ## Tail dev stack logs (all services)
	$(COMPOSE_CMD) -f $(COMPOSE) logs -f --tail=200

compose-restart: compose-down compose-up ## Restart dev stack

dev: compose-up migrate ## Dev: start API + run migrations

# =============================================================================
# self-host stack (compose.selfhost.yaml)
# =============================================================================
selfhost: ## Start self-host stack (hardened, internal postgres/redis)
	@$(SCRIPT_DIR)/selfhost-local.sh up

selfhost-down: ## Stop self-host stack
	@$(SCRIPT_DIR)/selfhost-local.sh down

selfhost-status: ## Show self-host stack status
	@$(SCRIPT_DIR)/selfhost-local.sh status

selfhost-logs: ## Tail self-host logs
	@$(SCRIPT_DIR)/selfhost-local.sh logs

selfhost-migrate: ## Run migrations on self-host stack
	@$(SCRIPT_DIR)/selfhost-local.sh migrate

selfhost-restart: ## Restart self-host stack
	@$(SCRIPT_DIR)/selfhost-local.sh restart

selfhost-destroy: ## Destroy self-host volumes (requires ZAFFILIATE_CONFIRM_DESTROY=YES)
	@$(SCRIPT_DIR)/selfhost-local.sh destroy

# =============================================================================
# tests & quality gates
# =============================================================================
check: ## Syntax gate (node --check on all source files)
	npm run check

test: ## Run full test suite (node --test)
	npm test

verify: ## Pre-PR gate: check + test + audit + secret scan
	@$(SCRIPT_DIR)/verify.sh

security: ## Dependency audit + secret scan + Dockerfile non-root check
	@$(SCRIPT_DIR)/security-check.sh

ci: verify ## Alias: full CI gate

# =============================================================================
# database
# =============================================================================
migrate: ## Run pending database migrations
	@echo "[migrate] running db/migrations"
	$(SCRIPT_DIR)/migrate.sh

migrate-selfhost: ## Run migrations against self-host postgres
	@$(SCRIPT_DIR)/selfhost-local.sh migrate

backup: ## Backup postgres → backups/zaffiliate-<stamp>.sql.gz
	@$(SCRIPT_DIR)/backup.sh

restore: ## Restore postgres from backup (requires RESTORE_CONFIRM=yes)
	@if [ -z "$(FILE)" ]; then \
		echo "[restore] usage: make restore FILE=backups/foo.sql.gz RESTORE_CONFIRM=yes" >&2; exit 2; \
	fi
	RESTORE_CONFIRM=yes $(SCRIPT_DIR)/restore.sh "$(FILE)"

# =============================================================================
# health
# =============================================================================
healthcheck: ## Probe /healthz, /readyz, /api/v1/version
	@$(SCRIPT_DIR)/healthcheck.sh

# =============================================================================
# production deploy
# =============================================================================
deploy: ## Deploy to production host (systemd + cloudflare tunnel)
	@echo "[deploy] requires sudo — see scripts/deploy-host.sh"
	@$(SCRIPT_DIR)/deploy-host.sh

# =============================================================================
# release
# =============================================================================
release-manifest: ## Generate release manifest
	npm run release:manifest

sbom: ## Generate SBOM
	node scripts/generate-sbom.mjs

# =============================================================================
# clean
# =============================================================================
clean: ## Remove generated artifacts (dist, logs, coverage)
	rm -rf dist logs coverage .tmp

clean-all: clean ## Remove artifacts + node_modules + volumes
	rm -rf node_modules
	$(COMPOSE_CMD) -f $(COMPOSE) down -v --remove-orphans
	@echo "[clean-all] removed node_modules and dev volumes"

clean-selfhost: ## Destroy self-host volumes (requires ZAFFILIATE_CONFIRM_DESTROY=YES)
	@ZAFFILIATE_CONFIRM_DESTROY=YES $(SCRIPT_DIR)/selfhost-local.sh destroy

# =============================================================================
# short aliases
# =============================================================================
up: compose-up ## Alias
down: compose-down ## Alias
ps: compose-ps ## Alias
logs: compose-logs ## Alias
t: test ## Alias
c: check ## Alias
v: verify ## Alias
m: migrate ## Alias
b: backup ## Alias
hc: healthcheck ## Alias
