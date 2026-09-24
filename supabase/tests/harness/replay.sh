#!/usr/bin/env bash
# Replays every migration onto a throwaway database on a local PostgreSQL.
#
# The migrations are written for Supabase, so a shim stands in for the objects
# Supabase creates before them (the auth schema and the roles). This makes a
# migration that cannot be applied visible here instead of at deploy time —
# one already was: a DROP POLICY statement carried a trailing FOR UPDATE.
#
# Usage: supabase/tests/harness/replay.sh
set -u

DB="${AICC_TEST_DB:-aicc_test}"
PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB")
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# The postgres unix user cannot read /workspace, so every file is piped through
# stdin rather than passed as -f.
run_sql() { "${PSQL[@]}" -f - < "$1"; }

echo "Recreating $DB"
sudo -u postgres psql -q -c "drop database if exists $DB" postgres
sudo -u postgres psql -q -c "create database $DB" postgres
for role in anon authenticated service_role; do
  sudo -u postgres psql -q -d "$DB" -c "create role $role nologin" 2>/dev/null
done
sudo -u postgres psql -q -d "$DB" -c "alter role service_role bypassrls"

echo "Applying shim"
run_sql "$ROOT/supabase/tests/harness/auth_shim.sql" || exit 1

failed=0
for file in "$ROOT"/supabase/migrations/*.sql; do
  if run_sql "$file" >/tmp/migrate.out 2>&1; then
    echo "  ok   $(basename "$file")"
  else
    echo "  FAIL $(basename "$file")"
    tail -5 /tmp/migrate.out
    failed=1
  fi
done

exit "$failed"
