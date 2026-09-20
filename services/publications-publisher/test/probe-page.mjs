// What the publish page really offers a signed-out browser.
//
// The frame probe settled two things: there is no block, and the form is not
// hidden in a frame. The page text says «Вход | Нова Регистрация», so the
// browser is signed out — which is the case the specification calls
// session_required. This probe records what is actually on the page, so the
// signed-out detection is built from markers the page really shows rather than
// from the presence of a password box.

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
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(8000);

  const dump = await page.evaluate(() => ({
    url: location.href,
    forms: [...document.forms].map((f) => ({
      name: f.name || '(без име)',
      id: f.id || '',
      action: (f.getAttribute('action') || '').slice(0, 80),
      fields: [...f.elements].map((e) => `${e.tagName.toLowerCase()}${e.type ? `[${e.type}]` : ''}:${e.name || e.id || '?'}`).slice(0, 30),
    })),
    inputs: [...document.querySelectorAll('input,select,textarea')].map((e) => `${e.tagName.toLowerCase()}${e.type ? `[${e.type}]` : ''}:${e.name || e.id || '?'}`).slice(0, 40),
    passwordBoxes: document.querySelectorAll('input[type="password"]').length,
    // The markers a signed-out page shows, and the markers a signed-in page shows.
    signInLinks: [...document.querySelectorAll('a')]
      .filter((a) => /Вход|Регистрация/i.test(a.innerText || ''))
      .map((a) => ({ text: (a.innerText || '').trim().slice(0, 40), href: (a.href || '').slice(0, 120) }))
      .slice(0, 10),
    myAds: /\u041c\u043e\u0438\u0442\u0435 \u043e\u0431\u044f\u0432\u0438/.test(document.body.innerText || ''),
    addAd: /ДОБАВИ ОБЯВА/.test(document.body.innerText || ''),
    fullText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim(),
  }));

  console.log('\n=== формуляри ===');
  console.log(JSON.stringify(dump.forms, null, 1));
  console.log('\n=== всички полета на страницата ===');
  console.log(JSON.stringify(dump.inputs));
  console.log('\nполета за парола:', dump.passwordBoxes);
  console.log('\n=== линкове за вход/регистрация ===');
  console.log(JSON.stringify(dump.signInLinks, null, 1));
  console.log('\nмаркер «Моите обяви»:', dump.myAds);
  console.log('маркер «ДОБАВИ ОБЯВА»:', dump.addAd);
  console.log('\n=== ПЪЛЕН ТЕКСТ НА СТРАНИЦАТА ===');
  console.log(dump.fullText);
} finally {
  await connection?.close().catch(() => undefined);
  await stopBrowser(created.id).catch(() => undefined);
  console.log('\nбраузърът е спрян');
}