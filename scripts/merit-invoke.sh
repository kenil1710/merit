#!/usr/bin/env bash
# Invokes one Merit instruction on DevNet as a keystore alias and prints the
# transaction signature. Usage: scripts/merit-invoke.sh <alias> <function> [k=v ...]
set -euo pipefail
ALIAS=$1 FUNCTION=$2; shift 2
PROGRAM=${MERIT_PROGRAM:-4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6}
REX=${MERIT_REX:-SufLA3Vvm5x7ag2RSctyJhgceMQS1ht8rYAadjdvQvb}
ARGS=()
for kv in "$@"; do ARGS+=(--arg "$kv"); done
cd "$(dirname "$0")/.."
OUT=$(rialo -n devnet --config-overrides cli.current_account="$ALIAS" client program invoke "$PROGRAM" \
  --program-dir programs/merit --function "$FUNCTION" --rex-bytecode-account "$REX" "${ARGS[@]}" 2>&1) || {
  echo "$OUT" | tail -15 >&2; exit 1; }
SIG=$(echo "$OUT" | grep -oE "Transaction: \S+|[Ss]ignature: \S+" | head -1 | awk '{print $2}')
# The CLI prints a signature for failed transactions too; report the status.
STATUS=""
for _ in 1 2 3 4 5; do
  STATUS=$(rialo -n devnet client transaction "$SIG" 2>&1 | grep -m1 "Status:" | sed 's/^ *Status: //' || true)
  [ -n "$STATUS" ] && break
  sleep 1
done
echo "$SIG $STATUS"
[[ "$STATUS" == Success* ]]
