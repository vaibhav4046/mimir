#!/usr/bin/env bash
# Start a throwaway single-node HydraDB (local-directory object store, plaintext) for development.
# Usage: bash tools/start-hydradb.sh [path-to-graph-node] [root-dir]
# Ports: Bolt 17687, HTTP query API 18443, admin 19091. Token: local-dev-auth-token-32-characters-long
set -euo pipefail
BIN="${1:-$HOME/hydradb/target/release/graph-node}"
ROOT="${2:-/tmp/ctxgraph-hydra}"
pkill -f "$BIN" 2>/dev/null || true
sleep 1
rm -rf -- "$ROOT"; mkdir -p "$ROOT/store" "$ROOT/cache"
printf '%s\n' 'local-dev-auth-token-32-characters-long' >"$ROOT/auth-token"
export CLOUD_PROVIDER=local LOCAL_PATH="$ROOT/store"
export GRAPH_NAMESPACE=local GRAPH_ID=default GRAPH_CELL_ID=cell-0 GRAPH_CELLS=cell-0 GRAPH_DATA_PATH=data
export GRAPH_ALLOW_PLAINTEXT=true GRAPH_AUTH_TOKEN_FILE="$ROOT/auth-token"
export GRAPH_DATA_CACHE_BYTES=${GRAPH_DATA_CACHE_BYTES:-268435456} GRAPH_DATA_CACHE_DIR="$ROOT/cache"
export GRAPH_NODE_ID=node-0
export GRAPH_BOLT_ADDR=127.0.0.1:17687 GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:17687 GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:17687
export GRAPH_HTTP_ADDR=${GRAPH_HTTP_ADDR:-127.0.0.1:18443} GRAPH_ADMIN_ADDR=127.0.0.1:19091
export RUST_MIN_STACK=33554432 RUST_LOG=${RUST_LOG:-warn}
nohup "$BIN" >"$ROOT/node.log" 2>&1 &
echo $! >"$ROOT/node.pid"
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:19091/readyz >/dev/null 2>&1 && { echo "hydradb ready (pid $(cat "$ROOT/node.pid"))"; exit 0; }
  kill -0 "$(cat "$ROOT/node.pid")" 2>/dev/null || { echo "node died:"; tail -20 "$ROOT/node.log"; exit 1; }
  sleep 1
done
echo "timeout waiting for readiness"; tail -20 "$ROOT/node.log"; exit 1
