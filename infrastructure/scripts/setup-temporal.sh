#!/usr/bin/env bash
# Setup Temporal — EPIC-01 / US-05
# Idempotent: safe to re-run
# Run once after `docker compose up -d` to create the factory-test namespace
# and verify the test worker is polling.
set -euo pipefail

TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-factory-test}"
TEMPORAL_TASK_QUEUE="factory-test-queue"
TEMPORAL_ADDRESS="temporal:7233"
MAX_WAIT_SERVER=300  # seconds
MAX_WAIT_WORKER=120  # seconds

# Shorthand for temporal CLI invoked inside the container
tcli() {
  docker exec temporal temporal --address "$TEMPORAL_ADDRESS" "$@"
}

# ─── Prerequisites ────────────────────────────────────────────────────────────

for cmd in docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is required but not installed." >&2
    exit 1
  fi
done

if ! docker info &>/dev/null; then
  echo "ERROR: Docker daemon is not running." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^temporal$'; then
  echo "ERROR: 'temporal' container is not running." >&2
  echo "       Run: docker compose -f infrastructure/docker-compose.yml up -d" >&2
  exit 1
fi

# ─── Wait for Temporal server ─────────────────────────────────────────────────

echo "==> Waiting for Temporal server to be healthy (max ${MAX_WAIT_SERVER}s)..."
elapsed=0
until tcli operator cluster health &>/dev/null; do
  if [ "$elapsed" -ge "$MAX_WAIT_SERVER" ]; then
    echo "ERROR: Temporal server did not become healthy after ${MAX_WAIT_SERVER}s." >&2
    echo "       Check logs: docker logs temporal" >&2
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done
echo "    Temporal server is healthy."

# ─── Create namespace (idempotent) ────────────────────────────────────────────

echo "==> Creating namespace '${TEMPORAL_NAMESPACE}'..."
if tcli operator namespace describe "${TEMPORAL_NAMESPACE}" &>/dev/null; then
  echo "    Namespace '${TEMPORAL_NAMESPACE}' already exists — skipping."
else
  tcli operator namespace create --retention 72h "${TEMPORAL_NAMESPACE}"
  echo "    Namespace '${TEMPORAL_NAMESPACE}' created (retention: 72h)."
fi

# ─── Wait for worker pollers ──────────────────────────────────────────────────

echo "==> Waiting for worker pollers on '${TEMPORAL_TASK_QUEUE}' (max ${MAX_WAIT_WORKER}s)..."
echo "    (temporal-worker-test retries until the namespace exists)"
elapsed=0
worker_ready=false
until tcli task-queue describe \
      --namespace "${TEMPORAL_NAMESPACE}" \
      --task-queue "${TEMPORAL_TASK_QUEUE}" 2>/dev/null \
      | grep -qi "poller"; do
  if [ "$elapsed" -ge "$MAX_WAIT_WORKER" ]; then
    echo "WARNING: No worker pollers detected after ${MAX_WAIT_WORKER}s."
    echo "         Check: docker logs temporal-worker-test"
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

if [ "$elapsed" -lt "$MAX_WAIT_WORKER" ]; then
  worker_ready=true
  echo "    Worker pollers detected on '${TEMPORAL_TASK_QUEUE}'."
fi

# ─── End-to-end workflow execution ───────────────────────────────────────────

if [ "$worker_ready" = true ]; then
  echo "==> Executing HealthCheckWorkflow (end-to-end verification)..."
  if tcli workflow run \
      --namespace "${TEMPORAL_NAMESPACE}" \
      --task-queue "${TEMPORAL_TASK_QUEUE}" \
      --type HealthCheckWorkflow \
      --execution-timeout 30s &>/dev/null; then
    echo "    HealthCheckWorkflow completed successfully."
  else
    echo "WARNING: Test workflow did not complete — worker may still be warming up."
  fi
fi

# ─── Create production namespace ─────────────────────────────────────────────

echo "==> Creating namespace 'factory'..."
if tcli operator namespace describe "factory" &>/dev/null; then
  echo "    Namespace 'factory' already exists — skipping."
else
  tcli operator namespace create --retention 72h "factory"
  echo "    Namespace 'factory' created (retention: 72h)."
fi

# ─── Register custom search attributes ───────────────────────────────────────
# Must run before the pipeline worker starts its first workflow execution.
# Attributes are namespace-scoped; register for both production and test namespaces.

echo "==> Registering custom search attributes..."
for ns in "factory" "${TEMPORAL_NAMESPACE}"; do
  for attr_def in "GitLabIssueIid:Int" "PipelineStage:Keyword"; do
    attr_name="${attr_def%%:*}"
    attr_type="${attr_def##*:}"
    if tcli operator search-attribute list --namespace "$ns" 2>/dev/null | grep -q "$attr_name"; then
      echo "    [$ns] Search attribute '$attr_name' already exists — skipping."
    else
      tcli operator search-attribute create \
        --namespace "$ns" --name "$attr_name" --type "$attr_type"
      echo "    [$ns] Search attribute '$attr_name' ($attr_type) created."
    fi
  done
done

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "====================================================="
echo " Temporal bootstrap complete"
echo "====================================================="
echo " Server gRPC  : localhost:7233"
echo " UI           : http://localhost:8080"
echo " Namespace    : ${TEMPORAL_NAMESPACE}"
echo " Task queue   : ${TEMPORAL_TASK_QUEUE}"
echo ""
echo " View worker pollers in UI:"
echo "   http://localhost:8080/namespaces/${TEMPORAL_NAMESPACE}/task-queues/${TEMPORAL_TASK_QUEUE}"
echo ""
echo " Useful commands:"
echo "   docker logs temporal"
echo "   docker logs temporal-worker-test"
echo "   docker exec temporal temporal --address ${TEMPORAL_ADDRESS} task-queue describe --namespace ${TEMPORAL_NAMESPACE} --task-queue ${TEMPORAL_TASK_QUEUE}"
echo "====================================================="
