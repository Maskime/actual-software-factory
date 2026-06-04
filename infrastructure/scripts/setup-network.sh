#!/usr/bin/env bash
# Bootstrap script for US-06: validates inter-service connectivity on factory-network,
# injects CI/CD variables into GitLab (SONAR_TOKEN, SONAR_HOST_URL, SONARQUBE_PROJECT_KEY),
# updates .gitlab-ci.yml with SonarQube scan + Temporal notify stages, then triggers a
# test pipeline to confirm end-to-end connectivity.
#
# This script is the canonical owner of .gitlab-ci.yml in the factory-test project.
# Run once after: setup-gitlab.sh, setup-sonarqube.sh, setup-sonarqube-analysis.sh,
#                 and setup-temporal.sh have all been executed.
# Idempotent — safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# ---------------------------------------------------------------------------
# 0. Load .env and validate prerequisites
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.example to .env and fill in values." >&2
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

GITLAB_URL="${GITLAB_EXTERNAL_URL:-http://localhost}"
SONARQUBE_URL="${SONARQUBE_EXTERNAL_URL:-http://localhost:9000}"
SONAR_ADMIN_PASSWORD="${SONARQUBE_ADMIN_PASSWORD:-}"
TEST_PROJECT_NAME="${GITLAB_TEST_PROJECT_NAME:-factory-test}"
SONAR_PROJECT_KEY="${SONARQUBE_TEST_PROJECT_KEY:-factory-test}"
TEMPORAL_NAMESPACE="factory-test"
TEMPORAL_TASK_QUEUE="factory-test-queue"

for var_name in SONAR_ADMIN_PASSWORD; do
  eval "val=\$$var_name"
  if [[ -z "$val" || "$val" == "change_me"* ]]; then
    echo "Error: ${var_name} is not set or still has its placeholder value in .env." >&2
    exit 1
  fi
done

for cmd in docker python3 curl; do
  command -v "$cmd" &>/dev/null || { echo "Error: '$cmd' is required but not installed." >&2; exit 1; }
done

for container in gitlab gitlab-runner sonarqube temporal; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "Error: '$container' container is not running." >&2
    echo "       Run: docker compose -f infrastructure/docker-compose.yml up -d" >&2
    exit 1
  fi
