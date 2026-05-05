#!/usr/bin/env bash
# Bootstrap script for US-02: creates a GitLab test project, registers a runner,
# pushes a .gitlab-ci.yml, and waits for the pipeline to succeed.
# Run once after: docker compose up -d
# Requires GitLab CE 15.3+ (for POST /api/v4/user/runners).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

GITLAB_URL="${GITLAB_EXTERNAL_URL:-http://localhost}"
GITLAB_INTERNAL_URL="http://gitlab"   # URL inter-conteneurs (nom de service Docker)
TEST_PROJECT_NAME="${GITLAB_TEST_PROJECT_NAME:-factory-test}"

api() {
  local method="$1" path="$2"; shift 2
  local response http_code body
  response=$(curl -s -w "\n%{http_code}" --request "$method" \
    --header "PRIVATE-TOKEN: $TOKEN" "$@" "$GITLAB_URL/api/v4$path")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -1)
  echo "$http_code $body"
}

check() {
  local expected="$1" label="$2" result="$3"
  local code="${result%% *}" body="${result#* }"
  if [[ "$code" != "$expected" ]]; then
    echo "$label failed (HTTP $code): $body" >&2; exit 1
  fi
  echo "$body"
}

json() {
  python3 -c "import json,sys; print(json.load(sys.stdin)$1)"
}

# ---------------------------------------------------------------------------
# 1. Wait for GitLab to be healthy (up to 10 minutes)
# ---------------------------------------------------------------------------
echo "==> Waiting for GitLab to be healthy..."
for i in $(seq 1 60); do
  # Run curl inside the container to bypass the /-/health IP allowlist (default: 127.0.0.1 only)
  if docker exec gitlab curl -sf http://localhost/-/health > /dev/null 2>&1; then
    echo "    GitLab is ready."; break
  fi
  [[ "$i" -eq 60 ]] && { echo "Timeout: GitLab did not start within 10 minutes." >&2; exit 1; }
  echo "    ($i/60) not ready yet, retrying in 10s..."
  sleep 10
done

# ---------------------------------------------------------------------------
# 2. Create (or refresh) a root Personal Access Token via gitlab-rails runner
# ---------------------------------------------------------------------------
echo "==> Creating root Personal Access Token..."
TOKEN=$(docker exec gitlab gitlab-rails runner "
  existing = PersonalAccessToken.find_by(name: 'setup-token', user: User.find_by_username('root'))
  existing.revoke! if existing && !existing.revoked?
  token = User.find_by_username('root').personal_access_tokens.create!(
    name: 'setup-token',
    scopes: ['api'],
    expires_at: Date.today + 365
  )
  puts token.token
" 2>/dev/null | tail -1)

[[ -z "$TOKEN" || "$TOKEN" == "nil" ]] && { echo "Failed to create PAT." >&2; exit 1; }
echo "    PAT ready."

# ---------------------------------------------------------------------------
# 3. Create test project (idempotent)
# ---------------------------------------------------------------------------
echo "==> Creating project '$TEST_PROJECT_NAME'..."
EXISTING_ID=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects?search=$TEST_PROJECT_NAME" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
match = next((str(p['id']) for p in data if p['name'] == '$TEST_PROJECT_NAME'), '')
print(match)
")

if [[ -n "$EXISTING_ID" ]]; then
  PROJECT_ID="$EXISTING_ID"
  echo "    Project already exists (id=$PROJECT_ID)."
else
  RESULT=$(api POST /projects \
    --data "name=$TEST_PROJECT_NAME&initialize_with_readme=true&visibility=private")
  BODY=$(check 201 "Project creation" "$RESULT")
  PROJECT_ID=$(echo "$BODY" | json "['id']")
  echo "    Project created (id=$PROJECT_ID)."
fi

# ---------------------------------------------------------------------------
# 4. Register runner (idempotent — re-registers if existing runner is offline)
# ---------------------------------------------------------------------------
echo "==> Setting up runner..."
EXISTING_RUNNER=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/runners?type=instance_type" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
match = next(((str(r['id']), r.get('status','')) for r in data if r.get('description') == 'factory-runner'), ('',''))
print(match[0] + ':' + match[1])
" 2>/dev/null || true)

EXISTING_RUNNER_ID="${EXISTING_RUNNER%%:*}"
EXISTING_RUNNER_STATUS="${EXISTING_RUNNER##*:}"

if [[ -n "$EXISTING_RUNNER_ID" && "$EXISTING_RUNNER_STATUS" == "online" ]]; then
  echo "    Runner already registered and online (id=$EXISTING_RUNNER_ID), skipping."
else
  if [[ -n "$EXISTING_RUNNER_ID" ]]; then
    echo "    Runner id=$EXISTING_RUNNER_ID exists but is '$EXISTING_RUNNER_STATUS' — deleting and re-registering..."
    curl -sf --request DELETE --header "PRIVATE-TOKEN: $TOKEN" \
      "$GITLAB_URL/api/v4/runners/$EXISTING_RUNNER_ID" > /dev/null || true
  fi

  RESULT=$(api POST /user/runners \
    --data "runner_type=instance_type&description=factory-runner")
  RUNNER_BODY=$(check 201 "Runner token creation" "$RESULT")
  RUNNER_TOKEN=$(echo "$RUNNER_BODY" | json "['token']")

  docker exec gitlab-runner gitlab-runner register \
    --non-interactive \
    --url "$GITLAB_INTERNAL_URL" \
    --clone-url "$GITLAB_INTERNAL_URL" \
    --token "$RUNNER_TOKEN" \
    --executor docker \
    --docker-image alpine \
    --docker-network-mode factory-network \
    --docker-extra-hosts "host.docker.internal:host-gateway" \
    --description "factory-runner"
  echo "    Runner registered."
fi

# ---------------------------------------------------------------------------
# 5. Push .gitlab-ci.yml (idempotent)
# ---------------------------------------------------------------------------
echo "==> Pushing .gitlab-ci.yml..."
FILE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --header "PRIVATE-TOKEN: $TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/repository/files/.gitlab-ci.yml?ref=main")

