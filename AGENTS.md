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
`signInWithPassword`), **not** as `anon`.

The real cause is broader than that one role.
`supabase/migrations/20260912181419_001_initial_schema.sql` creates **80 RLS
policies and zero grants**. In Postgres those are two separate layers: the policy
decides *which rows*, the grant decides *whether at all*. Postgres checks the
grant first, so a table with a perfectly permissive `USING (true)` policy still
refuses with `42501 permission denied` when the role holds no privilege. The RLS
default also grants nothing on a new table, so `vehicles`, `sales`,
`calculations`, `imports`, `jobs` — everything — refuses reads for both roles.

The later `20260914203000_grant_mobile_publisher_access.sql` did hand out grants,
but only for the six `mobile_bg_*` publisher tables, and only the narrow subset
the worker needs. That is why `mobile_bg_publish_jobs` answers and
`mobile_bg_drafts` does not: the table the worker *writes* was granted, the one
the worker *reads* was not.

When changing access here there are three roles to satisfy:

* `authenticated` — the single signed-in admin; needs full read/write on every
  table the UI touches.
* `anon` — in practice the publisher worker, which runs with the public key when
  the service role key is absent. It needs to *read* `mobile_bg_draft_fields`,
  `mobile_bg_draft_extras` and `mobile_bg_draft_images` (to load the draft's
  values, extras and photos), plus `select, insert, update` on
  `mobile_bg_publish_jobs`, `update` on `mobile_bg_drafts` and `insert` on
  `mobile_bg_draft_action_log`. It never reads `mobile_bg_drafts` itself and
  never needs `DELETE`.
* `service_role` — what the publisher *should* use; it bypasses RLS entirely.

A `42501` on a table whose policy looks correct is a missing **grant**, not a
missing policy. Postgres reports the two differently.

### Auth is a single hardcoded email

`ADMIN_EMAIL` in `src/components/AuthGate.tsx` is the only thing standing between
the public internet and the data. **This repository is public**, so that address
is public. Anyone can call `signUp` with it; whether they get in depends on
whether the Supabase project still has email confirmation switched on. If that
setting is ever turned off, whoever asks first owns the account, and the policies
above are wide open `USING (true)`. Keep confirmation on, or bind the tables to
`auth.uid()` instead of `true`.

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
way — `claim_mobile_bg_publish_job` mutates state and will claim a real job.## Two broken deployment paths, not one

### The URL importer has no worker on the server

The intake path is: `createDraftFromSourceUrl` in `src/lib/draft_create.ts`
invokes the `queue-source-intake` edge function, which calls the
`queue_source_intake` RPC to insert into `source_listing_jobs` and to create the
draft. That part works — both edge functions are deployed and reachable, and the
draft does get created.

Nothing then ever processes the queue. `services/source-intake-worker` requires
`SUPABASE_SERVICE_ROLE_KEY` and exits immediately without it. `deploy-vps.yml`
builds the seam but never completes it: it unpacks the worker tarball into
`/home/ubuntu/auto-import-control-center/services/source-intake-worker`, yet
installs a systemd unit only for the publisher. There is no unit file anywhere in
the repository for the intake worker — line 118 of the deploy only *reads* an
`EnvironmentFiles` property from a `source-intake-worker.service` that has never
been installed. No cron entry starts it either.

Consequence: **URL import can never produce a populated draft, however complete
the catalog flow becomes.** The draft stays empty and `source_listing_jobs` keeps
the job `QUEUED` for ever. This is the second half of the original complaint, and
it is a deployment gap rather than a code bug.

Fix, when picking it up: add `SUPABASE_SERVICE_ROLE_KEY` as a repository secret,
write it into `/etc/aicc-source-intake.env` in the deploy, and install the
worker's `.service` and `.timer` the same way the publisher is installed. The
worker always needs the service role key — it has no anon fallback, unlike the
publisher. Its `ingest-source-listing` call also passes
`SUPABASE_SERVICE_ROLE_KEY` as the bearer token directly, so the key is not
optional on any path.

### Look for the owner's `SUPABASE_SERVICE_ROLE_KEY` GitHub secret first

The deploy already tries to find the service role key in this order:

