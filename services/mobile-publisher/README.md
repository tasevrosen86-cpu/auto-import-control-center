# Mobile.bg publisher — browser only on demand

The web site sends JSON into Supabase immediately.  This worker is started for
one queued `mobile_bg_publish_jobs` row, opens the saved Mobile.bg profile,
handles that job and exits.  It does **not** keep a browser running.

## One-time setup

1. Deploy this folder to a host that supports Node.js, Playwright/Chromium and a persistent writable disk.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOBILE_BG_USER_DATA_DIR` and `MOBILE_BG_HEADLESS=false`.
3. Run `npm install && npx playwright install chromium`.
4. Run the worker once, log in to Mobile.bg in the opened browser and close it.
5. Make one preview listing to record the real selectors.  Do not enable `LIVE` before that test succeeds.

There is intentionally no Mobile.bg password or cookie in this repository,
Supabase, or the browser-visible web application.

## Hosting requirement

Static/shared hosting is enough for the React web site only.  The publisher can
live on the same host only if it supports a persistent Node process or scheduled
job, Playwright/Chromium and a non-ephemeral disk.  Otherwise use a small VPS
for this folder; it is not a second web site and it does not need a second domain.
