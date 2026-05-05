#!/usr/bin/env bash
# Bootstrap script for US-03: waits for SonarQube to be ready and secures the
# admin account by replacing the default "admin" password.
# Run once after: docker compose up -d
# Idempotent — safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

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
DB_PASSWORD="${SONARQUBE_DB_PASSWORD:-}"

for var_name in ADMIN_PASSWORD DB_PASSWORD; do
  eval "val=\$$var_name"
  if [[ -z "$val" || "$val" == "change_me"* ]]; then
    echo "Error: ${var_name} is not set or still has its placeholder value in .env." >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 1. Check vm.max_map_count (required by embedded Elasticsearch)
# ---------------------------------------------------------------------------
echo "==> Checking vm.max_map_count..."
CURRENT_MAP_COUNT=$(cat /proc/sys/vm/max_map_count 2>/dev/null || echo 0)
if [[ "$CURRENT_MAP_COUNT" -lt 524288 ]]; then
  echo "" >&2
  echo "Error: vm.max_map_count is $CURRENT_MAP_COUNT (minimum required: 524288)." >&2
  echo "SonarQube's embedded Elasticsearch will fail to start with this value." >&2
  echo "" >&2
  echo "Fix (current session only):" >&2
  echo "  sudo sysctl -w vm.max_map_count=524288" >&2
  echo "" >&2
  echo "Fix (persistent across reboots):" >&2
  echo "  echo 'vm.max_map_count=524288' | sudo tee /etc/sysctl.d/sonarqube.conf" >&2
  echo "  sudo sysctl --system" >&2
  echo "" >&2
  exit 1
fi
echo "    vm.max_map_count=$CURRENT_MAP_COUNT — OK."

# ---------------------------------------------------------------------------
# 2. Wait for SonarQube to be healthy (up to 10 minutes)
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
# 3. Vérifier que le plugin community branch est actif
# ---------------------------------------------------------------------------
echo "==> Checking sonarqube-community-branch-plugin..."
PLUGIN_JSON=$(curl -sf -u "admin:$ADMIN_PASSWORD" "$SONARQUBE_URL/api/plugins/installed" 2>/dev/null \
  || curl -sf -u "admin:admin" "$SONARQUBE_URL/api/plugins/installed" 2>/dev/null \
  || echo "{}")
PLUGIN_PRESENT=$(echo "$PLUGIN_JSON" | python3 -c "
import json, sys
plugins = json.load(sys.stdin).get('plugins', [])
keys = [p.get('key', '') for p in plugins]
print('true' if any('communityBranch' in k or 'branch' in k.lower() for k in keys) else 'false')
" 2>/dev/null || echo "false")

if [[ "$PLUGIN_PRESENT" == "true" ]]; then
  echo "    Plugin communityBranchPlugin — OK."
else
  echo "Warning: communityBranchPlugin non détecté. Vérifier que l'image Docker utilisée est" >&2
  echo "         mc1arke/sonarqube-with-community-branch-plugin (voir infrastructure/docker-compose.yml)." >&2
fi

# ---------------------------------------------------------------------------
# 4. Change default admin password (idempotent)
# ---------------------------------------------------------------------------
echo "==> Securing admin account..."

# /api/authentication/validate always returns HTTP 200 — branch on the 'valid' field instead.
VALID=$(curl -sf -u "admin:$ADMIN_PASSWORD" "$SONARQUBE_URL/api/authentication/validate" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('valid', False))" 2>/dev/null || echo "false")

if [[ "$VALID" == "True" ]]; then
  echo "    Admin password already set to the configured value — skipping."
else
  # Configured password doesn't work — try to change from the default "admin" password.
  CHANGE_BODY=$(curl -s -w "\n%{http_code}" \
    -u "admin:admin" \
    -X POST "$SONARQUBE_URL/api/users/change_password" \
    -d "login=admin&previousPassword=admin&password=$ADMIN_PASSWORD")
  CHANGE_CODE=$(echo "$CHANGE_BODY" | tail -1)
  CHANGE_MSG=$(echo "$CHANGE_BODY" | head -n -1)

  if [[ "$CHANGE_CODE" == "204" ]]; then
    echo "    Admin password changed successfully."
  elif [[ "$CHANGE_CODE" == "401" ]]; then
    echo "Error: Cannot authenticate with admin using the default password ('admin') or" >&2
    echo "the configured SONARQUBE_ADMIN_PASSWORD. A different password may already be set." >&2
    echo "Manual intervention required: log in to $SONARQUBE_URL and reset the admin password." >&2
    exit 1
  elif [[ "$CHANGE_CODE" == "400" ]]; then
    echo "Error: SonarQube rejected the new password (HTTP 400)." >&2
    echo "Response: $CHANGE_MSG" >&2
    echo "" >&2
    echo "SonarQube 10.x password requirements: min. 12 characters, uppercase, lowercase," >&2
    echo "digit, and special character. Check SONARQUBE_ADMIN_PASSWORD in infrastructure/.env." >&2
    exit 1
  else
    echo "Error: Unexpected HTTP $CHANGE_CODE when changing admin password." >&2
    echo "Response: $CHANGE_MSG" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------
echo ""
echo "Setup complete."
echo "  SonarQube UI : $SONARQUBE_URL"
echo "  Login        : admin / <configured SONARQUBE_ADMIN_PASSWORD>"
