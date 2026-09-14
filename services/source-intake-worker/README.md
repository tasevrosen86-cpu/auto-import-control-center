# Source intake worker

This worker is the **manual URL** path only. It is shared by the URL form in **Обяви** and in **Broker Access**.

Flow:

1. The web app queues a validated Encar or AutoTrader Canada URL.
2. The worker opens that listing with Playwright.
3. It reads JSON embedded in the listing page (JSON-LD / Next.js JSON), maps known vehicle fields, extras and images, and stores the original JSON for traceability.
4. The draft is marked ready for review when all required fields are present.
5. The separate Mobile.bg publisher may then populate the Mobile.bg form in preview mode only; it never submits the final ad.

## Server setup

Create a protected server-only environment file for this worker. It must contain:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional: `SOURCE_INGEST_URL`
- optional: `SOURCE_INTAKE_HEADLESS=true`
- optional: `WORKER_NAME=source-intake-vps`

Install once from this directory:

```sh
npm install
npx playwright install chromium
sudo npx playwright install-deps chromium
```

Run one queued import manually:

```sh
npm run run-once
```

The worker claims one `QUEUED` job. On failure it records the error against that job and its draft; it does not publish anything.
