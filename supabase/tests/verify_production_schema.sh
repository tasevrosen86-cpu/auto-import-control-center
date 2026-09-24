#!/usr/bin/env bash
# Reports whether the production database has the objects the deployed site
# reads. Read-only: it never writes, and it uses the public key, which is the
# same one the browser bundle carries.
#
# This exists because the frontend and the database ship separately. The site is
# built by GitHub Actions on a push to `main`; the migrations under
# `supabase/migrations/` are applied by hand in the Supabase SQL Editor. A build
# can therefore reach autoimportcontrolcenter.biz before its tables do, and the
# first person to notice is whoever signs in.
#
# A missing table answers 404 with code PGRST205. A table that exists but grants
# the caller nothing answers 401 with 42501 — for the tables only a system
# administrator may read, that second answer is the correct one.
#
# Usage: supabase/tests/verify_production_schema.sh

set -u

SUPABASE_URL="${VITE_SUPABASE_URL:-https://cgftjqwebvddtsbcbeml.supabase.co}"
PUBLIC_KEY="${VITE_SUPABASE_ANON_KEY:-sb_publishable_3szh1-AiAAUYDeVBwO7bJQ_gXhkBU0A}"

# `required` is what the deployed frontend asks for on a normal sign-in; a
# missing one is a broken deployment. `admin_only` is expected to refuse the
# public key, which is how the catalogue stays out of a company's reach.
required=(
  profiles
  companies
  mobile_bg_drafts
  mobile_bg_published_listings
  import_conflicts
)
admin_only=(
  master_catalog
)

failures=0

probe() {
  local table="$1"
  local body
  body="$(mktemp)"
  local code
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 20 \
    -H "apikey: $PUBLIC_KEY" -H "Authorization: Bearer $PUBLIC_KEY" \
    "$SUPABASE_URL/rest/v1/$table?select=*&limit=1")"
  local payload
  payload="$(tr -d '\n' < "$body")"
  rm -f "$body"

  if [ "$code" = "200" ] || [ "$code" = "206" ]; then
    echo "  ok      $table (HTTP $code)"
    return 0
  fi
  case "$payload" in
    *PGRST205*) echo "  MISSING $table (HTTP $code) — table does not exist" ; return 1 ;;
    # The table is there; the anonymous key simply holds no grant to it, which
    # is what a policy requiring a signed-in user looks like from outside. Only
    # a missing table is a failed deployment.
    *42501*)    echo "  denied  $table (HTTP $code) — exists, no grant to the public key" ; return 0 ;;
    *)          echo "  ???     $table (HTTP $code) $payload" ; return 1 ;;
  esac
}

echo "Checking $SUPABASE_URL"
echo
echo "Required by the frontend:"
for table in "${required[@]}"; do
  probe "$table" || failures=$((failures + 1))
done

echo
echo "Administrator-only (a refusal is the expected answer):"
for table in "${admin_only[@]}"; do
  probe "$table" || failures=$((failures + 1))
done

echo
if [ "$failures" -gt 0 ]; then
  cat <<'MESSAGE'
NOT READY: run the migrations in supabase/migrations/ in the Supabase SQL
Editor, oldest first, before pointing the site at this database:

  20260925120000_royal_cars_companies_roles.sql
  20260925130000_royal_cars_tenant_isolation.sql
  20260925140000_royal_cars_prices_and_archive.sql

Do not run supabase/manual/20260925150000_royal_cars_close_anon.sql yet: the
Mobile.bg workers still reach the database with the public key, and it would
stop publishing.
MESSAGE
  exit 1
fi

echo "READY: every object the frontend reads exists."
