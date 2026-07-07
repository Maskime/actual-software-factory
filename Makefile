.PHONY: test-mcp test-unit dev dev-chat build build-mcp-gitlab lint prune

# Run MCP round-trip integration tests.
# Requires the MCP servers to be started via docker-compose:
#   docker compose -f infrastructure/docker-compose.yml up -d mcp-gitlab mcp-sonarqube mcp-temporal
# Environment variables are loaded automatically from infrastructure/.env if present.
test-mcp:
	@bash -c '\
	  set -a; \
	  [ -f infrastructure/.env ] && . infrastructure/.env; \
	  set +a; \
	  npm run test --workspace=mcp/tests'

dev dev-chat:
	npm run dev --workspace=apps

build:
	npm run build --workspaces --if-present

build-mcp-gitlab:
	npm run build --workspace=mcp/gitlab

lint:
	npm run lint --workspaces --if-present

test-unit:
	npm run test --workspaces --if-present

# Reclaim Docker disk space: prune unused containers/images/build cache and
# orphaned GitLab runner cache volumes. Safe to run while the stack is up.
# Scheduled daily via cron (see CLAUDE.md § Infrastructure).
prune:
	bash infrastructure/scripts/docker-prune.sh
