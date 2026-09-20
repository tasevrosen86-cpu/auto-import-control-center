# Publications section — separate from the «Обяви» publisher.

A second, independent publishing path for Mobile.bg, built on the proven
Browser Use → Mobile.bg flow. The old section is left exactly as it was so it
can be returned to at any time: nothing here imports, edits or replaces
`services/mobile-publisher`, and nothing reads or writes the `mobile_bg_*`
tables.

The rules in this module come from two documents:

* `browser-use-mobilebg-technical-report.html` — the evidence report. It records
  what actually ran: the field names, the translations, the waits, the upload
  path, the Continue action and the public verification.
* `browser-use-mobilebg-integration-spec.html` — the production specification.
  It records what the section must enforce: preflight rules, the state machine,
  the single-publish lock, the profile reuse and the security boundary.

Where those documents mark something `UNKNOWN / NOT VERIFIED`, this module
leaves it out rather than filling the gap with a guess.

## Why a second path exists

The old publisher is blocked before it reaches the form. Mobile.bg sits behind
Cloudflare and answers this container with a `403` — `cf-ray` present, title
that looks like the real site, and **zero** form controls. The fields were never
the problem.

The session that published the listings never met that challenge, and the reason
is architectural: it did not launch a browser here. It drove an already-running,
already-authenticated Browser Use session over the DevTools protocol.

So this module keeps the step logic from that session and changes only the
transport. Note what that does and does not buy: the report is evidence about
the form, and the flow is described as never having been executed end to end as
a script. `browser-test` is the gate that settles it.

## Layout

```
services/publications-publisher/
  src/browser_use.mjs  Browser Use infrastructure API: create and stop a browser
  src/session.mjs      the transports behind one { send(method, params) } interface
  src/form.mjs         the form steps, taken from the evidence report
  src/mappings.mjs     the translation tables and aliases from the report
  src/preflight.mjs    the admission rules from section 4 of the specification
  src/index.mjs        worker and CLI, touches publication_* only
  test/form-steps.test.mjs  exercises the steps against the stub form
  aicc-publications.service / .timer
```

`form.mjs` is transport-agnostic on purpose: the remoting and Playwright both
speak CDP, so the same steps run over either. That is what makes the recorded
logic reusable instead of rewritten.

## Transport

`openSession()` prefers, in order: `BROWSER_USE_API_KEY` → the older gateway
(`V4_*`) → local Playwright.

The remote browser is created through the infrastructure API only. No Browser Use
AI Agent is involved: we ask for a browser and drive it with our own step logic.

```
POST /api/v4/browsers   { profileId }
  X-Browser-Use-API-Key: $BROWSER_USE_API_KEY
→ { id, cdpUrl, liveUrl, status }
PATCH /api/v4/browsers/{id}   { action: "stop" }
```

All four facts below were measured against the live service, not read from docs:

* The key goes in `X-Browser-Use-API-Key`. A request without it returns `401`.
* The create response is flat, with `id`, `cdpUrl`, `liveUrl` and `status`.
* Stopping is `PATCH` with `{"action":"stop"}` — it answers `200` and reports
  `status: "stopped"`. `DELETE` answers `405` and `POST /stop` answers `404`.
  Getting this wrong leaves a browser billing, so `stopBrowser` is asserted
  against the service rather than assumed.
* The browser request takes a **`profileId`**, not a profile name. A name is
  accepted and silently ignored, which is exactly the trap this code fell into
  once: the browser came back signed out and the gate looked like a field
  problem.

The local fallback is **not** a way past the challenge: that was measured, not
assumed. Run from this container it gets the same block page.

## The Mobile.bg profile

The report is explicit that the proven flow contained no login automation at
all — no username, no password, no OTP. The specification forbids adding one,
because the credential would then reach the worker and the job payload.

So no Mobile.bg password is stored anywhere and the worker never signs in:

```
npm run onboard        # once, by a person
```

That creates a browser attached to the `BROWSER_USE_PROFILE` profile, prints the
live-view URL, and waits while the person signs in. The browser is then stopped
cleanly, which writes the profile.

Persistence was **demonstrated, not assumed**: a cookie written in one browser on
the profile was read back in a second browser after the first was stopped. An
earlier probe reported the opposite because it stopped the browser immediately
after writing the cookie; the profile is flushed when a session ends, so that
test was measuring its own timing. The working probe is in
`test/probe-profile.mjs` and keeps the settle and stop waits.

The profile is resolved by name through `/api/v4/profiles`, and created on first
use. Later jobs attach to the same profile and find the session already there.
If a run meets a signed-out page it reports `session_required` and stops, rather
than guessing at credentials.

## What the live page actually looks like

Measured with `test/probe-frames.mjs` and `test/probe-page.mjs`, from the remote
browser, signed out:

* **There is no Cloudflare block** on the remote browser. The page loads with its
  real title. The old 403 was a property of this container, not of Mobile.bg.
* The three frames on the page are `__tcfapiLocator`, `googlefcPresent` and the
  Gemius ad tracker. The form is **not** hidden in a frame.
