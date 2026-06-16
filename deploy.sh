#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — one-command deploy for MysticsInventory on the production server
#
# Usage:
#   bash deploy.sh              # interactive — prompts for PM2 app name once
#   PM2_APP=mmwear-erp bash deploy.sh   # non-interactive / CI
#
# What it does (in order):
#   1. git pull (latest code)
#   2. pnpm install (sync dependencies)
#   3. Compile shared libs  (tsc --build → lib/db, lib/api-zod, lib/api-client-react dist/)
#   4. Build API server  (esbuild → artifacts/api-server/dist/)
#   5. Build frontend    (vite   → artifacts/inventory/dist/public/)
#   6. Apply DB schema   (drizzle-kit push --force — safe, idempotent)
#   7. Restart PM2 app
#   8. Health-check — verify the process stays up for 15 s (catches crash-loops)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔  $*${NC}"; }
info() { echo -e "${CYAN}▶  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
fail() { echo -e "${RED}✘  $*${NC}"; exit 1; }

# ── resolve project root (script may be run from any directory) ───────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Working directory: $(pwd)"

# ── pre-flight: .env must exist with DATABASE_URL ─────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
[[ -f "$ENV_FILE" ]] || fail ".env not found at $ENV_FILE — create it before deploying"
grep -q "^DATABASE_URL=" "$ENV_FILE" || fail ".env exists but DATABASE_URL is missing — add it"
ok ".env looks good"

# ── PM2 app name ──────────────────────────────────────────────────────────────
if [[ -z "${PM2_APP:-}" ]]; then
  # Default to the name in ecosystem.config.cjs
  DETECTED=$(node -e "const c=require('./ecosystem.config.cjs'); console.log(c.apps[0].name);" 2>/dev/null || true)
  if [[ -n "${DETECTED:-}" ]]; then
    PM2_APP="$DETECTED"
    warn "Auto-detected PM2 app from ecosystem.config.cjs: $PM2_APP"
  else
    echo ""
    read -rp "  PM2 app name (e.g. mmwear-erp): " PM2_APP
    [[ -z "$PM2_APP" ]] && fail "PM2 app name is required"
  fi
fi

echo ""
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN}  Deploying MysticsInventory            ${NC}"
echo -e "${CYAN}  PM2 app : ${PM2_APP}                  ${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo ""

# ── 1. Pull latest code ───────────────────────────────────────────────────────
info "Step 1/8 — git pull"
git fetch origin
git reset --hard origin/main
chmod +x "$SCRIPT_DIR/start-prod.sh"
ok "Code updated"

# ── 2. Install dependencies ───────────────────────────────────────────────────
info "Step 2/8 — pnpm install"
pnpm install --frozen-lockfile
ok "Dependencies synced"

# ── 3. Compile shared libs ────────────────────────────────────────────────────
info "Step 3/8 — Compile shared libs (tsc --build)"
pnpm run typecheck:libs
ok "Libs compiled → lib/db, lib/api-zod, lib/api-client-react dist/"

# ── 4. Build API server ───────────────────────────────────────────────────────
info "Step 4/8 — Build API server"
pnpm --filter @workspace/api-server run build
[[ -f "$SCRIPT_DIR/artifacts/api-server/dist/index.mjs" ]] \
  || fail "Build succeeded but dist/index.mjs not found — check build.mjs"
ok "API server built → artifacts/api-server/dist/"

# ── 5. Build frontend ─────────────────────────────────────────────────────────
info "Step 5/8 — Build frontend"
pnpm --filter @workspace/inventory run build
ok "Frontend built → artifacts/inventory/dist/public/"

# ── 6. Apply DB schema changes ────────────────────────────────────────────────
info "Step 6/8 — Apply DB schema (drizzle-kit push)"
pnpm --filter @workspace/db run push-force
ok "DB schema up to date"

# ── 7. Restart PM2 ───────────────────────────────────────────────────────────
info "Step 7/8 — Restart PM2 app: $PM2_APP"
if pm2 describe "$PM2_APP" &>/dev/null; then
  pm2 restart "$PM2_APP" || pm2 reload "$PM2_APP" \
    || fail "Could not restart '$PM2_APP' — run: pm2 list"
else
  warn "App '$PM2_APP' not found in PM2 — starting from ecosystem.config.cjs"
  pm2 start ecosystem.config.cjs \
    || fail "Could not start from ecosystem.config.cjs"
fi
pm2 save

# ── 8. Health-check — make sure it stays up ──────────────────────────────────
info "Step 8/8 — Health-check (waiting 15 s to confirm stable start)"
sleep 15
STATUS=$(pm2 jlist 2>/dev/null \
  | python3 -c "
import sys, json
apps = json.load(sys.stdin)
app = next((a for a in apps if a['name'] == '${PM2_APP}'), None)
if not app:
    print('missing')
else:
    print(app.get('pm2_env', {}).get('status', 'unknown'))
" 2>/dev/null || echo "unknown")

RESTARTS=$(pm2 jlist 2>/dev/null \
  | python3 -c "
import sys, json
apps = json.load(sys.stdin)
app = next((a for a in apps if a['name'] == '${PM2_APP}'), None)
print(app.get('pm2_env', {}).get('restart_time', '?') if app else '?')
" 2>/dev/null || echo "?")

if [[ "$STATUS" == "online" ]]; then
  ok "Process is online (restarts since last deploy: ${RESTARTS})"
else
  echo ""
  echo -e "${RED}✘  Process status: ${STATUS} — it crashed after restart!${NC}"
  echo -e "${YELLOW}Last 30 log lines:${NC}"
  pm2 logs "$PM2_APP" --lines 30 --nostream 2>&1 | tail -35
  fail "Deploy finished but the process is not running. Fix the error above."
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete!                      ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
pm2 show "$PM2_APP" 2>/dev/null | grep -E "status|uptime|restarts" || true