done

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# ---------------------------------------------------------------------------
# 1. Acquire GitLab PAT (root token, same technique as setup-gitlab.sh)
# ---------------------------------------------------------------------------
echo "==> Acquiring GitLab Personal Access Token..."
TOKEN=$(docker exec gitlab gitlab-rails runner "
  existing = PersonalAccessToken.find_by(name: 'network-setup-token', user: User.find_by_username('root'))
  existing.revoke! if existing && !existing.revoked?
  token = User.find_by_username('root').personal_access_tokens.create!(
    name: 'network-setup-token',
    scopes: ['api'],
    expires_at: Date.today + 365
  )
  puts token.token
" 2>/dev/null | tail -1)

[[ -z "$TOKEN" || "$TOKEN" == "nil" ]] && { echo "Failed to create PAT." >&2; exit 1; }
echo "    PAT ready."

# Retrieve project ID
PROJECT_ID=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects?search=$TEST_PROJECT_NAME" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
match = next((str(p['id']) for p in data if p['name'] == '$TEST_PROJECT_NAME'), '')
print(match)
")
[[ -z "$PROJECT_ID" ]] && { echo "Error: project '$TEST_PROJECT_NAME' not found in GitLab." >&2; echo "       Run setup-gitlab.sh first." >&2; exit 1; }
echo "    Project id=$PROJECT_ID."

# ---------------------------------------------------------------------------
# 1b. Provision GITLAB_API_TOKEN (auto-generate if absent from .env)
# ---------------------------------------------------------------------------
# This token is instance-level (not project-scoped): SonarQube uses it to post
# MR decoration comments, and agents use it to create epics/issues/MRs.
GITLAB_API_TOKEN="${GITLAB_API_TOKEN:-}"
if [[ -z "$GITLAB_API_TOKEN" ]]; then
  echo "==> GITLAB_API_TOKEN not set — generating factory-agents-token..."
  GITLAB_API_TOKEN=$(docker exec gitlab gitlab-rails runner "
    existing = PersonalAccessToken.find_by(name: 'factory-agents-token', user: User.find_by_username('root'))
    existing.revoke! if existing && !existing.revoked?
    token = User.find_by_username('root').personal_access_tokens.create!(
      name: 'factory-agents-token',
      scopes: ['api'],
      expires_at: Date.today + 365
    )
    puts token.token
  " 2>/dev/null | tail -1)

  if [[ -z "$GITLAB_API_TOKEN" || "$GITLAB_API_TOKEN" == "nil" ]]; then
    echo "Error: Failed to generate factory-agents-token." >&2; exit 1
  fi

  # Write back to .env (replace existing empty/placeholder line, or append)
  if grep -q "^GITLAB_API_TOKEN=" "$ENV_FILE"; then
    sed -i "s|^GITLAB_API_TOKEN=.*|GITLAB_API_TOKEN=$GITLAB_API_TOKEN|" "$ENV_FILE"
  else
    echo "GITLAB_API_TOKEN=$GITLAB_API_TOKEN" >> "$ENV_FILE"
  fi
  export GITLAB_API_TOKEN
  echo "    factory-agents-token created and saved to .env as GITLAB_API_TOKEN."
else
  echo "==> GITLAB_API_TOKEN already set — skipping token generation."
fi

# ---------------------------------------------------------------------------
# 2. Inter-service connectivity probe (from within factory-network)
# ---------------------------------------------------------------------------
echo ""
echo "==> Probing inter-service connectivity on factory-network..."

probe() {
  local label="$1" cmd="$2"
  if docker run --rm --network factory-network alpine /bin/sh -c "$cmd" > /dev/null 2>&1; then
    echo "    [OK] $label"
  else
    echo "    [FAIL] $label" >&2
    return 1
  fi
}

# GitLab health — must use docker exec to bypass /-/health IP allowlist (127.0.0.1 only)
if docker exec gitlab curl -sf http://localhost/-/health > /dev/null 2>&1; then
  echo "    [OK] gitlab:80 /-/health"
else
  echo "    [FAIL] gitlab:80 /-/health" >&2; exit 1
fi

probe "sonarqube:9000 /api/system/status" \
  "wget -qO- http://sonarqube:9000/api/system/status | grep -q '\"status\":\"UP\"'"

probe "temporal:7233 gRPC port reachable" \
  "nc -z temporal 7233"

probe "temporal:7243 HTTP API reachable" \
  "wget -qO- http://temporal:7243/api/v1/namespaces > /dev/null"

echo "    All connectivity probes passed."

# ---------------------------------------------------------------------------
# 3. Generate SonarQube CI token and store it as a GitLab CI/CD variable
# ---------------------------------------------------------------------------
echo ""
echo "==> Generating SonarQube CI token (gitlab-ci-scanner)..."
curl -s -o /dev/null \
  -u "admin:$SONAR_ADMIN_PASSWORD" \
  -X POST "$SONARQUBE_URL/api/user_tokens/revoke" \
  -d "name=gitlab-ci-scanner" || true

SONAR_CI_TOKEN=$(curl -sf \
  -u "admin:$SONAR_ADMIN_PASSWORD" \
  -X POST "$SONARQUBE_URL/api/user_tokens/generate" \
  -d "name=gitlab-ci-scanner" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")

[[ -z "$SONAR_CI_TOKEN" ]] && { echo "Error: failed to generate SonarQube CI token." >&2; exit 1; }
echo "    Token generated."

# Store each variable in GitLab: GET → POST (404) or PUT (200)
set_ci_var() {
  local key="$1" value="$2" masked="${3:-false}"
  local get_code
  get_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/variables/$key")

  if [[ "$get_code" == "200" ]]; then
    curl -sf --request PUT \
      --header "PRIVATE-TOKEN: $TOKEN" \
      "$GITLAB_URL/api/v4/projects/$PROJECT_ID/variables/$key" \
      --data-urlencode "value=$value" \
      --data "masked=$masked" > /dev/null
    echo "    Updated CI variable: $key"
  else
    curl -sf --request POST \
      --header "PRIVATE-TOKEN: $TOKEN" \
      "$GITLAB_URL/api/v4/projects/$PROJECT_ID/variables" \
      --data-urlencode "value=$value" \
      --data "key=$key&masked=$masked" > /dev/null
    echo "    Created CI variable: $key"
  fi
}

echo "==> Storing CI/CD variables in GitLab..."
set_ci_var "SONAR_TOKEN"           "$SONAR_CI_TOKEN"              "true"
set_ci_var "SONAR_HOST_URL"        "http://sonarqube:9000"        "false"
set_ci_var "SONARQUBE_PROJECT_KEY" "$SONAR_PROJECT_KEY"           "false"

# ---------------------------------------------------------------------------
# 4. Configure SonarQube GitLab ALM integration
# ---------------------------------------------------------------------------
echo ""
echo "==> Configuring SonarQube GitLab ALM integration..."

GITLAB_TOKEN_FOR_ALM="${GITLAB_API_TOKEN:-}"
ALM_KEY="gitlab-alm"
GITLAB_PROJECT_PATH="root/$TEST_PROJECT_NAME"

if [[ -z "$GITLAB_TOKEN_FOR_ALM" ]]; then
  echo "    Warning: GITLAB_API_TOKEN not set in .env — skipping ALM configuration." >&2
  echo "             Set it and re-run this script to enable SonarQube MR decoration." >&2
else
  # Check if the GitLab ALM setting already exists
  ALM_EXISTS=$(curl -sf \
    -u "admin:$SONAR_ADMIN_PASSWORD" \
    "$SONARQUBE_URL/api/alm_settings/list_definitions" 2>/dev/null \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('true' if any(s.get('key') == '$ALM_KEY' for s in data.get('gitlab', [])) else 'false')
" 2>/dev/null || echo "false")

  if [[ "$ALM_EXISTS" == "true" ]]; then
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      -u "admin:$SONAR_ADMIN_PASSWORD" \
      -X POST "$SONARQUBE_URL/api/alm_settings/update_gitlab" \
      -d "key=$ALM_KEY" \
      --data-urlencode "url=$GITLAB_URL" \
      --data-urlencode "personalAccessToken=$GITLAB_TOKEN_FOR_ALM")
    [[ "$HTTP" == "200" ]] && echo "    GitLab ALM setting updated (key=$ALM_KEY)." \
      || echo "    Warning: update_gitlab returned HTTP $HTTP" >&2
  else
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      -u "admin:$SONAR_ADMIN_PASSWORD" \
      -X POST "$SONARQUBE_URL/api/alm_settings/create_gitlab" \
      -d "key=$ALM_KEY" \
      --data-urlencode "url=$GITLAB_URL" \
      --data-urlencode "personalAccessToken=$GITLAB_TOKEN_FOR_ALM")
    if [[ "$HTTP" == "200" ]]; then
      echo "    GitLab ALM setting created (key=$ALM_KEY)."
    else
      echo "    Warning: create_gitlab returned HTTP $HTTP — ALM instance config skipped." >&2
      echo "             This is expected on SonarQube CE without community-branch-plugin." >&2
      GITLAB_TOKEN_FOR_ALM=""  # skip project binding too
    fi
  fi

  if [[ -n "$GITLAB_TOKEN_FOR_ALM" ]]; then
    # Bind the SonarQube project to the GitLab project
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      -u "admin:$SONAR_ADMIN_PASSWORD" \
      -X POST "$SONARQUBE_URL/api/alm_settings/set_gitlab_binding" \
      -d "almSetting=$ALM_KEY" \
      -d "project=$SONAR_PROJECT_KEY" \
      --data-urlencode "repository=$GITLAB_PROJECT_PATH" \
      -d "monorepo=false")
    [[ "$HTTP" == "200" ]] \
      && echo "    Project '$SONAR_PROJECT_KEY' bound to GitLab path '$GITLAB_PROJECT_PATH'." \
      || echo "    Warning: set_gitlab_binding returned HTTP $HTTP" >&2
  fi
fi

# ---------------------------------------------------------------------------
# 5. Push sample source file and sonar-project.properties to the GitLab repo
#    (sonar-scanner requires at least one source file to analyse)
# ---------------------------------------------------------------------------
echo ""
echo "==> Ensuring sample source files exist in '$TEST_PROJECT_NAME'..."

push_file() {
  local path="$1" content="$2" message="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$path', safe=''))")?ref=main")

  local payload
  payload=$(FILE_CONTENT="$content" python3 -c "
import json, os
print(json.dumps({
  'branch': 'main',
  'commit_message': '$message',
  'content': os.environ['FILE_CONTENT']
}))")

  if [[ "$status" == "200" ]]; then
    # File exists — get its SHA and update
    local blob_id
    blob_id=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
      "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$path', safe=''))")?ref=main" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('blob_id',''))")
    # PUT to update
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      --request PUT \
      --header "PRIVATE-TOKEN: $TOKEN" \
      --header "Content-Type: application/json" \
      "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$path', safe=''))")" \
      --data "$payload")
    [[ "$HTTP" == "200" ]] && echo "    Updated: $path" || echo "    Warning: update $path returned HTTP $HTTP"
  else
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      --request POST \
      --header "PRIVATE-TOKEN: $TOKEN" \
      --header "Content-Type: application/json" \
      "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$path', safe=''))")" \
      --data "$payload")
    [[ "$HTTP" == "201" ]] && echo "    Created: $path" || echo "    Warning: create $path returned HTTP $HTTP"
  fi
}

