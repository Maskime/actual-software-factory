#!/usr/bin/env bash
# Bootstrap script for US-04: creates a test project in SonarQube, runs a
# scanner analysis on sample code, and verifies the API returns results.
# Prerequisites: setup-sonarqube.sh must have been run (admin password set).
# Run once after: bash setup-sonarqube.sh
# Idempotent — safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
TEST_SRC_DIR="$(cd "$SCRIPT_DIR/../sonarqube-test" && pwd)"

# ---------------------------------------------------------------------------
# 0. Load .env and validate required variables
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.example to .env and fill in the values." >&2
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

SONARQUBE_URL="${SONARQUBE_EXTERNAL_URL:-http://localhost:9000}"
ADMIN_PASSWORD="${SONARQUBE_ADMIN_PASSWORD:-}"
PROJECT_KEY="${SONARQUBE_TEST_PROJECT_KEY:-factory-test}"

if [[ -z "$ADMIN_PASSWORD" || "$ADMIN_PASSWORD" == "change_me"* ]]; then
  echo "Error: SONARQUBE_ADMIN_PASSWORD is not set or still has its placeholder value." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Wait for SonarQube to be healthy (up to 10 minutes)
# ---------------------------------------------------------------------------
echo "==> Waiting for SonarQube to be ready..."
for i in $(seq 1 60); do
  STATUS=$(curl -sf "$SONARQUBE_URL/api/system/status" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  if [[ "$STATUS" == "UP" ]]; then
    echo "    SonarQube is ready."; break
  fi
  [[ "$i" -eq 60 ]] && { echo "Timeout: SonarQube did not reach status UP within 10 minutes." >&2; exit 1; }
  echo "    ($i/60) status=${STATUS:-unreachable}, retrying in 10s..."
  sleep 10
done

# ---------------------------------------------------------------------------
# 2. Create test project (idempotent — ignore 400 if already exists)
# ---------------------------------------------------------------------------
echo "==> Creating project '$PROJECT_KEY'..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -u "admin:$ADMIN_PASSWORD" \
  -X POST "$SONARQUBE_URL/api/projects/create" \
  -d "project=$PROJECT_KEY&name=Factory+Test+Project&visibility=private")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "    Project created."
elif [[ "$HTTP_CODE" == "400" ]]; then
  echo "    Project already exists — skipping creation."
else
  echo "Error: Unexpected HTTP $HTTP_CODE when creating project." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Generate scanner token (revoke previous one first if it exists)
# ---------------------------------------------------------------------------
echo "==> Generating scanner token..."
curl -s -o /dev/null \
  -u "admin:$ADMIN_PASSWORD" \
  -X POST "$SONARQUBE_URL/api/user_tokens/revoke" \
  -d "name=factory-scanner" || true

TOKEN_JSON=$(curl -sf \
  -u "admin:$ADMIN_PASSWORD" \
  -X POST "$SONARQUBE_URL/api/user_tokens/generate" \
  -d "name=factory-scanner")

SCANNER_TOKEN=$(echo "$TOKEN_JSON" \
  | python3 -c "import json,sys; t=json.load(sys.stdin).get('token',''); print(t)")

if [[ -z "$SCANNER_TOKEN" ]]; then
  echo "Error: Failed to generate scanner token. Response: $TOKEN_JSON" >&2
  exit 1
fi
echo "    Token generated."

# ---------------------------------------------------------------------------
# 4. Run sonar-scanner via Docker
# ---------------------------------------------------------------------------
echo "==> Running sonar-scanner on '$TEST_SRC_DIR'..."
docker run --rm \
  --network factory-network \
  -v "$TEST_SRC_DIR:/usr/src" \
  -e SONAR_HOST_URL="http://sonarqube:9000" \
  -e SONAR_TOKEN="$SCANNER_TOKEN" \
  sonarsource/sonar-scanner-cli

# ---------------------------------------------------------------------------
# 5. Wait for analysis task to complete (up to 5 minutes)
# ---------------------------------------------------------------------------
echo "==> Waiting for analysis to complete..."
for i in $(seq 1 30); do
  TASK_STATUS=$(curl -sf \
    -u "admin:$ADMIN_PASSWORD" \
    "$SONARQUBE_URL/api/ce/activity?component=$PROJECT_KEY&ps=1" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
tasks = data.get('tasks', [])
print(tasks[0].get('status', '') if tasks else '')
" 2>/dev/null || true)

  if [[ "$TASK_STATUS" == "SUCCESS" ]]; then
    echo "    Analysis completed successfully."; break
  elif [[ "$TASK_STATUS" == "FAILED" ]]; then
    echo "Error: SonarQube analysis task failed." >&2
    exit 1
  fi
  [[ "$i" -eq 30 ]] && { echo "Timeout: Analysis did not complete within 5 minutes." >&2; exit 1; }
  echo "    ($i/30) task status=${TASK_STATUS:-pending}, retrying in 10s..."
  sleep 10
done

# ---------------------------------------------------------------------------
# 6. Verify API: issues for the default branch (main)
# ---------------------------------------------------------------------------
echo "==> Querying issues API (branch=main)..."
ISSUES_JSON=$(curl -sf \
  -u "admin:$ADMIN_PASSWORD" \
  "$SONARQUBE_URL/api/issues/search?projectKeys=$PROJECT_KEY&branch=main")

ISSUE_TOTAL=$(echo "$ISSUES_JSON" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))" 2>/dev/null || echo "parse_error")

if [[ "$ISSUE_TOTAL" == "parse_error" ]]; then
  echo "Error: Could not parse issues API response." >&2
  exit 1
fi
echo "    Issues found: $ISSUE_TOTAL"

# ---------------------------------------------------------------------------
# 7. Verify quality gate status
# ---------------------------------------------------------------------------
echo "==> Querying quality gate status..."
QG_JSON=$(curl -sf \
  -u "admin:$ADMIN_PASSWORD" \
  "$SONARQUBE_URL/api/qualitygates/project_status?projectKey=$PROJECT_KEY")

QG_STATUS=$(echo "$QG_JSON" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('projectStatus', {}).get('status', 'UNKNOWN'))
" 2>/dev/null || echo "parse_error")

if [[ "$QG_STATUS" == "parse_error" ]]; then
  echo "Error: Could not parse quality gate API response." >&2
  exit 1
fi
echo "    Quality gate status: $QG_STATUS"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
echo ""
echo "Setup complete."
echo "  SonarQube UI         : $SONARQUBE_URL/dashboard?id=$PROJECT_KEY"
echo "  Project key          : $PROJECT_KEY"
echo "  Issues (branch=main) : $ISSUE_TOTAL"
echo "  Quality gate         : $QG_STATUS"
