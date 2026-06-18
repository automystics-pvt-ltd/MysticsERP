#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh — run on the production server after every git pull.
#
# Usage:
#   bash deploy.sh [pm2-app-name]
#
# pm2-app-name defaults to "mmwear-erp" (matches ecosystem.config.cjs) — override if needed.
# ---------------------------------------------------------------------------
set -euo pipefail

APP="${1:-mmwear-erp}"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔  $*${NC}"; }
info() { echo -e "${CYAN}▶  $*${NC}"; }
fail() { echo -e "${RED}✘  $*${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Deploying MysticsInventory → $APP  ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"

info "Step 1/4 — Install packages"
pnpm install --frozen-lockfile --ignore-scripts
ok "Packages up to date"

info "Step 2/4 — Build API server"
pnpm --filter @workspace/api-server run build
ok "API server built"

info "Step 3/4 — Build frontend (Vite)"
pnpm --filter @workspace/inventory run build
ok "Frontend built → artifacts/inventory/dist/public/"

info "Step 4/4 — Start/Restart PM2: $APP"
pm2 startOrRestart ecosystem.config.cjs --update-env || fail "Could not start '$APP' — check: pm2 list"
pm2 save

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete!                         ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
