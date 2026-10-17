#!/usr/bin/env bash
# Build ../plinth, provision a throwaway tenant and start it in the background.
# Usage: scripts/local-plinth.sh [start|stop]. `start` writes .e2e/<port>/env; source it before the tests.
# PLINTH_LOCAL_PORT (default 38181) separates parallel servers; PLINTH_SERVER_DIR picks the checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
server="${PLINTH_SERVER_DIR:-$root/../plinth}"
port="${PLINTH_LOCAL_PORT:-38181}"
state="$root/.e2e/$port"

stop() {
  if [[ -f "$state/pid" ]]; then
    kill "$(cat "$state/pid")" 2>/dev/null || true
    rm -f "$state/pid"
  fi
}

if [[ "${1:-start}" == "stop" ]]; then
  stop
  exit 0
fi

stop
CARGO_TARGET_DIR="$server/target" cargo build --quiet --manifest-path "$server/Cargo.toml" --bin plinth --bin provision
target="$server/target/debug"

rm -rf "$state" && mkdir -p "$state/tenants"
export CENTRAL_DATABASE_URL="sqlite://$state/central.db?mode=rwc" TENANT_ROOT="$state/tenants" BOOK_ROOT="$server/book"
"$target/provision" --tenant sdk --email admin@sdk.test --password sdk-password >/dev/null

PORT="$port" RUST_LOG=warn nohup "$target/plinth" >"$state/server.log" 2>&1 &
echo $! >"$state/pid"

for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$port/v1/health" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$port/v1/health" >/dev/null || { cat "$state/server.log"; exit 1; }

cat >"$state/env" <<ENV
export PLINTH_URL=http://127.0.0.1:$port
export PLINTH_EMAIL=admin@sdk.test
export PLINTH_PASSWORD=sdk-password
export PLINTH_E2E_ROOT=sdk-e2e
export PLINTH_E2E_LOCAL=1
ENV
echo "plinth running on :$port (pid $(cat "$state/pid")); source $state/env"
