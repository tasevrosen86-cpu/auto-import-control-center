// Builds a real Chrome extension (Manifest V3) from one draft, in the browser.
// The zip is produced here rather than in a build step so a generator change
// ships with the page and never drifts from the fill routine it wraps.
import { strToU8, zipSync } from 'fflate';
// The fill routine is imported as raw text and embedded verbatim. It is plain
// JavaScript that must never be transpiled or wrapped, because it runs in a
// page we do not control — see the note at the top of that file.
import fillSource from '@/lib/mobile_bg_fill.js?raw';

export type FillStep = {
  selector: string;
  value: string;
  kind: 'select' | 'input' | 'textarea';
  label: string;
};

export type DraftPayload = {
  title: string;
  steps: FillStep[];
  extras: string[];
};

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'AICC — Mobile.bg помощник',
  version: '1.0',
  description: 'Попълва формата за нова обява в Mobile.bg с данните от подготвената чернова.',
  // Only these two hosts: the form being filled, and nothing else.
  host_permissions: ['https://www.mobile.bg/*', 'https://mobile.bg/*'],
  permissions: ['scripting', 'activeTab'],
  action: { default_title: 'Попълни от AICC' },
  background: { service_worker: 'background.js' },
}, null, 2);

const BACKGROUND = `// The toolbar button is the only trigger. Nothing runs until the user presses
// it while standing on the Mobile.bg form, so the assistant cannot fire on any
// other page or at any other time.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.indexOf('mobile.bg') === -1) return;
  try {
    // Injected as a file rather than a function body: an extension file runs in
    // the page's isolated world without tripping the page's script policy.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill-run.js'] });
  } catch (error) {
    console.error('AICC: попълването не стартира', error);
  }
});
`;

const README = `AICC — Mobile.bg помощник
=========================

1. Отвори chrome://extensions
2. Включи «Режим за разработчици» (горе вдясно)
3. Натисни «Зареди неопаковано» и избери тази папка
4. Отвори формата за нова обява в Mobile.bg и влез в профила си
5. Натисни иконата на помощника в лентата

Помощникът попълва полетата и показва какво е успял и какво е пропуснал.
Той НЕ изпраща обявата. Прегледай стойностите и натисни «Продължи» сам.

Данните са само за избраната чернова и не излизат никъде другаде.
`;

// fill-run.js is fill.js plus the payload and the call, so the injected file is
// self-contained and shares no globals across the extension/page boundary.
export function buildExtensionZip(draft: DraftPayload): Uint8Array {
  const fillRun = `${fillSource}

fillMobileBgForm(${JSON.stringify(draft.steps)}, ${JSON.stringify(draft.extras)});
`;

  return zipSync({
    'manifest.json': strToU8(MANIFEST),
    'background.js': strToU8(BACKGROUND),
    'fill.js': strToU8(fillSource),
    'fill-run.js': strToU8(fillRun),
    'README.txt': strToU8(README),
  }, { level: 6 });
}

export function downloadExtension(chromeZip: Uint8Array, title: string) {
  const blob = new Blob([chromeZip as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aicc-mobile-bg-${(title || 'draft').replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

// A userscript variant for a phone browser (Firefox Android, Kiwi). Chrome on
// Android cannot run extensions at all, so this is the only mobile door.
export function buildUserscript(draft: DraftPayload) {
  const payload = JSON.stringify({ steps: draft.steps, extras: draft.extras }, null, 2);
  return `// ==UserScript==
// @name         AICC — Mobile.bg помощник
// @namespace    aicc
// @version      1.0
// @description  Попълва формата за нова обява в Mobile.bg от подготвената чернова.
// @match        https://www.mobile.bg/*
// @match        https://mobile.bg/*
// @grant        none
// ==/UserScript==

${fillSource}

// Плаща се само веднъж, при натискане: скриптът пита преди да пипне формата.
(function () {
  const PAYLOAD = ${payload};
  function button() {
    if (document.getElementById('aicc-start')) return;
    const start = document.createElement('button');
    start.id = 'aicc-start';
    start.textContent = 'Попълни от AICC (' + PAYLOAD.steps.length + ')';
    start.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:8px;border:0;background:#087df5;color:#fff;font:bold 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer';
    start.onclick = () => { start.remove(); fillMobileBgForm(PAYLOAD.steps, PAYLOAD.extras); };
    document.body.appendChild(start);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', button);
  else button();
})();
`;
}

export function copyUserscript(draft: DraftPayload) {
  void navigator.clipboard.writeText(buildUserscript(draft));
}