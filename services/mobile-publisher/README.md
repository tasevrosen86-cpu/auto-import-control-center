# Mobile.bg publisher — browser only on demand

The web site sends JSON into Supabase immediately.  This worker is started for
one queued `mobile_bg_publish_jobs` row, opens the saved Mobile.bg profile,
handles that job and exits.  It does **not** keep a browser running.

## One-time setup

1. Deploy this folder to a host that supports Node.js, Playwright/Chromium and a persistent writable disk.
2. Set server-only secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOBILE_BG_USER_DATA_DIR`, `MOBILE_BG_USERNAME`, `MOBILE_BG_PASSWORD` and `MOBILE_BG_HEADLESS=false`.
3. Run `npm install && npx playwright install chromium`.
4. Run the worker once. It logs in automatically from the server secrets and saves the browser session in `MOBILE_BG_USER_DATA_DIR`.
5. Make one preview listing to record the real selectors. If Mobile.bg uses different login controls, add `MOBILE_BG_LOGIN_USERNAME_SELECTOR`, `MOBILE_BG_LOGIN_PASSWORD_SELECTOR` and `MOBILE_BG_LOGIN_SUBMIT_SELECTOR` as server secrets. Do not enable `LIVE` before that test succeeds.

There is intentionally no Mobile.bg password or cookie in this repository,
Supabase, or the browser-visible web application. The password exists only in
the server secret store; the persistent browser profile keeps the login session.

## Hosting requirement

Static/shared hosting is enough for the React web site only.  The publisher can
live on the same host only if it supports a persistent Node process or scheduled
job, Playwright/Chromium and a non-ephemeral disk.  Otherwise use a small VPS
for this folder; it is not a second web site and it does not need a second domain.
