#!/usr/bin/env bash
# Runs every migration plus the SQL tests in supabase/tests against a throwaway local Postgres
# (no Supabase project needed). Requires PostgreSQL 15+ binaries on PATH (or set PG_BIN).
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-$(dirname "$(command -v postgres || command -v /opt/homebrew/opt/postgresql@16/bin/postgres)")}"
export PATH="$PG_BIN:$PATH"
DIR="$(mktemp -d)"
PORT="${PGTEST_PORT:-54999}"
trap 'pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

initdb -D "$DIR/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DIR" -l "$DIR/log" -w start >/dev/null
psql_() { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -t -A "$@"; }

psql_ -c "create database t"
psql_ -d t -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "migrate $(basename "$f")"; psql_ -d t -f "$f"; done
for f in supabase/tests/*.test.sql; do
  echo "test $(basename "$f")"
  psql_ -d t -f "$f" 2>&1 | grep -E "NOTICE|ERROR|PASSED" | sed -e 's/^psql:[^ ]* //' -e 's/NOTICE:  //' | tee "$DIR/out"
  grep -q "ALL TESTS PASSED" "$DIR/out" || { echo "FAILED: $f"; exit 1; }
done
