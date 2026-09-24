#!/usr/bin/env bash
# Runs the SQL test files against the local replay database.
#
# Each test file switches its own session to `authenticated` after building its
# fixtures, because RLS does not apply to the table owner and checking as the
# postgres superuser would prove nothing. This script only supplies the schema
# usage grant that Supabase hands out by default and a plainer error report.
#
# Usage: supabase/tests/harness/isolation.sh
set -u

DB="${AICC_TEST_DB:-aicc_test}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
failed=0
ran=0

for file in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$file")"
  ran=$((ran + 1))
  if sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB" -f - < "$file" >/tmp/test.out 2>&1; then
    echo "  PASS $name"
  else
    echo "  FAIL $name"
    grep -E "ERROR|exception|CONTEXT|ЗАБЕЛЕЖКА" /tmp/test.out | head -8
    failed=1
  fi
done

if [ "$ran" -eq 0 ]; then
  echo "  no test files found"
  exit 1
fi

exit "$failed"
