#!/usr/bin/env bash
# Simulated data, in place of a price feed and real trades. compose.yaml runs it inside the stack:
#
#   data.sh setup         run sql/tables.sql and sql/views.sql, unless the tables already exist
#   data.sh once          insert a price and a trade for each symbol
#   data.sh loop [secs]   every secs (default 0.5), a price for each symbol; a trade every 4th round
#   data.sh prices [secs] the same, prices only
set -euo pipefail
cd "$(dirname "$0")"

mz() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -h "${MZ_HOST:-localhost}" -p 6875 -U materialize materialize "$@"; }

symbols=(AAPL GOOG MSFT)
ids=(1 2 3)
prices=(201.00 170.00 460.00)

setup() {
  if [ -n "$(mz -tA -c "SELECT 1 FROM mz_tables WHERE name = 'trades'")" ]; then
    echo "already set up"
    return
  fi
  mz -f /sql/tables.sql
  mz -f /sql/views.sql
  echo "tables and views created"
}

# Start from the latest prices and trade id already in Materialize, if any.
load_state() {
  local i p
  for i in "${!symbols[@]}"; do
    p=$(mz -tA -c "SELECT price FROM latest_market_data WHERE symbol = '${symbols[$i]}'")
    if [ -n "$p" ]; then prices[$i]=$p; fi
  done
  next_id=$(( $(mz -tA -c "SELECT coalesce(max(id), 0) FROM trades") + 1 ))
}

# A random walk of up to 0.2% a tick.
walk() { awk -v p="$1" -v r="$RANDOM" 'BEGIN { printf "%.2f", p * (1 + (r - 16384) / 16384 * 0.002) }'; }

price_sql() {
  prices[$1]=$(walk "${prices[$1]}")
  echo "INSERT INTO market_data VALUES ('${symbols[$1]}', ${prices[$1]}, (extract(epoch FROM now()) * 1000)::bigint);"
}

# Mostly buys (positive quantity), some sells (negative).
trade_sql() {
  local qty=$(( (RANDOM % 10 + 1) * 10 ))
  if [ $(( RANDOM % 3 )) -eq 0 ]; then qty=$(( -qty )); fi
  echo "INSERT INTO trades VALUES ($next_id, ${ids[$1]}, $qty, ${prices[$1]}, now()::timestamp);"
  next_id=$(( next_id + 1 ))
}

once() {
  local i
  load_state
  for i in "${!symbols[@]}"; do price_sql "$i"; trade_sql "$i"; done | mz
}

# One psql session for the whole loop, fed a statement at a time. With "prices", no trades.
loop() {
  local secs=${1:-0.5} with_trades=$2 round=0 i
  load_state
  while true; do
    for i in "${!symbols[@]}"; do price_sql "$i"; done
    if [ "$with_trades" = yes ] && [ $(( round % 4 )) -eq 0 ]; then trade_sql $(( RANDOM % ${#symbols[@]} )); fi
    round=$(( round + 1 ))
    sleep "$secs"
  done | mz
}

case "${1:-}" in
  setup) setup ;;
  once) once ;;
  loop) loop "${2:-}" yes ;;
  prices) loop "${2:-}" no ;;
  *) echo "usage: $0 setup | once | loop [secs] | prices [secs]" >&2; exit 1 ;;
esac
