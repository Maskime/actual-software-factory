#!/usr/bin/env bash
# Scan de secrets — vérifie qu'aucun secret n'est commité dans le dépôt Git.
# Usage :
#   bash infrastructure/scripts/check-secrets.sh          # rapport standalone
#   bash infrastructure/scripts/check-secrets.sh --hook   # mode pre-commit (même comportement, sortie adaptée)
#
# Installation comme pre-commit hook :
#   mkdir -p .git/hooks
#   cp infrastructure/scripts/check-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit

set -euo pipefail

HOOK_MODE=false
[[ "${1:-}" == "--hook" ]] && HOOK_MODE=true

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ERRORS=0
WARNINGS=0

info()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; ((WARNINGS++)) || true; }
error()   { echo -e "  ${RED}✗${NC} $*" >&2; ((ERRORS++)) || true; }

echo ""
echo "=== check-secrets : scan du dépôt $(basename "${REPO_ROOT}") ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Vérifier que les fichiers .env sont bien ignorés par git
# ---------------------------------------------------------------------------
echo "[ 1/4 ] Vérification gitignore..."

check_gitignore() {
  local file="$1"
  if [[ -f "${REPO_ROOT}/${file}" ]]; then
    if git -C "${REPO_ROOT}" check-ignore -q "${file}" 2>/dev/null; then
      info "${file} est ignoré par git"
    else
      error "${file} existe et N'EST PAS ignoré par git — risque de commit accidentel"
    fi
  fi
}

if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree &>/dev/null; then
  check_gitignore "infrastructure/.env"
  check_gitignore ".env"
  # Vérifier que .env.example est bien NON ignoré (doit être commité)
  if git -C "${REPO_ROOT}" check-ignore -q "infrastructure/.env.example" 2>/dev/null; then
    error "infrastructure/.env.example est ignoré par git — ce fichier de documentation DOIT être commité"
  else
    info "infrastructure/.env.example est accessible au commit (correct)"
  fi
else
  warn "Pas de dépôt git détecté — vérification gitignore ignorée"
fi

# ---------------------------------------------------------------------------
# 2. Vérifier que .env existe (prérequis Docker Compose)
# ---------------------------------------------------------------------------
echo ""
echo "[ 2/4 ] Présence du fichier .env..."

ENV_FILE="${REPO_ROOT}/infrastructure/.env"
if [[ -f "${ENV_FILE}" ]]; then
  info "infrastructure/.env présent"
  # Vérifier qu'aucun placeholder n'est resté vide ou à la valeur par défaut
  if grep -qE '^(ANTHROPIC_API_KEY|GITLAB_API_TOKEN|SONARQUBE_AGENT_TOKEN|GITLAB_WEBHOOK_SECRET)=$' "${ENV_FILE}"; then
    warn "Des secrets transversaux sont vides dans infrastructure/.env — les agents LLM ne fonctionneront pas"
  fi
else
  warn "infrastructure/.env absent — copier infrastructure/.env.example vers infrastructure/.env et remplir les valeurs"
fi

# ---------------------------------------------------------------------------
# 3. Scanner les fichiers trackés pour des patterns secrets
# ---------------------------------------------------------------------------
echo ""
echo "[ 3/4 ] Scan des fichiers trackés (patterns secrets)..."

if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree &>/dev/null; then
  warn "Pas de dépôt git — scan des fichiers trackés ignoré"
