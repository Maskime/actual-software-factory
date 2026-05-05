.PHONY: test-mcp

# Run MCP round-trip integration tests.
# Requires the MCP servers to be started via docker-compose:
#   docker compose -f infrastructure/docker-compose.yml up -d mcp-gitlab mcp-sonarqube mcp-temporal
# Environment variables are loaded automatically from infrastructure/.env if present.
test-mcp:
	@bash -c '\
	  set -a; \
	  [ -f infrastructure/.env ] && . infrastructure/.env; \
	  set +a; \
	  cd mcp/tests && npm test'
