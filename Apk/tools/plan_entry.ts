// Entry point for the Android asset build.
//
// The mapping from a draft to Mobile.bg's own control names and option wording
// lives in exactly one place: src/lib/mobile_bg_options.ts. This file does not
// restate any of it. It only exposes that one module to the WebView, so the
// phone and the web app cannot drift apart: changing the mapping changes both.
//
// esbuild erases the `import type` line in the module, so the bundle ends up
// with no runtime dependencies and can be injected into any page.
import { buildMobileBgPlan } from '../../src/lib/mobile_bg_options';

type Global = typeof globalThis & { AICC?: Record<string, unknown> };

(globalThis as Global).AICC = {
  buildPlan: (fields: unknown, extras: unknown) =>
    buildMobileBgPlan(
      (fields ?? []) as Parameters<typeof buildMobileBgPlan>[0],
      (extras ?? []) as Parameters<typeof buildMobileBgPlan>[1],
    ),
};