else
  # Récupère la liste des fichiers à scanner selon le mode
  if [[ "${HOOK_MODE}" == true ]]; then
    # En mode hook : fichiers stagés uniquement
    TRACKED_FILES=$(git -C "${REPO_ROOT}" diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
  else
    # En mode standalone : tous les fichiers trackés
    TRACKED_FILES=$(git -C "${REPO_ROOT}" ls-files 2>/dev/null || true)
  fi

  SCAN_ERRORS=0

  scan_pattern() {
    local label="$1"
    local pattern="$2"
    local matches
    if [[ -n "${TRACKED_FILES}" ]]; then
      matches=$(echo "${TRACKED_FILES}" | xargs -I{} git -C "${REPO_ROOT}" show HEAD:{} 2>/dev/null | grep -En "${pattern}" || true)
      if [[ "${HOOK_MODE}" == true ]]; then
        # En mode hook, scanner le contenu stagé
        matches=$(echo "${TRACKED_FILES}" | tr '\n' '\0' | xargs -0 git -C "${REPO_ROOT}" diff --cached -- 2>/dev/null | grep -En "^\+${pattern}" || true)
      fi
      if [[ -n "${matches}" ]]; then
        error "Pattern détecté [${label}] dans les fichiers git"
        echo "    ${matches}" | head -5 >&2
        ((SCAN_ERRORS++)) || true
      fi
    fi
  }

  # Scan des fichiers du répertoire de travail (hors .git, plus fiable que ls-files sur repo vide)
  WORKDIR_FILES=$(find "${REPO_ROOT}" \
    -not -path "${REPO_ROOT}/.git/*" \
    -not -path "${REPO_ROOT}/infrastructure/.env" \
    -not -name ".env" \
    -type f \
    \( -name "*.sh" -o -name "*.yml" -o -name "*.yaml" -o -name "*.json" -o -name "*.py" -o -name "*.md" \) \
    2>/dev/null || true)

  scan_pattern_files() {
    local label="$1"
    local pattern="$2"
    local found=0
    while IFS= read -r file; do
      [[ -f "${file}" ]] || continue
      if grep -qE "${pattern}" "${file}" 2>/dev/null; then
        error "Pattern [${label}] dans ${file#${REPO_ROOT}/}"
        ((found++)) || true
      fi
    done <<< "${WORKDIR_FILES}"
    return "${found}"
  }

  # Clé Anthropic en clair (commence par sk-ant-)
  if echo "${WORKDIR_FILES}" | xargs grep -lE 'ANTHROPIC_API_KEY\s*=\s*sk-ant-' 2>/dev/null | grep -q .; then
    error "ANTHROPIC_API_KEY avec valeur réelle (sk-ant-...) détectée dans un fichier texte"
  else
    info "Aucune clé Anthropic en clair détectée"
  fi

  # Mots de passe/tokens avec valeur non-placeholder
  # On cherche VAR=valeur où valeur n'est pas vide, change_me*, ou une variable ${...}
  PLACEHOLDER_PATTERN='=\s*($|change_me|changeme|\$\{|your_)'
  SECRET_VARS='(PASSWORD|_TOKEN|_SECRET|API_KEY)'
  suspect_files=$(echo "${WORKDIR_FILES}" | xargs grep -lE "${SECRET_VARS}\s*=\s*[^$\s]" 2>/dev/null | \
    xargs grep -lE "${SECRET_VARS}\s*=" 2>/dev/null || true)

  if [[ -n "${suspect_files}" ]]; then
    # Filtrer les faux positifs : garder seulement les fichiers avec valeurs non-placeholder
    while IFS= read -r file; do
      [[ -f "${file}" ]] || continue
      if grep -Eq "${SECRET_VARS}\s*=\s*[^$'\"{[:space:]][^[:space:]]{6,}" "${file}" 2>/dev/null; then
        if ! grep -Eq "${SECRET_VARS}\s*=\s*(change_me|changeme|your_|example|placeholder|CHANGE)" "${file}" 2>/dev/null; then
          warn "Valeurs possiblement sensibles dans ${file#${REPO_ROOT}/} — vérifier manuellement"
        fi
      fi
    done <<< "${suspect_files}"
  fi

  # Clés privées PEM
  if echo "${WORKDIR_FILES}" | xargs grep -lE 'BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY' 2>/dev/null | grep -q .; then
    error "Clé privée PEM détectée dans un fichier texte versionnable"
  else
    info "Aucune clé privée PEM détectée"
  fi

  if [[ "${SCAN_ERRORS}" -eq 0 ]]; then
    info "Scan des patterns secrets : OK"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Scan de l'historique git
# ---------------------------------------------------------------------------
echo ""
echo "[ 4/4 ] Scan de l'historique git..."

if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree &>/dev/null; then
  warn "Pas de dépôt git — scan historique ignoré"
elif ! git -C "${REPO_ROOT}" log --oneline -1 &>/dev/null 2>&1; then
  info "Dépôt sans commits — historique vide, rien à scanner"
else
  # Recherche de patterns dangereux dans tous les commits
  HISTORY_HITS=$(git -C "${REPO_ROOT}" log --all -p --follow -- . 2>/dev/null | \
    grep -E '^\+.*(ANTHROPIC_API_KEY\s*=\s*sk-ant-|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY)' || true)
  if [[ -n "${HISTORY_HITS}" ]]; then
    error "Secret potentiel détecté dans l'historique git — utiliser git-filter-repo pour l'éradiquer"
    echo "${HISTORY_HITS}" | head -5 >&2
  else
    info "Historique git : aucun secret détecté"
  fi
fi

# ---------------------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------------------
echo ""
echo "=================================================="
if [[ "${ERRORS}" -gt 0 ]]; then
  echo -e "${RED}ÉCHEC${NC} — ${ERRORS} erreur(s) détectée(s), ${WARNINGS} avertissement(s)"
  echo "Corrigez les erreurs avant de commiter."
  echo ""
  exit 1
elif [[ "${WARNINGS}" -gt 0 ]]; then
  echo -e "${YELLOW}ATTENTION${NC} — 0 erreur, ${WARNINGS} avertissement(s)"
  echo "Vérifiez les avertissements."
  echo ""
  exit 0
else
  echo -e "${GREEN}OK${NC} — Aucun secret détecté dans le dépôt."
  echo ""
  exit 0
fi
