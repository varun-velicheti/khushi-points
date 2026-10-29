#!/usr/bin/env bash
# Runs every *_test.sql file against its own throwaway local Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
for test in supabase/tests/*_test.sql; do
  echo "== $test"
  psql -q -c "drop database if exists kp_test" -c "create database kp_test"
  psql -q -d kp_test -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
  for f in supabase/migrations/*.sql; do psql -q -d kp_test -v ON_ERROR_STOP=1 -f "$f"; done
  psql -q -d kp_test -v ON_ERROR_STOP=1 -f "$test"
done
