# Publications section — separate from the «Обяви» publisher.

A second, independent publishing path for Mobile.bg. The old section is left
exactly as it was so it can be returned to at any time: nothing here imports,
edits or replaces `services/mobile-publisher`, and nothing reads or writes the
`mobile_bg_*` tables.

## Why a second path exists

The old publisher is blocked before it reaches the form. Mobile.bg sits behind
Cloudflare and answers the worker with a `403` interstitial — `server: cloudflare`,
title `Just a moment...`, and **zero** form controls. That is why every
`NEEDS_CONFIGURATION` row lists all twenty fields as missing and why the stored
`live.frame` is a blank white screen. The fields were never the problem.

The proven `mobilebg-direct-publisher` never met that challenge, and the reason
is architectural rather than lucky: it does not launch a browser. It receives an
already-running, already-authenticated Browser Use session over the DevTools
protocol. A real browser, already signed in, from an address Cloudflare does not
pre-flag, gets the form.

So this module keeps the proven step logic and changes only the transport.

## Layout

```
services/publications-publisher/
  src/session.mjs    two transports behind one { send(method, params) } interface
  src/form.mjs       the form steps, taken from the proven script
  src/index.mjs      worker and CLI, touches publication_* only
  aicc-publications.service / .timer
```

`form.mjs` is transport-agnostic on purpose: the gateway and Playwright both
speak CDP, so the same steps run over either. That is what makes the proven
logic reusable instead of rewritten.

## Transport

`browserUseConfigured()` gates on `V4_GATEWAY_URL`, `V4_RUN_ID`, `V4_RUN_TOKEN`.
When they are present the gateway is used; otherwise the code falls back to a
local Playwright browser so the steps can still be exercised.

**The gateway CDP path is an assumption.** The proven script only shows the
`browser/upload` call; the call shape for driving methods is not published, so
`BROWSER_CDP_PATH` is configuration rather than a guess baked into the code.
Confirm it against the running Browser Use service once the variables are
available. If the gateway does not expose a per-method relay, `send()` needs
rewriting against its real API — a transport change, with the steps untouched.

The local fallback is **not** a way past the challenge: that was measured, not
assumed. Run from this container it gets the same block page, with
`form_found: false`, `control_count: 0`.

## Step one is a deliberate gate

`node src/index.mjs browser-test` opens the form and reports what actually
loaded: whether `document.forms.namedItem("pub")` exists, how many controls it
has, whether `f5` is among them, and the visible text when it is not. Success
requires the form and its fields. Do not enable the real publish until this
reports `form_found: true` from the machine that will run it.

The «Публикации» screen can also queue this as a job and show the same answer.

## Keeping the steps honest

Kept from the proven script, because these are the parts that were taken from
the live site rather than assumed:

* `f11` body type and `f22` phone — absent from the old field map entirely.
* Submitting step one through `actions=2` instead of hunting for a «Продължи»
  control, which the old `advanceFromDataStage` did and gave up when it failed.
* Confirming with the exact text `Преглед на обявата`.
* Opening the finished public listing and counting **really loaded** photos
  (`naturalWidth > 0`), so a broken carousel is not reported as published.

The interrupted escaping in the reconstructed copy is restored here: the photo
selector is `li.hasPhoto .photo[style*="background-image"]`. Without the quotes
it matches nothing, the wait loop counts zero and every run fails at `0/N photos
attached`.

`f14` (month) is **not** copied from the proven script — it hardcodes `януари`
and our requirement is April.

## Tables

New tables only: `publication_jobs`, `publication_results`, `publication_logs`,
plus `claim_publication_job()`. The migration creates grants **and** policies
together, because the initial schema created 80 policies with zero grants and a
policy cannot grant a privilege that was never given.

A failed job is never returned to `QUEUED`, so a blocked run cannot become a
retry loop hammering a Cloudflare challenge.

## Credentials

Server-side environment only, via `/etc/aicc-publications.env` (mode 600). The
anon key is sufficient — `publication_*` is granted and policied for it. Nothing
here is imported by the frontend, so no key can reach the bundle. The real
publish button additionally requires `VITE_PUBLICATIONS_REAL_PUBLISH=true`,
which is a build-time flag and not a secret.

## Not done yet

* Install the unit on the server and create `/etc/aicc-publications.env`.
* Confirm the gateway CDP path, or rewrite `send()` against its real API.
* A page to pick the car from the catalogue and fill `payload` with the real
  fields; today a job is queued empty and `prepare` is what is exercised.
* Apply the migration.