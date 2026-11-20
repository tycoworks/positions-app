#!/usr/bin/env bash
# Simulated prices, in place of a price feed. Trades are booked from the page. compose.yaml runs it
# inside the stack:
#
#   data.sh setup         run model/tables.sql and model/views.sql, unless the tables already exist
#   data.sh prices [secs] every secs (default 0.5), a price for each symbol
set -euo pipefail
cd "$(dirname "$0")"

mz() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -h "${DATABASE_HOST:-localhost}" -p "${DATABASE_PORT:-6875}" -U "${DATABASE_USER:-materialize}" "${DATABASE_NAME:-materialize}" "$@"; }

symbols=(AAPL GOOG MSFT)
prices=(201.00 170.00 460.00)

setup() {
  if [ -n "$(mz -tA -c "SELECT 1 FROM mz_tables WHERE name = 'trades'")" ]; then
    echo "already set up"
    return
  fi
  mz -f /model/tables.sql
  mz -f /model/views.sql
  echo "tables and views created"
}

# Start from the latest prices already in Materialize, if any.
load_state() {
  local i p
  for i in "${!symbols[@]}"; do
    p=$(mz -tA -c "SELECT price FROM latest_market_data WHERE symbol = '${symbols[$i]}'")
    if [ -n "$p" ]; then prices[$i]=$p; fi
  done
}

# A random walk of up to 0.2% a tick.
walk() { awk -v p="$1" -v r="$RANDOM" 'BEGIN { printf "%.2f", p * (1 + (r - 16384) / 16384 * 0.002) }'; }

price_sql() {
  prices[$1]=$(walk "${prices[$1]}")
  echo "INSERT INTO market_data VALUES ('${symbols[$1]}', ${prices[$1]}, (extract(epoch FROM now()) * 1000)::bigint);"
}

# One psql session for the whole loop, fed a statement at a time.
prices() {
  local secs=${1:-0.5} i
  load_state
  while true; do
    for i in "${!symbols[@]}"; do price_sql "$i"; done
    sleep "$secs"
  done | mz
}

case "${1:-}" in
  setup) setup ;;
  prices) prices "${2:-}" ;;
  *) echo "usage: $0 setup | prices [secs]" >&2; exit 1 ;;
esac
