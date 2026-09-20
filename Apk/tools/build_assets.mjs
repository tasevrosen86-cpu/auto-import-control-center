#!/usr/bin/env node
// Builds the JavaScript the WebView injects into a Mobile.bg page.
//
// Two things are assembled here and nothing else:
//   plan.js     — the proven draft-to-Mobile.bg mapping, bundled from
//                 src/lib/mobile_bg_options.ts so the phone and the web app
//                 share one definition of the field names and option wording.
//   combined.js — plan.js, plus the proven fill routine copied verbatim from
//                 src/lib/mobile_bg_fill.js, plus one line that exposes that
//                 routine on the window.
//
// Neither file is rewritten. The mapping is imported and the fill routine is
// copied byte for byte, the export line being added by the build rather than by
// editing the source. That is the point: the automation that is already known
// to work is carried to the phone, not reimplemented for it.

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const assets = resolve(root, 'Apk', 'app', 'src', 'main', 'assets');

await mkdir(assets, { recursive: true });

await build({
  entryPoints: [resolve(here, 'plan_entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2018',
  outfile: resolve(assets, 'plan.js'),
  logLevel: 'warning',
});

// Kept as its own file as well, so the same routine can still be pasted into a
// browser console or shipped as a userscript without the Android wrapper.
const fill = await readFile(resolve(root, 'src', 'lib', 'mobile_bg_fill.js'), 'utf8');
await writeFile(resolve(assets, 'fill.js'), fill, 'utf8');

// plan.js already publishes window.AICC. The fill routine is copied verbatim, so
// the line that puts it on the window is appended here instead of editing the
// source file, which keeps that file byte-identical to the one the web app uses.
const combined = [
  await readFile(resolve(assets, 'plan.js'), 'utf8'),
  fill,
  'window.fillMobileBgForm = fillMobileBgForm;',
  'window.__AICC_READY__ = true;',
  '',
].join('\n');

await writeFile(resolve(assets, 'combined.js'), combined, 'utf8');

console.log('Готово: assets/plan.js, assets/fill.js, assets/combined.js');
