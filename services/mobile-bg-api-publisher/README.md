# Mobile.bg official API publisher («Обяви»)

Publishes a draft from the **«Обяви»** section through the official Mobile.bg
import API. It is the counterpart of `services/mobile-publisher`, which fills the
Mobile.bg form in a browser and belongs to **«Публикации»**. The two are separate
processes, separate environment files and separate systemd units.

API documentation: <https://api.mobile.bg/import_doc/>

## Why it is a separate worker

Both paths are queues over one table, `mobile_bg_publish_jobs`. The `transport`
column keeps them apart:

| Section | `transport` | Worker |
|---|---|---|
| «Обяви» | `OFFICIAL_API` | this service |
| «Публикации» | `BROWSER_ON_DEMAND` | `services/mobile-publisher` |

Each worker filters on its own value. Without that filter they would claim each
other's jobs and either drive a browser at an API job or post an API payload for
a browser job.

## The run

```
login      POST /import_api/login            token, valid 3 minutes
catfields  GET  /import_api/catfields/..     what this category accepts
advertpub  POST /import_api/advertpub/<tok>/ the listing
advertpicts POST /import_api/advertpicts/<tok>/ pictures, needs the listing id
advertload GET  /import_api/advertload/<tok>/ read it back to prove it exists
logout     POST /import_api/logout/<tok>/    drop the token
```

Every call is recorded with its step, endpoint, HTTP status, Mobile.bg's own
`status` field and a redacted response excerpt. The trace is stored in
`mobile_bg_publish_jobs.api_trace` and shown in the **Диагностика** panel in
«Обяви». Tokens and passwords are redacted before anything is written.

## Pictures are fetched, not uploaded

`advertpicts` takes file **paths**, and Mobile.bg downloads them from the domain
registered against the account. So:

* a full external URL never works — only a path under the registered domain;
* the file must be `.jpg` or `.jpeg`, so `.webp` and `.png` sources are
  re-encoded (via `sharp`);
* one request carries up to 17 paths separated by `~`.

Selected pictures are downloaded into `MOBILE_BG_API_PICTURE_ROOT` (default
`/var/www/html`) under `mobilebg-pictures/<draft id>/`, and the path sent is the
part below `MOBILE_BG_API_PICTURE_BASE_URL`. Each file is checked to be publicly
readable before its path is sent.

## Retrying after a failure

A failure never loses the draft. The listing is published before the pictures, so
a picture failure leaves a real, possibly paid, listing behind. The listing id is
therefore written to `mobile_bg_publish_jobs.listing_id` as soon as it is known,
and a retry **corrects that same listing** instead of publishing a second one.

The id the pictures are attached to is always the one `advertpub` returned in the
current run. A stored id is only a hint about which listing to correct, and it is
trusted only after `advertload` reads that listing back: an id Mobile.bg no
longer recognises would otherwise be passed to `advertpicts` and refused with
`Wrong ida`. When Mobile.bg does not know the stored id, the id is cleared and
the run stops rather than guessing another one — guessing would risk a duplicate
listing.

## Never call these automatically

`advertviptop` bills the account the moment it is called ("Промяната на статуса
се таксува веднага"). It is not implemented and must not be added to a run.

## Configuration

Written by `.github/workflows/deploy-vps.yml` to `/etc/aicc-mobile-bg-api.env`
(`chmod 600`), never into the repository.

| Variable | Purpose |
|---|---|
| `MOBILE_BG_API_USERNAME` / `_PASSWORD` | Mobile.bg account |
| `MOBILE_BG_API_BASE_URL` | default `https://api.mobile.bg` |
| `MOBILE_BG_API_PICTURE_ROOT` | default `/var/www/html` |
| `MOBILE_BG_API_PICTURE_BASE_URL` | the domain registered with Mobile.bg |
| `MOBILE_BG_API_EXTRI_SEPARATOR` | default `~` |
| `MOBILE_BG_API_TERM` | default `35` |

## Tests

```bash
npm test
```

No network is used: the client takes its `fetch` by injection. The tests cover
the token and password never reaching the trace, HTTP 403 being reported as a
block rather than a bad credential, `status:"error"` at HTTP 200 being caught,
the field translation, the catfields intersection, the readiness blockers, and
the picture rules.

## First real run

1. Apply `supabase/migrations/20260923120000_api_publish_transport.sql`.
2. Deploy, then confirm the credentials are present:
   `sudo systemctl show aicc-mobile-bg-api-publisher -p EnvironmentFiles`.
3. In «Обяви», open a draft and press **„Публикувай през Mobile.bg API“**.
4. The **Диагностика** panel opens and follows the run.

To see whether the account may use the API at all, without publishing anything,
watch the `LOGIN` and `FIELDS` steps in the panel: both run before anything is
created. Note that a queued job always runs the full publish — the `mode` column
is not honoured by this worker yet, so there is no dry-run that stops before
`advertpub`.