1. the `Environment` property of any unit whose name matches
   `(source|intake|worker|import|publish)`;
2. the `EnvironmentFiles` of those same units;
3. `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` — only if one was set up already.

The key is expected to be the owner's `SUPABASE_SERVICE_ROLE_KEY` repository
secret, under exactly that name. Before building anything new, check whether it
exists: if it does, the deploy starts picking it up on its own and the warning
stops.

## The public key is published on purpose

`src/lib/supabase.ts` contains the publishable `anon` key, and the deploy writes
the same value into `/etc/aicc-mobile-publisher.env` as `SUPABASE_ANON_KEY`. They
match exactly. This is not a leak to fix: Supabase publishable keys are meant to
ship in the browser bundle and are useless without a session plus a matching
grant. Its JWT payload is `{"role":"anon","ref":"cgftjqwebvddtsbcbeml"}`.

Cheaper in future than a full SSH diagnostic: a `curl` of
`raw.githubusercontent.com/.../src/lib/supabase.ts` plus a read-only table probe
settles whether the deployed key is the public one. The *service role* key is the
secret; the publishable key is not.## Why publishing fails: Mobile.bg is behind Cloudflare

The worker never reaches the listing form. `mobile.bg` answers it with a `403`
Cloudflare interstitial — `server: cloudflare`, title `Just a moment...`, no
form controls at all. Reproduce it read-only at any time:

```bash
curl -s -D - -o /dev/null "https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1" \
  -H 'User-Agent: Mozilla/5.0 ... Chrome/131.0'
# HTTP/2 403, server: cloudflare
```

This is what every `NEEDS_CONFIGURATION` row in `mobile_bg_publish_jobs`
actually means. The stored `result.skipped` lists all twenty fields against
`f5..f19`, and `result.live.frame` is a blank white 1280x720 screen — the
challenge page, not a half-filled form. The browser profile at
`MOBILE_BG_USER_DATA_DIR` is empty, so no clearance cookie was ever stored:
there has never been a successful session.

Two traps in the old code made this look like a mapping bug, and both are fixed:

* `loginIfNeeded` returned `already_logged_in` whenever the page had no password
  box. The challenge page has no password box either, so a blocked run reported a
  successful login. It now checks for the form itself first.
* Nothing distinguished an interstitial from the form. `isChallengePage` now
  does, and `waitForForm` gives the challenge time to clear before reporting.

### The bundled browser cannot pass it

The server has **no real Chrome**: `google-chrome`, `google-chrome-stable`,
`chromium` and `chromium-browser` are all absent. Playwright 1.63.0 has fetched
only `chromium-1243` and `chromium_headless_shell-1243`. The worker runs
`MOBILE_BG_HEADLESS=true`, which selects the headless shell — the build Cloudflare
is most suspicious of. `launchBrowser` now prefers a real Chrome channel and
falls back to bundled Chromium, but on the server that fallback is what runs, so
**setting `channel: 'chrome'` alone will not get past the challenge.**

### What actually needs deciding

Cloudflare's managed challenge cannot be solved reliably by a headless browser,
and the run happens from a datacenter IP that is itself a signal. There are three
honest options, in rough order of effort:

1. **Solve the challenge once in a real browser on the server and keep the
   profile.** Install a desktop Chrome plus `xvfb`, run the publisher headed,
   and complete the challenge by hand over VNC or RDP. The clearance cookie lands
   in the persistent profile and later runs reuse it. Cheapest, but the cookie
   expires and the challenge returns, so it is a recurring manual step rather than
   a fix.
2. **Residential or mobile proxy.** Publishes from an IP Cloudflare does not
   pre-flag, which removes most of the challenge. Needs a paid third-party
   service and an architecture decision about credentials.
3. **Mobile.bg's own bulk-upload path.** Ask the site whether it offers an
   authorised dealer feed or API upload. It is the only approach that is both
   stable and within their terms, and it removes the browser from the loop
   entirely.

Do not paper over this by loosening the field mapping or treating the run as
successful: the fields are mapped correctly — the test suite proves that against
the stub — and no mapping change can conjure a form out of a 403 page.

### Confirm before hammering

