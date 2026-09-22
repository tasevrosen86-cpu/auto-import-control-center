# Auto Import Control Center

> ## Where we are right now (read this first)
>
> **The task in progress.** Build a second, independent Mobile.bg publishing path
> in a new main-menu section called **«Публикации»**. It must not touch the
> existing «Обяви» section in any way — that flow stays frozen as a fallback.
>
> **Why a second path.** The old publisher never reaches the form. Mobile.bg sits
> behind Cloudflare and answers the worker with a `403` interstitial that carries
> zero form controls, which is why every `NEEDS_CONFIGURATION` row lists all
> twenty fields as missing. The measured block appears in three independent
> places: the old worker, a locally launched Playwright browser, and a plain
> Browser Use browsing session. All three get the same page. The fields were
> never the problem.
>
> **The chosen fix.** Do not launch a browser locally. Create a real remote
> Chromium through the **Browser Use infrastructure API** (no Browser Use AI
> Agent) and attach to it with `chromium.connectOverCDP(cdpUrl)`:
>
> ```
> POST https://api.browser-use.com/api/v4/browsers
>   X-Browser-Use-API-Key: $BROWSER_USE_API_KEY
> → { id, cdpUrl, liveUrl }
> ```
>
> The endpoint and the header name were verified against the live service: a
> request without a key returns `401` naming the header and the `bu_` key prefix.
>
> **What is already done and committed on `main`.** The publisher module
> (`services/publications-publisher/`), the «Публикации» screen
> (`src/pages/Publications.tsx`), the new `publication_*` tables and the
> `publications-browser-test` workflow. Typecheck, build and the module syntax
> checks all pass. Old publisher: **zero line difference** — verify with
> `git diff --stat HEAD~3 HEAD -- services/mobile-publisher`.
>
> **What is blocked and why.** The key itself is settled: it is registered in
> OpenHands Cloud, it works, and the workflow reads it as a 46-character secret.
> Creating a browser now fails with **HTTP 402** — the Browser Use account holds
> `$0.01` and a session needs at least `$0.01`. **This is a balance problem, not
> a block, not a bad key.** Add credit and the same test runs unchanged.
>
> A sandbox only receives secrets **at startup**, so a conversation whose sandbox
> started before the key was added sees an empty registry
> (`/api/settings/secrets` → `{"secrets":[]}`) and cannot fix that by restarting.
> Confirm the key's existence with
> `curl -H "Authorization: Bearer $OPENHANDS_API_KEY" -H "Accept: application/json" "https://app.all-hands.dev/api/v1/secrets/search"`.
> If the sandbox registry is empty, **start a new conversation**.
>
> **The very next action.** From a sandbox that has the key:
>
> ```bash
> cd services/publications-publisher && npm install
> node src/index.mjs browser-test
> ```
>
> It must print `SUCCESS` (the form and its controls are really present) or
> `browser_blocked` (with the markers and page text that justify it). **Do not
> enable a real publish before it reports `SUCCESS`.** The live view URL is
> printed so the session can be watched by a person.
>
> **Then, in order.** (1) Confirm `SUCCESS`. (2) Apply
> `supabase/migrations/20260917180000_publications_section.sql` — written but not
> applied, and nothing in Supabase has been touched. (3) Add the screen that
> picks a car from the catalogue and fills `payload`; today a queued job is empty
> and only `prepare` is exercised. (4) Only then consider the real publish.
>
> **Do not.** Touch `services/mobile-publisher`, the `mobile_bg_*` tables, the
> existing selectors, the draft logic or any working function. Do not switch
> Supabase. Do not launch a local browser for mobile.bg. Do not put a key in the
> frontend or in this repository.

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

Run the scripts, never a bare `npx tsc --noEmit`. The root `tsconfig.json` is a
solution file whose only content is an empty `files` list, so plain `tsc`
resolves it, checks zero files and exits 0 for any input — including a module
with no imports at all. A green bare-tsc run means nothing. `npm run typecheck`
and the project-wide `tsc -b` inside `build` and `lint` read `tsconfig.app.json`
and do report real errors.

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
way — `claim_mobile_bg_publish_job` mutates state and will claim a real job.## The block is the IP address, and it is provably correctable