* A signed-out browser gets **no form at all and no password box**. It gets the
  public page, whose text begins `Вход | Нова Регистрация`. The publish URL
  simply does not serve the form to a signed-out session.

That last point is why `ensureLoggedIn` no longer looks for a password box. It
first started by looking for one, which reported `already_logged_in` on a page
that was plainly signed out and made the gate blame the fields for a session
problem. It now treats the form's own `f5` as the proof of a usable session, and
falls back to the page's sign-in markers.

## Admission rules

`preflight.mjs` re-checks the job in the backend rather than trusting anything
the frontend sent. A job that fails never reaches a browser:

| Check | Admission | On failure |
| --- | --- | --- |
| Source | a valid AutoTrader.ca URL | `blocked_source` |
| Green price | report cell `final-cell canada-cheaper` | `blocked_not_green` |
| Limit | approved price ≤ 80 000 EUR | `blocked_price_limit` |
| Price | an approved EUR price, not recalculated here | `blocked_price_missing` |
| Data | year, mileage, body, fuel, transmission, color confirmed | `blocked_missing_data` |
| Photos | at least one source image; aim ≤ 17 | `blocked_photos` |
| Duplicate | no active listing for the same master row | `duplicate_skipped` |

Encar is not a publishing source, and an AutoTrader URL is never sent to the
Mobile.bg file input.

The exact `f6` option is decided in the browser, against the options the form
really offers. A value with no match stops the row there with `option_missing`
and the list the page returned — never a close match.

## Keeping the steps honest

Taken from the report because these were read off the live site rather than
assumed:

* The field access is `document.forms.namedItem("pub").elements[name]` — the
  named form, not CSS classes, XPath, placeholder or label text.
* Values are set with the native prototype setter plus `input`/`change` events.
  Playwright's `select_option` was not used and is not used here.
* Dependent lists are waited for (model after make, country after location),
  bounded at 40 × 250 ms, instead of a fixed sleep.
* Step one is submitted through `actions=2` and a native form submit, rather
  than hunting for a «Продължи» control.
* The final action is the exact text `ПРОДЪЛЖИ`; success is confirmed with the
  exact text `Преглед на обявата`.
* Photos: `li.hasPhoto .photo[style*="background-image"]`, with the quotes. A
  run does not press continue while the attached count is under the expected
  count, and `published_no_photos` is not shown as a normal publication.
* The clever part is the public check: the finished listing is opened and the
  **really loaded** photos are counted (`naturalWidth > 0`), so a broken
  carousel is not reported as published. Active status, price line and phone
  flag are recorded with it.

The month stays `януари`, the proven value. The report records the current
publishing rule as a separate decision, so a job may override it and the default
does not pretend to be that rule.

The description keeps an empty value empty, because the report records the
Hyundai batch passing `description: ""` on purpose. Only a missing value falls
back to the placeholder text. No company template is recorded anywhere, so none
is invented here.

## Step one is a deliberate gate

```
node src/index.mjs browser-test
```

Creates a remote browser, opens the form and reports whether
`document.forms.namedItem("pub")` really exists with its fields:

* `SUCCESS` — the form and its controls are there, and `f5` is among them.
* `browser_blocked` — anything else. The reason names the block markers found
  (`just a moment`, `cf-challenge`, `cloudflare`, …) and shows the page text, so
  a block is never misread as a field-mapping problem.

A real page with no form is reported as exactly that, because it is a different
problem from a block page. The verdict, the live view URL and the browser id are
printed, and the same result is written to `publication_logs`.

## Tests

```
npm test
```

`test/form-steps.test.mjs` serves the existing stub form from
`services/mobile-publisher/test/` and asserts the values the form itself
received, by reading the POST body the stub sent. That means the assertions are
the form's view of the fill, not our own bookkeeping. It covers the alias table
(`RAV 4 → Rav4`), every translation, the dependent-list waits, the fill order
that keeps `f19` loaded, the empty-vs-missing description behaviour and the
empty `f9`.

The stub has no step 2, so the run stops at the photo step. That is expected:
the test covers validation and filling, and the photo and public-verification
steps need the real form and a real remote browser.

## Credentials

Server-side environment only, via `/etc/aicc-publications.env` (mode 600). The
anon key is sufficient — `publication_*` is granted and policied for it. Nothing
here is imported by the frontend, so no key can reach the bundle. The real
publish button additionally requires `VITE_PUBLICATIONS_REAL_PUBLISH=true`,
which is a build-time flag and not a secret.

## Not done yet

* Install the unit on the server and create `/etc/aicc-publications.env`.
* Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `BROWSER_USE_API_KEY`.
* Apply the migrations, including
  `20260920120000_publication_events_and_lock.sql`.
* Establish the Mobile.bg session in the remote browser once, by hand.
* Run `browser-test` from the machine that will publish. Do not enable the real
  publish until it reports `SUCCESS`.
* A screen to pick the car from the catalogue and fill `payload` with the real
  fields; today a job is queued and `prepare` is what is exercised.