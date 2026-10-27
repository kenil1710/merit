#!/usr/bin/env bash
# Prints the newest transactions touching an account with their Merit log lines.
# Usage: scripts/pda-logs.sh <address> [limit]
set -euo pipefail
ADDR=$1 LIMIT=${2:-10}
curl -s https://devnet.rialo.io -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[{\"address\":\"$ADDR\",\"limit\":$LIMIT}]}" |
  python3 -I -c "import json,sys;[print(s['signature'],s['blockTime'],s.get('err')) for s in json.load(sys.stdin)['result']['value']]" |
  while read -r sig time err; do
    echo "== $sig $(python3 -c "import datetime;print(datetime.datetime.utcfromtimestamp($time/1000).strftime('%H:%M:%S'))") err=$err"
    rialo -n devnet client transaction "$sig" 2>&1 | grep -oE "(Status: .*|Merit .*)" | head -4
  done
