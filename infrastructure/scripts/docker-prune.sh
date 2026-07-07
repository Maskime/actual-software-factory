#!/usr/bin/env bash
# Maintenance script: reclaims Docker disk space for the Software Factory host.
# Safe to run while the stack is up — only removes UNUSED resources.
# Handles the two disk-growth culprits:
#   1. build cache + dangling/unused images from repeated `docker compose build`
#   2. orphaned GitLab runner cache volumes (runner-<id>-cache-*) that GitLab
#      never removes on its own.
# Idempotent. Intended for cron (see infrastructure/scripts/README / CLAUDE.md)
# or `make prune`.
set -euo pipefail

RUNNER_CONTAINER="${RUNNER_CONTAINER:-gitlab-runner}"

echo "==> [$(date '+%Y-%m-%d %H:%M:%S')] docker-prune starting"

# 1. Stopped containers older than 24h (e.g. exited runner-helper containers).
echo "--> Pruning stopped containers (>24h)..."
docker container prune -f --filter "until=24h"

# 2. Unused images older than 7 days. Keeps images of running services and
#    anything referenced recently; clears superseded local worker builds.
echo "--> Pruning unused images (>168h)..."
docker image prune -af --filter "until=168h"

# 3. Unused build cache older than 7 days. Complements the daemon-level
#    BuildKit GC (daemon.json builder.gc) as a time-based safety net.
echo "--> Pruning build cache (>168h)..."
docker builder prune -af --filter "until=168h"

# 4. GitLab runner cache volumes. `verify --delete` drops config.toml entries
#    whose runner no longer exists server-side; the volume rm then removes the
#    now-orphaned cache volumes. Volumes still attached to a live runner fail
#    silently and are kept — only true orphans are removed.
if docker ps --format '{{.Names}}' | grep -qx "$RUNNER_CONTAINER"; then
  echo "--> Reconciling runner registrations + pruning orphaned cache volumes..."
  docker exec "$RUNNER_CONTAINER" gitlab-runner verify --delete || true
  docker volume ls -q --filter name=runner- \
    | xargs -r -n1 docker volume rm 2>/dev/null || true
else
  echo "--> Runner container '$RUNNER_CONTAINER' not running — skipping cache-volume prune."
fi

# 5. Report.
echo "--> Disk usage after prune:"
docker system df

echo "==> [$(date '+%Y-%m-%d %H:%M:%S')] docker-prune done"
