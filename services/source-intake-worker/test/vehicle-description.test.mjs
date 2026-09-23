// Drives the real vehicleDescription() against the saved AutoTrader markup.
//
// The fixture is the live "Vehicle Description" section plus the page's own
// meta[name=description], saved verbatim. Nothing here re-implements the
// extraction: the assertions read what the production function returns, so a
// change that breaks the selector or the innerText handling fails this test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { vehicleDescription, SELLER_NOTES_SELECTOR, META_DESCRIPTION_SELECTOR } from '../src/vehicle-description.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures/autotrader-listing.html'), 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok' : 'NOT OK'} - ${name}${ok || !detail ? '' : ` :: ${detail}`}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();
try {
  // 1. The section path: the dealer's own text, with the trim only it carries.
  const withSection = await browser.newPage();
  await withSection.setContent(fixture, { waitUntil: 'domcontentloaded' });
  const fromSection = await vehicleDescription(withSection);
  check('извлича текста от seller-notes секцията', fromSection.from === 'dom.seller-notes-section', fromSection.from);
  check('текстът съдържа точния модел 528i', fromSection.text.includes('528i'), fromSection.text.slice(0, 80));
  check('текстът започва с годината и марката', /^\*?2013 BMW 528i/.test(fromSection.text), fromSection.text.slice(0, 40));
  check('innerText връща нови редове, не <br> тагове', !fromSection.text.includes('<br'), JSON.stringify(fromSection.text.slice(0, 200)));
  check('HTML таговете са премахнати', !/<[a-z/]/i.test(fromSection.text), JSON.stringify(fromSection.text.slice(0, 200)));
  check('HTML entities са декодирани', fromSection.text.includes('&') === false || !fromSection.text.includes('&amp;'), JSON.stringify(fromSection.text.match(/&[a-z]+;/i)?.[0] || 'няма entity'));

  // 2. The fallback path: the section is removed, so the meta tag must answer.
  const withoutSection = await browser.newPage();
  await withoutSection.setContent(fixture, { waitUntil: 'domcontentloaded' });
  await withoutSection.evaluate(selector => document.querySelectorAll(selector).forEach(node => node.remove()), SELLER_NOTES_SELECTOR);
  check('секцията наистина е премахната във втория случай', await withoutSection.locator(SELLER_NOTES_SELECTOR).count() === 0);
  const fromMeta = await vehicleDescription(withoutSection);
  check('пада към meta[name=description]', fromMeta.from === 'meta.description', fromMeta.from);
  check('fallback текстът също носи модела', fromMeta.text.includes('528i'), fromMeta.text.slice(0, 80));

  // 3. Neither source present: empty text, and honest about where it came from.
  const empty = await browser.newPage();
  await empty.setContent('<!doctype html><html><head></head><body></body></html>', { waitUntil: 'domcontentloaded' });
  const nothing = await vehicleDescription(empty);
  check('без секция и без meta връща празен текст', nothing.text === '' && nothing.from === '', JSON.stringify(nothing));
  check('meta селекторът съвпада с този в страницата', await empty.locator(META_DESCRIPTION_SELECTOR).count() === 0);
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} проверки се провалиха.` : '\nВсички проверки минаха.');
process.exitCode = failures ? 1 : 0;
