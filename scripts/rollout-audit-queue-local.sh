#!/usr/bin/env bash
# Enable DB audit queue locally: worker first, soak, then web enqueue-only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SHOP="${1:-rishabh-dev-store-mdqu0epm.myshopify.com}"
SOAK_COUNT="${2:-3}"
SOAK_WATCH_MS="${3:-180000}"

if [ ! -f .env ]; then
  echo "Missing .env in $ROOT" >&2
  exit 1
fi

echo "=== Step 0: ensure worker Shopify env ==="
if ! grep -q '^SHOPIFY_API_KEY=.' .env 2>/dev/null; then
  echo "Pulling Shopify app credentials into .env (required for standalone worker)…"
  npx shopify app env pull --config pagepulse --env-file .env >/dev/null 2>&1 || {
    echo "Run: npx shopify app env pull --config pagepulse --env-file .env" >&2
    exit 1
  }
fi
# Queue flags must stay: web enqueue-only, worker drains in its own process.
grep -q '^AUDIT_USE_DB_QUEUE=' .env || echo 'AUDIT_USE_DB_QUEUE=true' >> .env
grep -q '^AUDIT_WORKER_ENABLED=' .env || echo 'AUDIT_WORKER_ENABLED=false' >> .env
sed -i 's/^AUDIT_USE_DB_QUEUE=.*/AUDIT_USE_DB_QUEUE=true/' .env
sed -i 's/^AUDIT_WORKER_ENABLED=.*/AUDIT_WORKER_ENABLED=false/' .env
node scripts/sync-admin-merchant-url.mjs 2>/dev/null || true
node scripts/ensure-shopify-app-url.mjs || {
  echo "Cannot run audits without SHOPIFY_APP_URL in root .env" >&2
  exit 1
}

set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|SHOPIFY_|AUDIT_)' .env | sed 's/\r$//')
set +a

grep -q '^AUDIT_USE_DB_QUEUE=true' .env || {
  echo "Set AUDIT_USE_DB_QUEUE=true in .env first" >&2
  exit 1
}

if [ "${AUDIT_WORKER_ENABLED:-false}" != "false" ]; then
  echo "⚠ For soak, root .env should have AUDIT_WORKER_ENABLED=false (web enqueue only)."
  echo "  Worker process sets AUDIT_WORKER_ENABLED=true itself."
fi

TSX="$ROOT/admin-panel/node_modules/tsx/dist/cli.mjs"
WORKER_PID=""
cleanup() {
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "Stopping audit worker (pid $WORKER_PID)…"
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Step 1: start audit worker (queue on, drain on) ==="
# Local dev hosts often sit above 75% RAM; allow claims unless .env sets a stricter watermark.
export AUDIT_MEMORY_HIGH_WATERMARK="${AUDIT_MEMORY_HIGH_WATERMARK:-off}"
AUDIT_USE_DB_QUEUE=true AUDIT_WORKER_ENABLED=true \
  AUDIT_MEMORY_HIGH_WATERMARK="$AUDIT_MEMORY_HIGH_WATERMARK" \
  node "$TSX" --env-file=.env app/worker/audit-worker.ts &
WORKER_PID=$!
sleep 3
if ! kill -0 "$WORKER_PID" 2>/dev/null; then
  echo "Worker failed to start — check logs above." >&2
  exit 1
fi
echo "Worker pid $WORKER_PID"

echo "=== Step 2: soak enqueue ($SHOP × $SOAK_COUNT, watch ${SOAK_WATCH_MS}ms) ==="
node "$TSX" --env-file=.env scripts/audit-soak.ts "$SHOP" "$SOAK_COUNT" "$SOAK_WATCH_MS"

echo "=== Step 3: metrics snapshot ==="
SECRET="$(grep -m1 '^INTERNAL_API_SECRET=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
APP_URL="$(grep -m1 '^SHOPIFY_APP_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -n "$SECRET" ] && [ -n "$APP_URL" ]; then
  curl -s -X POST "${APP_URL%/}/api/internal/audit-metrics" \
    -H "Content-Type: application/json" \
    -H "x-pagepulse-internal: $SECRET" \
    -d '{}' | head -c 2000
  echo ""
fi

echo "=== Done ==="
echo "Restart merchant dev so it picks up AUDIT_USE_DB_QUEUE=true and AUDIT_WORKER_ENABLED=false."
echo "Production: pm2 start ecosystem.config.cjs — worker first, then web."