# AICC Mobile — APK

The phone app. It opens Mobile.bg's own publish form in a WebView and fills it
while the operator watches. This directory is the whole app: source, build
scripts, Gradle wrapper and the workflow that produces the APK.

## Why the app exists

Mobile.bg sits behind Cloudflare. Every request from the build machine, from
CI, and from a real browser on the server gets an HTTP 403 interstitial with
zero form controls. The phone is a network Mobile.bg accepts, so the app is the
transport rather than another attempt at the same wall.

The app does not defeat a bot check and does not run headless. It does not
submit: pressing «ПРОДЪЛЖИ» is left to the operator, because the listing carries
their phone number and their Mobile.bg reputation.

## What it does

* Signs in to Supabase and lists drafts.
* Opens Mobile.bg's publish form in the WebView.
* Injects the mapping and the fill routine, then fills the form and stops.
* Stages the draft's photos so the WebView's file chooser can upload them.
* Records the published URL back onto the draft.
* Imports a source listing from a link (separate path, see below).

The main menu action is **«Извлечи от линка»**. That is the URL importer and it
is *not* the Mobile.bg path: it posts the link to `queue-source-intake`, the
server opens the listing with a real browser, and the result becomes the same
normalised draft the catalog path produces. The two paths meet in one draft
shape; neither reopens a listing inside the app.

## Where the field mapping lives

The mapping is **not** in this directory. It is imported from the web app, on
purpose:

| Source | Used for |
|---|---|
| `src/lib/mobile_bg_options.ts` | the draft-to-Mobile.bg mapping (`buildMobileBgPlan`) |
| `src/lib/mobile_bg_fill.js` | the fill routine, copied verbatim |

`tools/build_assets.mjs` bundles the first with esbuild and copies the second
byte for byte, so changing the mapping changes both the website and the app and
they cannot drift apart. The `export` line that puts the fill routine on
`window` is appended by the build, not added to the source, which keeps that
file identical to the one the web app ships.

Those two files stay in `src/lib/` because the web app uses them too
(`Extension.tsx`, `extension_build.ts`). Moving them here would fork the very
mapping the app exists to share.

## Build

Needs Node, JDK 21, and an Android SDK with `platforms;android-35` and
`build-tools;35.0.0`.

```bash
npm install
npm run apk:assets                       # regenerates assets/ from src/lib/
python3 Apk/tools/make_icons.py          # regenerates the launcher icons
cd Apk && ./gradlew :app:assembleRelease
```

The APK lands in `Apk/app/build/outputs/apk/release/app-release.apk`.

`local.properties` points Gradle at the SDK (`sdk.dir=/opt/android-sdk`). It is
gitignored and machine-specific.

Or run the `build-apk` workflow, which does the same and attaches the APK as an
artifact, so it can be installed straight from the phone without a cable.

Gradle wrapper 8.10.2 and Android Gradle Plugin 8.7.3 are pinned to the same
pair CI uses, so a local build and a CI build produce the same APK.

## Generated, never committed

`app/src/main/assets/plan.js`, `fill.js`, `combined.js`, the launcher icons,
`app/build/`, `.gradle/` and `local.properties` are all produced by the build
and are gitignored.

## Signing

Signed with the debug key on purpose. This is an internal tool for one account,
installed by hand, so a private upload key would only add a way to lose access
to the app.

## Permissions

Internet, network state, and reading a picked image. Nothing else: no account
credentials are stored, no automation service is contacted, and there is no
background access. `usesCleartextTraffic` stays off.

## Toolchain

JDK 21 (`openjdk-21-jdk-headless`) and Android command-line tools with
`platform-tools`, `platforms;android-35` and `build-tools;35.0.0` under
`/opt/android-sdk` are what the build was verified against, matching CI.