#!/usr/bin/env bash
# Meta bootstrap — runs all setup scripts in dependency order.
# SonarQube and Temporal are bootstrapped in parallel (independent).
# GitLab runs last because it is the slowest container to become healthy.
# Usage: bash infrastructure/scripts/setup-all.sh [--no-compose] [--from <N>]
#   --no-compose  skip `docker compose up -d` (containers already running)
#   --from <N>    resume from step N (1-5); steps before N are skipped
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$(mktemp -d)"

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────
banner() {
  echo -e "\n${CYAN}${BOLD}━━━  $*  ━━━${RESET}"
}

ok() {
  echo -e "${GREEN}✔  $*${RESET}"
}

fail() {
  echo -e "${RED}✖  $*${RESET}" >&2
}

# Run a script, stream its output, exit on failure.
run() {
  local label="$1" script="$SCRIPT_DIR/$2"
  echo -e "\n${YELLOW}▶ $label${RESET}"
  if bash "$script"; then
    ok "$label — done"
  else
    fail "$label — FAILED (exit $?)"
    exit 1
  fi
}

# Run a script in the background, capturing output to a log file.
# Writes the PID to $LOG_DIR/<label>.pid — must be called without $() so the
# background process remains a child of the main shell (not a subshell).
run_bg() {
  local label="$1" script="$SCRIPT_DIR/$2"
  local slug logfile
  slug="$(echo "$label" | tr ' ' '_')"
  logfile="$LOG_DIR/${slug}.log"
  echo -e "${YELLOW}▶ $label (background → $logfile)${RESET}"
  bash "$script" >"$logfile" 2>&1 &
  echo $! >"$LOG_DIR/${slug}.pid"
}

# Wait for a background job started by run_bg; stream its log then report.
await() {
  local label="$1"
  local slug logfile pid
  slug="$(echo "$label" | tr ' ' '_')"
  logfile="$LOG_DIR/${slug}.log"
  pid=$(cat "$LOG_DIR/${slug}.pid")
  if wait "$pid"; then
    sed "s/^/  [${label}] /" "$logfile"
    ok "$label — done"
  else
    sed "s/^/  [${label}] /" "$logfile" >&2
    fail "$label — FAILED"
    exit 1
  fi
}

# ─── Parse args ───────────────────────────────────────────────────────────────
SKIP_COMPOSE=false
FROM_STEP=1
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    --no-compose) SKIP_COMPOSE=true ;;
    --from)
      i=$((i + 1))
      FROM_STEP="${args[$i]}"
      if ! [[ "$FROM_STEP" =~ ^[1-5]$ ]]; then
        echo -e "${RED}--from requires a step number between 1 and 5${RESET}" >&2
        exit 1
      fi
      ;;
  esac
done

# skip_before <N>: returns true (0) when the current step should be skipped.
skip_before() { [[ "$FROM_STEP" -gt "$1" ]]; }

# ─── Step 1: Docker Compose ───────────────────────────────────────────────────
if skip_before 1; then
  echo -e "${YELLOW}  ⏭  Step 1/5 — Docker Compose (skipped)${RESET}"
else
  banner "Step 1/5 — Docker Compose"
  if [[ "$SKIP_COMPOSE" == true ]]; then
    echo "  --no-compose: skipping docker compose up"
  else
    docker compose -f "$ROOT_DIR/infrastructure/docker-compose.yml" up -d
    ok "All containers started"
  fi
fi

# ─── Step 2: SonarQube + Temporal in parallel ─────────────────────────────────
if skip_before 2; then
  echo -e "${YELLOW}  ⏭  Step 2/5 — SonarQube & Temporal (skipped)${RESET}"
else
  banner "Step 2/5 — SonarQube & Temporal (parallel)"
  run_bg "SonarQube" setup-sonarqube.sh
  run_bg "Temporal"  setup-temporal.sh

  await "SonarQube"
  await "Temporal"
fi

# ─── Step 3: SonarQube analysis (needs step 2 SonarQube done) ─────────────────
if skip_before 3; then
  echo -e "${YELLOW}  ⏭  Step 3/5 — SonarQube Analysis (skipped)${RESET}"
else
  banner "Step 3/5 — SonarQube Analysis"
  run "SonarQube Analysis" setup-sonarqube-analysis.sh
fi

# ─── Step 4: GitLab (slowest container — run last among setup scripts) ─────────
if skip_before 4; then
  echo -e "${YELLOW}  ⏭  Step 4/5 — GitLab (skipped)${RESET}"
else
  banner "Step 4/5 — GitLab"
  run "GitLab" setup-gitlab.sh
fi

# ─── Step 5: Inter-service network (needs everything above) ────────────────────
if skip_before 5; then
  echo -e "${YELLOW}  ⏭  Step 5/5 — Network (skipped)${RESET}"
else
  banner "Step 5/5 — Network"
  run "Network" setup-network.sh
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
rm -rf "$LOG_DIR"
echo -e "\n${GREEN}${BOLD}┌─────────────────────────────────────────┐${RESET}"
echo -e "${GREEN}${BOLD}│  All services bootstrapped successfully! │${RESET}"
echo -e "${GREEN}${BOLD}└─────────────────────────────────────────┘${RESET}\n"
