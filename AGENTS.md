# Auto Import Control Center

## What this is

React + Vite + TypeScript front-end for a car-import broker, backed by Supabase.
A `services/mobile-publisher` Playwright worker publishes drafts to Mobile.bg on a
60-second systemd timer on the VPS. Deployment is `.github/workflows/deploy-vps.yml`
on every push to `main`.

## Commands

```bash
npm run typecheck    # front-end types
npm run lint         # eslint
npm run build        # vite build, output in dist/
cd services/mobile-publisher && npm run test   # Playwright form-filling tests
```

The publisher has no build step; it runs through `tsx`. Its typecheck is:

```bash
cd services/mobile-publisher
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck src/index.ts
```

## Supabase access: the trap that broke publishing

The site signs in as an `authenticated` user (`src/components/AuthGate.tsx` uses
`signInWithPassword`), **not** as `anon`. The migrations that created the tables
wrote RLS policies for both roles but only ever granted table privileges to
`anon`, and `supabase/migrations/20260914203000_grant_mobile_publisher_access.sql`
only granted to `anon` too. An `authenticated` user therefore hit
`42501 permission denied for table ...` even though the policy allowed the
operation.

When changing access here, remember there are **three** roles to satisfy:

* `authenticated` — the signed-in admin; needs full read/write on app tables.
* `anon` — the publisher worker when the service role key is missing; needs only
  the `mobile_bg_*` tables, and never `DELETE`.
* `service_role` — what the publisher *should* use.

A `42501` on a table whose policy looks correct is a missing **grant**, not a
missing policy. Postgres reports the two differently.

## Mobile.bg form behaviour

Two things about the real form are easy to get wrong and both were causing
listings to publish half-empty while the run reported success:

* Option lists arrive **after** the field they depend on is chosen — the model
  list follows the make, the area and country lists follow the location. A fixed
  sleep loses this race; wait for the list (`waitForOptions`). A stub that
  reproduces this lives in `services/mobile-publisher/test/`.
* The origin is **split across two controls**: `f18` is the market area and
  `f19` is the country. Drafts store them joined as `Извън страната → Канада`,
  so each has to be resolved separately. The draft has no country field of its
  own; the country is derived from `location`.

Selector map lives in `FIELD_SELECTORS` in `services/mobile-publisher/src/index.ts`.

### Deliberate behaviour

* `modification` (`f7`), colour, VIN, the Canada-only extras and everything else
  outside `STRICT_FIELDS` stay **optional and unlocked** — a value that does not
  match is reported in `skipped`, never fatal.
* A field in `STRICT_FIELDS` that does not land **stops** the run with
  `NEEDS_CONFIGURATION` and names itself. This is the guard against a
  half-empty listing looking successful.
* `Заглавие` and `Крайна цена` stay manually editable; the publisher only fills
  them, it never locks them.
* Currency is always EUR, condition is always `употребяван`, production month
  defaults to April, VAT to included. Canada extras are never automated.

## Stuck jobs

`claim_mobile_bg_publish_job` reclaims jobs left `RUNNING` for over 15 minutes.
Without this, one interrupted run left the job `RUNNING` for ever and the publish
button disabled with it, because `src/pages/Imports.tsx` disables the button
while `publishJob.status === 'RUNNING'`.

## Two separate flows, one shape

Do not confuse them: the Korea/Canada buttons seed a draft from the already-stored
catalog JSON (`createDraftSeed`, `src/lib/draft_seed.ts`) with no link and no
listing opened. The URL importer is separate — it opens a listing, normalises the
extracted data into the same field shape, and only then feeds the draft builder.

## Applying migrations

There is no Supabase CLI here and no DB credentials in the agent environment.
Migrations under `supabase/migrations/` are applied by hand in the Supabase SQL
Editor. Write them idempotent, and guard with `to_regclass(...) is not null` so a
table recreated by hand in the dashboard cannot fail the run.

## Verifying SQL changes

Postgres can be installed locally (`apt-get install -y postgresql`) and the
migration tested against stub tables with `anon` and `authenticated` roles
created by hand. Verify both roles, and that `anon` is refused a `DELETE`.

Read-only checks against the live database are possible with the public key:

```bash
curl -s "https://cgftjqwebvddtsbcbeml.supabase.co/rest/v1/<table>?select=id&limit=1" \
  -H "apikey: $PUBLIC_KEY"
```

A `401` with code `42501` confirms a missing grant. Never write to the queue this
way — `claim_mobile_bg_publish_job` mutates state and will claim a real job.