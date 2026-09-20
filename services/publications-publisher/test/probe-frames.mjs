// Ground truth about the Mobile.bg publish page as the remote browser sees it.
//
// The gate said: no block, page loaded, no form in the top document, three
// frames. This walks every frame and reports where the form actually is, so the
// step logic is built on a measurement rather than on the assumption that the
// top document holds it.

import { chromium } from 'playwright';
import { createBrowser, stopBrowser } from '../src/browser_use.mjs';
import { FORM_URL } from '../src/form.mjs';

const created = await createBrowser();
console.log('браузър:', created.id);
console.log('наблюдение:', created.liveUrl);

let connection;
try {
  connection = await chromium.connectOverCDP(created.cdpUrl);
  const context = connection.contexts()[0] || await connection.newContext();
  const page = context.pages()[0] || await context.newPage();

  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('навигация:', e.message));
  await page.waitForTimeout(8000);

  console.log('\n=== URL на страницата ===');
  console.log(page.url());
  console.log('=== заглавие ===');
  console.log(await page.title());

  const frames = page.frames();
  console.log(`\n=== ${frames.length} фрейма ===`);
  for (const [index, frame] of frames.entries()) {
    let info = {};
    try {
      info = await frame.evaluate(() => ({
        hasForm: Boolean(document.forms.namedItem('pub')),
        fieldNames: document.forms.namedItem('pub') ? [...document.forms.namedItem('pub').elements].map((e) => e.name).filter(Boolean) : [],
        bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        title: document.title,
        elementCount: document.querySelectorAll('*').length,
      }));
    } catch (error) {
      info = { error: String(error).slice(0, 120) };
    }
    console.log(`\n--- фрейм ${index} ---`);
    console.log('url:', frame.url().slice(0, 200));
    console.log('name:', frame.name() || '(без име)');
    console.log('форма:', info.hasForm ? `ДА (${info.fieldNames.length} полета: ${info.fieldNames.slice(0, 12).join(',')})` : 'не');
    console.log('елементи:', info.elementCount ?? '?');
    console.log('заглавие:', info.title || '(няма)');
    console.log('текст:', info.bodyText || '(празно)');
    if (info.error) console.log('грешка:', info.error);
  }

  // The top document's own view, for comparison with what the gate reported.
  const top = await page.evaluate(() => ({
    forms: [...document.forms].map((f) => f.name || '(без име)'),
    iframes: [...document.querySelectorAll('iframe,frame')].map((f) => ({ src: (f.src || '').slice(0, 120), name: f.name || '', id: f.id || '' })),
    bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  }));
  console.log('\n=== главен документ ===');
  console.log('формуляри:', JSON.stringify(top.forms));
  console.log('фреймове:', JSON.stringify(top.iframes, null, 1));
  console.log('текст:', top.bodyText || '(празно)');
} finally {
  await connection?.close().catch(() => undefined);
  await stopBrowser(created.id).catch(() => undefined);
  console.log('\nбраузърът е спрян');
}