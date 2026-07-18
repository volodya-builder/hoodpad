#!/usr/bin/env bash
# Compile, boot a local hardhat node, run the test suite, tear down.
set -e
cd "$(dirname "$0")/.."

node scripts/compile.js

npx hardhat node --port 8545 >/tmp/hardhat-node.log 2>&1 &
NODE_PID=$!
trap "kill $NODE_PID 2>/dev/null || true" EXIT

# wait for RPC
for i in $(seq 1 30); do
  if curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    http://127.0.0.1:8545 | grep -q result; then
    break
  fi
  sleep 1
done

node --test test/*.test.mjs
