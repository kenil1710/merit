#!/usr/bin/env bash
# Runs a Merit campaign on DevNet in two steps.
#   scripts/devnet-campaign.sh prepare <name> <round_ms> <deadline_ms_from_now> <escrow> <ops> <rate> <min_score> <cap_payout> <cap_contributor> <cap_round>
#       create_campaign + fund + fund_ops (phase stays IDLE)
#   scripts/devnet-campaign.sh open <name>
#       start (round 1 opens, heartbeat armed) + open_ledger for round 1
# Slugs and addresses go to $MERIT_STATE_DIR/<name>.*; the encrypted merit-x
# token (borsh-framed, encrypted for the agent) must be in $MERIT_STATE_DIR/xlat.enc.hex.
set -euo pipefail
DIR=${MERIT_STATE_DIR:?set MERIT_STATE_DIR}
P=4qBwWYWn7ougS7sHP21x4yTDk4cwmyEqUiqNmKAYVuk6
A=${MERIT_AGENT:-8f4gqYbvcaxFyGo7x6zZWxBQU8ycxtppw54J9saw2iaz}
O=${MERIT_OWNER:-BkecjfP5fxz6s3xuAXHPPPxmoebUDkd9DsTeYBZokYwF}
cd "$(dirname "$0")/.."
inv() { ./scripts/merit-invoke.sh "$@"; }
STEP=$1 NAME=$2
if [ "$STEP" = prepare ]; then
  ROUND_MS=$3 DEADLINE_IN=$4 ESCROW=$5 OPS=$6 RATE=$7 MIN=$8 CAP_P=$9 CAP_C=${10} CAP_R=${11}
  openssl rand -hex 32 > "$DIR/$NAME.slug"; D=$(cat "$DIR/$NAME.slug")
  C=$(./target/debug/merit-tools workflow $P $O "$D" | awk '{print $2}'); echo "$C" > "$DIR/$NAME.campaign"
  NOW=$(python3 -c "import time;print(int(time.time()*1000))")
  echo "campaign $C"
  echo "create $(inv merit-owner-devnet create_campaign workflow_pda_slug=$D agent=$A rate_kelvin=$RATE min_score=$MIN cap_per_payout=$CAP_P cap_per_contributor=$CAP_C cap_per_round=$CAP_R round_length_ms=$ROUND_MS refund_deadline_ms=$((NOW+DEADLINE_IN)))"
  echo "fund $(inv merit-owner-devnet fund workflow_pda_slug=$D amount_kelvin=$ESCROW)"
  echo "fund_ops $(inv merit-owner-devnet fund_ops workflow_pda_slug=$D amount_kelvin=$OPS)"
elif [ "$STEP" = open ]; then
  D=$(cat "$DIR/$NAME.slug"); C=$(cat "$DIR/$NAME.campaign")
  echo "start $(inv merit-owner-devnet start workflow_pda_slug=$D) at $(date -u +%FT%TZ)"
  L=$(./target/debug/merit-tools ledger $P $A "$C" 1)
  echo "$L" | awk '/slug/{print $2}' > "$DIR/$NAME.ledger-slug"; echo "$L" | awk '/pda/{print $2}' > "$DIR/$NAME.ledger"
  echo "ledger $(cat "$DIR/$NAME.ledger")"
  echo "open_ledger $(inv merit-agent-devnet open_ledger workflow_pda_slug=$(cat "$DIR/$NAME.ledger-slug") campaign=$C round=1 x_token_hex=$(cat "$DIR/xlat.enc.hex"))"
  python3 -I scripts/merit-state.py "$C" round round_start_ms round_end_ms
fi