`finish` writes `NEEDS_CONFIGURATION` rather than `QUEUED`, and `claim` only
picks up `QUEUED`, so a job does **not** retry in a loop. Keep it that way while
the challenge is unresolved: an automatic retry against a Cloudflare challenge
escalates the block instead of solving it.## The reference publisher in `docs/`

`docs/mobilebg-direct-publisher.reference.mjs` is a **reconstruction**. The
original was supplied on 2026-09-17; diff it against the copy before trusting
either. The reconstruction silently lost a backslash-escape: it read
`[style*=background-image]` where the original reads `[style*="background-image"]`.
That selector matches nothing, so the "wait until every photo is attached" loop
counted zero and every run failed at `0/N photos attached before final step`.
That is a reconstruction defect, not a site fault.

### What it proves

It reached the real form and published real listings, so its identifiers are
taken from the site rather than guessed. Ours match on `f5..f19` and the
`actions=2` query string. It sets `f14` to `януари`; our requirement is April,
so do not copy that value.

### What our publisher is missing from it

* `f11` — body type (`Джип`, `Пикап`, `Седан`, `Ван` …), which our
  `FIELD_SELECTORS` omits entirely.
* `f22` — the contact phone, hardcoded as `0887353653`.
* Submitting step 1 programmatically with
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f.elements.actions, '2')`
  then `HTMLFormElement.prototype.submit.call(f)`, instead of hunting for a
  «Продължи» control. Our `advanceFromDataStage` searches for that control by
  text and gives up when it is not a visible enabled button.
* Confirming the result with the exact text `Преглед на обявата`, and then
  opening the public listing and counting *really loaded* photos
  (`naturalWidth > 0`) rather than trusting the form.

### What it does not solve

It reads jobs from a local JSON file and ships photos through an external
browser gateway (`V4_GATEWAY_URL`, `V4_RUN_TOKEN`), bypassing Supabase entirely.
Our drafts live in the database and the live screen reads the run state from
there. Copy the techniques, not the plumbing.

It also runs inside a real, already-signed-in browser session driven over the
DevTools protocol — the same footing as the agent session that reached the form.
That is why it never met the Cloudflare challenge, and why neither it nor any
other script resolves the challenge problem described above.

### The decisive experiment, when a form session is available

Run the reference script against one catalog draft from a browser profile that
can actually reach the form. It answers, in one shot, whether the field mapping
and the two-step submit really work — everything currently hidden behind the 403.
Everything else in this file is inference until that runs.

## Look for an existing secret before adding one

Before adding a repository secret, list what already exists — a key may already
be stored under a different name:

```bash
gh secret list --repo tasevrosen86-cpu/auto-import-control-center
```

The deploy reads `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`; if the owner stored
the key as `VITE_SUPABASE_SERVICE_ROLE_KEY` or similar, that listing explains
both why the deploy warns about a missing key and where the value already is.## The Publications section is a second, isolated publish path

`services/publications-publisher/` + `src/pages/Publications.tsx` + the
`publication_*` tables. It must stay isolated from «Обяви»: it does not import,
edit or replace `services/mobile-publisher` and does not read or write the
`mobile_bg_*` tables. The old flow remains the fallback.

The point of the second path is the transport, not the steps. The proven
`mobilebg-direct-publisher` never met the Cloudflare challenge because it does
not launch a browser — it is handed an already-running, already-authenticated
Browser Use session over CDP. `src/form.mjs` keeps those steps and
`src/session.mjs` swaps the transport, because the gateway and Playwright both
speak CDP.

`browser-test` is a gate, not a formality: it reports whether the form and its
fields are really present, and it currently answers no.

## The gateway call shape is the one unknown left

The proven script shows exactly one gateway call — `browser/upload` with a
`FormData` body and a bearer token. How it drives the DevTools protocol is not
shown. `services/publications-publisher/src/session.mjs` therefore treats both
paths as configuration (`BROWSER_CDP_PATH`, `BROWSER_UPLOAD_PATH`) instead of
hardcoding a guess, and `send()` is the single place to change once the real
relay is known. If the gateway does not relay arbitrary CDP methods, that one
function is rewritten; `form.mjs` stays as it is.