SAMPLE_PY='def add(a, b):
    return a + b

def greet(name):
    print(f"Hello, {name}")
'

SONAR_PROPS="sonar.projectKey=${SONAR_PROJECT_KEY}
sonar.projectName=Factory Test Project
sonar.sources=.
sonar.exclusions=sonar-project.properties,.gitlab-ci.yml,**/*.md
sonar.python.version=3
"

push_file "src/sample.py"            "$SAMPLE_PY"    "chore: add sample source for SonarQube CI scan"
push_file "sonar-project.properties" "$SONAR_PROPS"  "chore: add sonar-project.properties for CI scan"

# ---------------------------------------------------------------------------
# 6. Update .gitlab-ci.yml with full inter-service pipeline
#    (setup-network.sh is the canonical owner of this file)
# ---------------------------------------------------------------------------
echo ""
echo "==> Updating .gitlab-ci.yml with SonarQube and Temporal stages..."

CI_CONTENT='stages:
  - test
  - quality
  - notify

smoke-test:
  stage: test
  image: alpine
  script:
    - echo "CI is operational"

sonarqube-scan:
  stage: quality
  image: sonarsource/sonar-scanner-cli:latest
  variables:
    GIT_DEPTH: "0"
  script:
    - sonar-scanner
      -Dsonar.projectKey=${SONARQUBE_PROJECT_KEY}
      -Dsonar.sources=.
      -Dsonar.host.url=${SONAR_HOST_URL}
      -Dsonar.token=${SONAR_TOKEN}
  allow_failure: true

notify-temporal:
  stage: notify
  image: curlimages/curl:7.88.1
  when: always
  script:
    - WORKFLOW_ID="pipeline-${CI_PIPELINE_ID}-${CI_JOB_ID}"
    - >
      curl -sf -X POST
      "http://temporal:7243/api/v1/namespaces/factory-test/workflows"
      -H "Content-Type: application/json"
      -d "{\"workflowId\":\"${WORKFLOW_ID}\",\"workflowType\":{\"name\":\"HealthCheckWorkflow\"},\"taskQueue\":{\"name\":\"factory-test-queue\"},\"requestId\":\"${WORKFLOW_ID}\"}"
  allow_failure: true
'

CI_PAYLOAD=$(CI_CONTENT="$CI_CONTENT" python3 -c "
import json, os
print(json.dumps({
  'branch': 'main',
  'commit_message': 'ci: add sonarqube-scan and notify-temporal stages (US-06)',
  'content': os.environ['CI_CONTENT']
}))")

CI_URL_KEY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('.gitlab-ci.yml', safe=''))")
FILE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$CI_URL_KEY?ref=main")

if [[ "$FILE_STATUS" == "200" ]]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --request PUT \
    --header "PRIVATE-TOKEN: $TOKEN" \
    --header "Content-Type: application/json" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$CI_URL_KEY" \
    --data "$CI_PAYLOAD")
  [[ "$HTTP" == "200" ]] && echo "    .gitlab-ci.yml updated." || { echo "Error: PUT .gitlab-ci.yml returned HTTP $HTTP" >&2; exit 1; }
else
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --request POST \
    --header "PRIVATE-TOKEN: $TOKEN" \
    --header "Content-Type: application/json" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/$CI_URL_KEY" \
    --data "$CI_PAYLOAD")
  [[ "$HTTP" == "201" ]] && echo "    .gitlab-ci.yml created." || { echo "Error: POST .gitlab-ci.yml returned HTTP $HTTP" >&2; exit 1; }
fi

# ---------------------------------------------------------------------------
# 7. Trigger pipeline and wait for completion
# ---------------------------------------------------------------------------
echo ""
echo "==> Triggering integration pipeline..."
PIPELINE_BODY=$(curl -sf \
  --request POST \
  --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/pipeline" \
  --data "ref=main")
PIPELINE_ID=$(echo "$PIPELINE_BODY" | json "['id']")
echo "    Pipeline #$PIPELINE_ID triggered."

echo "==> Waiting for pipeline to complete (max 10 min)..."
for i in $(seq 1 60); do
  STATUS=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/pipelines/$PIPELINE_ID" \
    | json "['status']")
  echo "    Pipeline #$PIPELINE_ID: $STATUS"
  [[ "$STATUS" == "success" ]] && break
  [[ "$STATUS" == "failed" || "$STATUS" == "canceled" ]] && {
    echo "Pipeline $STATUS. See: $GITLAB_URL/root/$TEST_PROJECT_NAME/-/pipelines/$PIPELINE_ID" >&2
    exit 1
  }
  [[ "$i" -eq 60 ]] && { echo "Timeout: pipeline did not complete in 10 minutes." >&2; exit 1; }
  sleep 10
done

# Report individual job outcomes (informational — sonarqube-scan and notify-temporal are allow_failure)
echo "==> Individual job results:"
curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/pipelines/$PIPELINE_ID/jobs" \
  | python3 -c "
import json, sys
jobs = json.load(sys.stdin)
for j in jobs:
    status = j.get('status','?')
    af = j.get('allow_failure', False)
    flag = ' (allow_failure)' if af else ''
    print(f'    [{status.upper()}] {j[\"name\"]}{flag}')
"

# ---------------------------------------------------------------------------
# 8. Log scan for connectivity errors (advisory)
# ---------------------------------------------------------------------------
echo ""
echo "==> Scanning service logs for connectivity errors..."
ERRORS_FOUND=0
for svc in gitlab-runner sonarqube temporal; do
  if docker logs "$svc" 2>&1 | grep -qiE "connection refused|network unreachable|no route to host"; then
    echo "    WARNING: connectivity errors found in logs of '$svc'" >&2
    ERRORS_FOUND=1
  else
    echo "    [OK] $svc — no connectivity errors"
  fi
done

if [[ "$ERRORS_FOUND" -eq 1 ]]; then
  echo "    (Connectivity warnings found — review logs manually with: docker logs <service>)"
fi

# ---------------------------------------------------------------------------
# 9. Configure GitLab Pipeline Hook → pipeline-worker webhook (US-1 EPIC-08)
# ---------------------------------------------------------------------------
echo ""
echo "==> Configuring GitLab Pipeline Hook on Software Factory project..."

# Allow GitLab to send webhooks to local Docker network addresses
docker exec gitlab gitlab-rails runner "
  app = ApplicationSetting.current
  app.allow_local_requests_from_web_hooks_and_services = true
  app.save!
" 2>/dev/null && echo "    GitLab local webhook requests enabled." \
  || echo "    Warning: could not enable local webhook requests (non-fatal)." >&2

FACTORY_PROJECT_ID=3
WEBHOOK_ENDPOINT="http://pipeline-worker:9093/webhook/gitlab-ci"
WEBHOOK_TOKEN="${GITLAB_WEBHOOK_SECRET:-}"

EXISTING_HOOK_ID=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects/$FACTORY_PROJECT_ID/hooks" 2>/dev/null \
  | python3 -c "
import json, sys
try:
  hooks = json.load(sys.stdin)
  match = next((str(h['id']) for h in hooks if h.get('url') == '$WEBHOOK_ENDPOINT'), '')
  print(match)
except Exception:
  print('')
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_HOOK_ID" ]]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" --request PUT \
    --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$FACTORY_PROJECT_ID/hooks/$EXISTING_HOOK_ID" \
    --data-urlencode "url=$WEBHOOK_ENDPOINT" \
    --data "pipeline_events=true" \
    --data-urlencode "token=$WEBHOOK_TOKEN")
  [[ "$HTTP" == "200" ]] \
    && echo "    Pipeline Hook updated (id=$EXISTING_HOOK_ID) → $WEBHOOK_ENDPOINT" \
    || echo "    Warning: PUT hook returned HTTP $HTTP" >&2
else
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" --request POST \
    --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$FACTORY_PROJECT_ID/hooks" \
    --data-urlencode "url=$WEBHOOK_ENDPOINT" \
    --data "pipeline_events=true" \
    --data-urlencode "token=$WEBHOOK_TOKEN")
  [[ "$HTTP" == "201" ]] \
    && echo "    Pipeline Hook created on project $FACTORY_PROJECT_ID → $WEBHOOK_ENDPOINT" \
    || echo "    Warning: POST hook returned HTTP $HTTP" >&2
fi

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
echo ""
echo "====================================================="
echo " Network bootstrap complete (US-06)"
echo "====================================================="
echo " GitLab   : $GITLAB_URL/root/$TEST_PROJECT_NAME"
echo " SonarQube: $SONARQUBE_URL/dashboard?id=$SONAR_PROJECT_KEY"
echo " Temporal : http://localhost:8080/namespaces/$TEMPORAL_NAMESPACE"
echo ""
echo " Pipeline #$PIPELINE_ID: $GITLAB_URL/root/$TEST_PROJECT_NAME/-/pipelines/$PIPELINE_ID"
echo ""
echo " CI/CD variables set in project $PROJECT_ID:"
echo "   SONAR_TOKEN           (masked)"
echo "   SONAR_HOST_URL        http://sonarqube:9000"
echo "   SONARQUBE_PROJECT_KEY $SONAR_PROJECT_KEY"
echo ""
echo " SonarQube GitLab ALM:"
echo "   ALM setting key : $ALM_KEY"
echo "   GitLab URL      : $GITLAB_URL"
echo "   Project binding : $SONAR_PROJECT_KEY → $GITLAB_PROJECT_PATH"
echo "====================================================="