Measured, not assumed. Same instant, same URL, same user agent:

```
direct from this sandbox     → HTTP 403, server: cloudflare
through a free public proxy  → HTTP 200, real Mobile.bg page
```

28 of 29 free public HTTP proxies that answered `200` returned the genuine
page; none returned a challenge. Through one proxy, three different URLs came
back as three different real pages (`/` 115 807 bytes, search 170 901 bytes,
the publish URL 20 594 bytes), which rules out a canned or intercepted reply.

**Read the encoding before judging the page.** mobile.bg serves windows-1251
and declares it in the `charset` meta tag. A utf-8 read turns the Bulgarian
into noise, and a real page then looks like a failure. Decode as cp1251.

**What the small publish page actually is.** It is the signed-out shell of the
wizard: the three steps are listed ("1. Въвеждане на описанието на обявата,
2. Добавяне на снимки на обявата, 3. Публикуване") but the HTML carries **zero
`<form>` elements**. There is no password box, no captcha and no Cloudflare.
The form is built only after signing in, so a signed-out probe of this URL can
never contain it. This is the same page the remote Browser Use browser saw.

**What this settles and what it does not.** Settled: the failure is IP
reputation, not the selectors, not the mapping, not our code. Not settled:
whether the real form appears once signed in through a proxy — that needs an
account.

**Never point the free public proxies at the real Mobile.bg account.** They are
run by unknown parties and a request through one can be read by whoever
operates it. They are for reachability diagnosis only. Production needs a paid
provider with a sticky session, because the persistent profile and its
clearance cookie are bound to the IP: rotating IPs invalidate the cookie and
force the challenge again on every run.

## The prepared sheet hands the draft to the broker

«Публикации» now reads an existing draft and shows its fields in the order
Mobile.bg asks for them, with a copy button and a button that opens the form.
Nothing is written, no draft is created, and the old «Обяви» flow is untouched.

The handover is the **clipboard**, not a URL parameter. A browser will not
pre-fill a form on another site, and injecting into it would be blocked, so the
sheet goes over as text the broker pastes into the form they already have open.

Two facts about the schema that cost time to learn:

* `mobile_bg_drafts` has **no `make`, `model` or `model_year` columns**. The
  draft row carries `title` and the metadata; every car attribute lives in
  `mobile_bg_draft_fields` as rows keyed by `field_key`. A query selecting
  `make` from the drafts table fails with `400`.
* `mobile_bg_field_map.ts` marks **15 fields `agent_can_fill: false`** and
  **75 as `needs_human_confirmation: true`**. That is why the sheet labels each
  row «брокер» or «извлечено»: condition, price and the final description are
  decisions, not extractions. The split is deliberate and should stay.

### A real extraction defect this surfaced

Read from the live draft `dbaf94c2` („Audi A3 2017“), 36 field rows, 31 filled:

```
Цвят   (Цвят)              →  "and Upholstery"
```

The colour field holds a fragment of an English AutoTrader sentence rather than
a colour. `Цвят` is a `select` whose options are `['Бял','Черен',...]`, so this
value cannot be chosen in the Mobile.bg form at all. The sheet makes the defect
visible before publication instead of after, which is the point of building it.

## The extension is the path that avoids the challenge entirely

«Екстеншън» builds a small JavaScript assistant from the selected draft and runs
it inside the broker's own signed-in browser. There is no proxy, no remote
browser and no Cloudflare challenge to pass, because the request is the real
person's own session on their own IP.

`src/lib/mobile_bg_options.ts` holds the mapping, taken from
`services/mobile-publisher` (the «Обяви» publisher). That module is the most
complete mapping we have — 22 selectors, the value translations, the extras —
but it has **never completed a live fill**: all eight of its attempts died at
the Cloudflare interstitial, so its own code path never validated a single one
of these values against the real form. The identifiers descend from the agent
script in `docs/mobilebg-direct-publisher.reference.mjs`, which did publish
listings, and the translations are character-identical to the ones that script
used.

So the mapping is **inherited, not proven**. Only the first live fill proves it,
which is exactly what the extension exists to do.

* control names `f5`..`f32`, listed in `MOBILE_BG_SELECTORS`;
* `VALUE_ALIASES`, because Mobile.bg accepts only its own wording — «Бензин»
  must arrive as «Бензинов», «Използван» as «Употребяван», «Април» as «април»;
* `EXTRA_ALIASES` for the equipment checkboxes («ABS» → «Антиблокираща система»);
* `LOCATION_ALIASES` plus `COUNTRY_CANDIDATES`, because Mobile.bg splits the
  origin across two lists: `f18` is the market area and `f19` the country, while
  the draft stores them joined as «Извън страната → Канада».

Three things that are easy to get wrong here:

* **«Заглавие» is not an f-field.** `f1` is not the title, so the generated code
  finds the title input by its visible label instead.
* **`f18` and `f19` depend on earlier choices.** The make list reloads the model
  list, and the area drives the country list, so the generated code waits for
  options to arrive rather than sleeping a fixed time. A fixed sleep loses the
  race and reports "no matching option" while the form sits half-empty.
* **The assistant fills; it does not submit.** The broker checks the values and
  presses «Продължи». Submitting is left to a person on purpose.

Values are emitted into the generated script with `JSON.stringify`, so a quote or
a newline in a description cannot break out of the string and alter the code.

## Two broken deployment paths, not one

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

It published real listings through a Browser Use AI **Agent**, driven by a
person, not by this script. The script is the transcript of that session, which
the operator asked the agent for afterwards. So the identifiers and the
translations in it are observed facts from the live form — that part is solid —
while its control flow was written down after the fact and is a reconstruction.
The script itself has never been run end to end.

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

The point of the second path is the transport, not the steps. The agent-driven
session that published the 500 listings never met the Cloudflare challenge
because it did not launch a browser — it drove an already-running,
already-authenticated Browser Use session over CDP. `src/form.mjs` keeps those
steps and `src/session.mjs` swaps the transport, because the gateway and
Playwright both speak CDP.

The reference script is not a working program: it is one session's transcript,
and running it as-is has never been done. Treat its steps as evidence about the
form, not as a library to execute.

`browser-test` is a gate, not a formality: it reports whether the form and its
fields are really present, and it currently answers no.

## The Browser Use agent inside «Публикации»

«Публикации» has two Browser Use things, and they are not the same thing:

* **The visible browser** (`browser_use.mjs`) is infrastructure. We create a
  remote Chromium and drive it ourselves over CDP. It is what the
  «Влез в Mobile.bg» button opens, and what the manual broker uses.
* **The agent** (`browser_agent.mjs`) is the AI. We hand it a task in words and
  read back a result. It is what the «Browser Use агент» panel at the bottom of
  the page talks to. Both share `BROWSER_USE_API_KEY` and neither ever returns
  that key to a caller.

The path is: site → `PublicationAgentPanel` → protected VPS bridge → Browser Use
v4 `/runs`. The site never speaks to Browser Use directly, so the key stays in
`/etc/aicc-publications.env` on the VPS.

Three endpoints, all `POST`, all behind the same signed Admin ticket the visible
browser uses (nginx `auth_request` against `publication-browser-access/validate`):

```
/publications-browser/agent          { task }                    → { run_id, session_id, status }
/publications-browser/agent/status   { run_id }                  → { status, terminal, result, error }
/publications-browser/agent/message  { session_id, text }        → { queued }
```

The `ticket` query parameter is issued by the Edge Function, exactly as for
`/publications-browser/open`. The bridge binds them to exact-match locations
placed *before* the `/publications-browser/` static catch-all, so no other path
reaches port 6081.

Decisions that are deliberate and should stay:

* **A task is validated before it is sent.** Empty, whitespace-only or longer
  than 4000 characters is rejected with `400` *without touching the network*, so
  a bad request cannot start a run that bills. The test asserts the stub API saw
  zero requests.
* **Runs are asynchronous.** `POST /runs` returns a run id immediately and the
  panel polls `/agent/status` every 3 s. A terminal status stops the polling, so
  a timeout can never silently start a second run and a finished run is not
  re-read for ever.
* **`result` and `error` are hidden until the status is terminal.** A run that
  is still going reports `null` for both rather than stale text from the last
  poll.
* **Continuing a conversation uses the session, not the run.** `POST
  /sessions/{id}/queue` is what carries context forward. Its reply names the run
  the message creates, but that field can be null while the run is still being
  set up, so the bridge falls back to reading the session and waiting until
  `latestRunId` differs from the run the caller came from.
* **402 is called out as missing credit.** It is not a wrong key and not a
  block, and at a distance the three look identical.

### The follow-up bug a real run exposed

A stub cannot catch this. Polling the *previous* run id after a follow-up
returns that run's result instantly — `completed` in 0 seconds — which looks
exactly like a working follow-up and is actually the old answer being read back.
It shipped, and only the live check saw it: step two answered in 0 s with step
one's text.

Three things were wrong at once, and all three are fixed:

* `queueMessage` discarded the `runId` from the reply and returned the whole
  body, so callers had nothing correct to poll.
* The bridge answered `{ queued: true }` with no run id, so the panel kept
  polling the old one.
* The panel reused `run.runId` for the follow-up.

Now the reply carries `run_id` and `started`, and `waitForNewRun` is the one
place that decides whether a new run really exists. A follow-up that does not
start is reported as such instead of showing the previous answer.

`test/browser_agent.test.mjs` and `test/browser_agent_http.test.mjs` pin this
down, including a session that never moves on. `src/agent-live.mjs` fails a
follow-up that returns in under a second, because that is the stale-read
symptom and matching text alone would let it pass.

`test/agent_live.test.mjs` runs that probe as its own process against a stub, so
every line of it executes in CI. It exists because the probe was the only part
with no test, and a missing import reached a paid live run as a result. When a
script talks to a real service, `BROWSER_USE_API_BASE` is the seam that lets it
be run for real in a test.

* **402 is called out as missing credit.** It is not a wrong key and not a
  block, and at a distance the three look identical.
* **Credentials for a task that needs the signed-in Mobile.bg session come from
  the browser profile**, not from the prompt. Passwords are never put into a
  task. The profile is a *name* (`BROWSER_USE_PROFILE`, default
  `mobilebg-publisher`); `BROWSER_PROFILE_ID` is an optional shortcut.
* **The agent always runs inside that profile.** `startRun` resolves it through
  the same `resolveProfile` the visible browser uses, so the two cannot disagree
  about where the session lives. An unset `BROWSER_PROFILE_ID` means "find it by
  name", never "start with no profile" — a run without a profile opens a browser
  with no cookies, lands on Mobile.bg signed out and cannot find the form, which
  makes the task useless. `startRun(task, { useProfile: false })` asks for a
  genuinely clean browser and is the only way to get one.
* **A stored cookie is not a live session.** `GET /publications-browser/profile`
  reports which profile the agent will use and whether a `mobile.bg` cookie is in
  it. Mobile.bg expires sessions, and an expired cookie still shows up there, so
  `mobile_cookies: true` does not mean logged in. `POST
  /publications-browser/profile/verify` opens a browser on the publish page and
  checks for the form; that is the honest answer. Both sit behind the signed
  Admin ticket, and `npm run profile-check` in
  `services/publications-publisher` plus the `Publications profile check`
  workflow read the same thing from CI without opening anything.
* **A signed-out task and a wrong-profile task look identical from the outside**
  — both end with "no form". The bridge logs the profile id each run used so the
  two can be told apart.

Tests (no secrets, no network — they start their own stub API):

```bash
cd services/publications-publisher && npm run test:agent
```

`test/browser_agent.test.mjs` covers the module; `test/browser_agent_http.test.mjs`
starts the bridge as a child process and speaks to it over loopback HTTP.

## The gateway call shape is the one unknown left

The proven script shows exactly one gateway call — `browser/upload` with a
`FormData` body and a bearer token. How it drives the DevTools protocol is not
shown. `services/publications-publisher/src/session.mjs` therefore treats both
paths as configuration (`BROWSER_CDP_PATH`, `BROWSER_UPLOAD_PATH`) instead of
hardcoding a guess, and `send()` is the single place to change once the real
relay is known. If the gateway does not relay arbitrary CDP methods, that one
function is rewritten; `form.mjs` stays as it is.