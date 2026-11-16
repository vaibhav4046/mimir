#!/usr/bin/env bash
# Starts HydraDB (single node, local object store) and the Context Graph Lab server.
set -euo pipefail
ROOT=/tmp/hydra
rm -rf "$ROOT"; mkdir -p "$ROOT/store" "$ROOT/cache"
printf '%s\n' 'local-dev-auth-token-32-characters-long' >"$ROOT/auth-token"

export CLOUD_PROVIDER=local LOCAL_PATH="$ROOT/store"
export GRAPH_NAMESPACE=local GRAPH_ID=default GRAPH_CELL_ID=cell-0 GRAPH_CELLS=cell-0 GRAPH_DATA_PATH=data
export GRAPH_ALLOW_PLAINTEXT=true GRAPH_AUTH_TOKEN_FILE="$ROOT/auth-token"
export GRAPH_DATA_CACHE_BYTES=536870912 GRAPH_DATA_CACHE_DIR="$ROOT/cache"
export GRAPH_NODE_ID=node-0
export GRAPH_BOLT_ADDR=127.0.0.1:17687 GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:17687 GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:17687
export GRAPH_HTTP_ADDR=127.0.0.1:18443 GRAPH_ADMIN_ADDR=127.0.0.1:19091
export RUST_MIN_STACK=33554432 RUST_LOG=warn

/usr/local/bin/graph-node >"$ROOT/node.log" 2>&1 &
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:19091/readyz >/dev/null 2>&1 && break
  sleep 1
done
echo "HydraDB ready, starting the lab"
cd /srv/ctx
exec node app/server.mjs
