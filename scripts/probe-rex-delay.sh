#!/usr/bin/env bash
# Measures REX unanimity/latency for merit-hello at a given request_delay_ms.
# Usage: scripts/probe-rex-delay.sh <program_id> <slug> <workflow_pda> <delay_ms>
set -euo pipefail
PROGRAM=$1 SLUG=$2 PDA=$3 DELAY=$4
RPC=${RIALO_RPC:-https://devnet.rialo.io}
sigs() {
  curl -s -X POST "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[{\"address\":\"$PDA\",\"limit\":5}]}" |
    python3 -c "import sys,json;[print(s['signature'],s['blockTime']) for s in json.load(sys.stdin)['result']['value']]"
}
BEFORE=$(sigs | head -1 | cut -d' ' -f1)
INVOKE=$(rialo -n devnet --config-overrides cli.current_account=merit-deployer client program invoke "$PROGRAM" \
  --program-dir programs/merit-hello --function probe --arg workflow_pda_slug="$SLUG" --arg delay_ms="$DELAY" 2>&1 | grep -oE "Transaction: \S+" | cut -d' ' -f2)
echo "delay=$DELAY invoke=$INVOKE"
for _ in $(seq 1 30); do
  sleep 2
  LIST=$(sigs)
  NEWEST=$(echo "$LIST" | head -1 | cut -d' ' -f1)
  [ "$NEWEST" = "$BEFORE" ] && continue
  for sig in $(echo "$LIST" | cut -d' ' -f1); do
    [ "$sig" = "$BEFORE" ] && break
    LOG=$(rialo -n devnet client transaction "$sig" 2>&1 | grep -oE "merit-hello (report|probe).*" || true)
    if echo "$LOG" | grep -q "report:"; then
      echo "callback=$sig"; echo "$LOG"
      echo "$LIST" | awk -v s="$sig" '$1==s{print "callback_time_ms=" $2}'
      exit 0
    fi
  done
done
echo "no report within 60s"