if [[ "$FILE_STATUS" == "200" ]]; then
  echo "    .gitlab-ci.yml already present, skipping."
else
  CI_CONTENT=$(cat <<'YAML'
stages:
  - test

smoke-test:
  stage: test
  image: alpine
  script:
    - echo "CI is operational"
YAML
)
  PAYLOAD=$(CI_CONTENT="$CI_CONTENT" python3 -c "
import json, os
print(json.dumps({
  'branch': 'main',
  'commit_message': 'chore: add CI pipeline',
  'content': os.environ['CI_CONTENT']
}))
")
  RESULT=$(api POST "/projects/$PROJECT_ID/repository/files/.gitlab-ci.yml" \
    --header "Content-Type: application/json" --data "$PAYLOAD")
  check 201 "Push .gitlab-ci.yml" "$RESULT" > /dev/null
  echo "    .gitlab-ci.yml pushed."
fi

# ---------------------------------------------------------------------------
# 6. Trigger a fresh pipeline and wait for it to succeed
# ---------------------------------------------------------------------------
echo "==> Triggering pipeline..."
PIPELINE_RESULT=$(api POST "/projects/$PROJECT_ID/pipeline" \
  --data "ref=main")
PIPELINE_BODY=$(check 201 "Pipeline trigger" "$PIPELINE_RESULT")
PIPELINE_ID=$(echo "$PIPELINE_BODY" | json "['id']")
echo "    Pipeline #$PIPELINE_ID triggered."

echo "==> Waiting for pipeline to complete..."

for i in $(seq 1 30); do
  STATUS=$(curl -sf --header "PRIVATE-TOKEN: $TOKEN" \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/pipelines/$PIPELINE_ID" \
    | json "['status']")
  echo "    Pipeline #$PIPELINE_ID: $STATUS"
  [[ "$STATUS" == "success" ]] && break
  [[ "$STATUS" == "failed" || "$STATUS" == "canceled" ]] && {
    echo "Pipeline $STATUS. See: $GITLAB_URL/root/$TEST_PROJECT_NAME/-/pipelines/$PIPELINE_ID" >&2
    exit 1
  }
  [[ "$i" -eq 30 ]] && { echo "Timeout: pipeline did not complete in 5 minutes." >&2; exit 1; }
  sleep 10
done

echo ""
echo "Setup complete."
echo "  Project   : $GITLAB_URL/root/$TEST_PROJECT_NAME"
echo "  Pipelines : $GITLAB_URL/root/$TEST_PROJECT_NAME/-/pipelines"
echo "  Runners   : $GITLAB_URL/admin/runners"
