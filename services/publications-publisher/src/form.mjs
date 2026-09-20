// The Mobile.bg form steps, taken from the proven direct publisher
// (run-mobilebg-direct-v19-batch.mjs) as described in the technical report.
//
// Everything here talks to a `session` object rather than to Playwright or to
// the browser gateway directly. Both of those expose the same Chrome DevTools
// protocol — Playwright through context.newCDPSession(page) — so the step logic
// below is identical for either transport. That is the whole point: we keep the
// steps that already published real listings and change only how they are carried.
//
// The report is explicit about how a field is found: the named form and
// form.elements[name], never CSS classes, XPath, placeholder or label text.
// Selectors are not invented here; when the DOM drifts the run stops instead.

import {
  makeLabel, modelLabel, bodyLabel, fuelLabel, transmissionLabel, colorLabel,
} from './mappings.mjs';

// The live form URL. It is overridable so the step logic can be exercised
// against the existing stub form without ever pointing a test at Mobile.bg.
export const FORM_URL = process.env.PUBLICATIONS_FORM_URL || 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The proven script hardcoded «януари». The report records that as the
// historical value and keeps the current publishing rule as a separate
// decision, so the default stays the proven one and a job may override it.
const MONTHS_BY_NUMBER = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const DEFAULT_MONTH = 'януари';

function resolveMonth(item) {
  if (item.month_label) return item.month_label;
  const asNumber = Number(item.month);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 12) return MONTHS_BY_NUMBER[asNumber - 1];
  if (typeof item.month === 'string' && item.month.trim()) return item.month.trim().toLocaleLowerCase('bg');
  return DEFAULT_MONTH;
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(`Скриптът в страницата върна грешка: ${result.exceptionDetails.text || 'непозната'}`);
  }
  return result.result?.value;
}

// Native prototype setter plus input/change, exactly as the proven script did.
// Playwright's select_option was not used and is not used here.
async function setValue(session, name, value, kind = 'input') {
  const proto = kind === 'select' ? 'HTMLSelectElement' : kind === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement';
  return evaluate(session, `(() => {
    const e = document.forms.namedItem("pub")?.elements[${JSON.stringify(name)}]
    if (!e) return false
    Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set.call(e, String(${JSON.stringify(value)}))
    e.dispatchEvent(new Event("input", { bubbles: true }))
    e.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  })()`);
}

// Matches on the visible option text, case-insensitively, and returns the
// option value only internally. The options the page really offered come back
// when nothing matches, so a failed run explains itself instead of leaving a
// bare "option_missing".
async function selectText(session, name, text) {
  return evaluate(session, `(() => {
    const e = document.forms.namedItem("pub")?.elements[${JSON.stringify(name)}]
    if (!e) return { ok: false, error: "field_missing" }
    const wanted = String(${JSON.stringify(text)}).trim().toLowerCase()
    const option = [...e.options].find((o) => o.text.trim().toLowerCase() === wanted)
    if (!option) return { ok: false, error: "option_missing", options: [...e.options].map((o) => o.text.trim()) }
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, option.value)
    e.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, value: option.value }
  })()`);
}

// Waits for a dependent option list instead of sleeping a fixed length: the
// model list follows the make and the country list follows the location.
// 40 × 250 ms is the proven bound.
async function waitForOptions(session, name, minimum = 2, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const count = Number(await evaluate(session, `document.forms.namedItem("pub")?.elements[${JSON.stringify(name)}]?.options?.length || 0`));
    if (count >= minimum) return true;
    await sleep(250);
  }
  return false;
}

export async function openForm(session) {
  await session.send('Page.navigate', { url: FORM_URL });
  await sleep(7000);
  await sleep(500);
}

// The proven flow was handed an already-signed-in session, so it contained no
// login automation at all — no username, no password, no OTP. The specification
// forbids adding one, because the credential would then reach the worker and the
// job payload. A signed-out profile is therefore reported and left for a person.
//
// Measured on the live page: a signed-out browser gets no form at all and no
// password box either — it gets the public page whose text begins
// «Вход | Нова Регистрация». Detecting this by the password box alone, as the
// first version did, reported `already_logged_in` on a page that was plainly
// signed out, which is why the gate misread a session problem as a form problem.
export async function ensureLoggedIn(session) {
  if (!session.page) return { state: 'unknown' };
  const page = session.page;

  const state = await page.evaluate(() => {
    const text = (document.body?.innerText || '');
    const form = document.forms.namedItem('pub');
    return {
      hasForm: Boolean(form) && [...form.elements].some((e) => e.name === 'f5'),
      asksToSignIn: /Вход\s*\|\s*Нова Регистрация/.test(text),
      hasMyAds: /Моите обяви/.test(text),
      passwordBoxes: document.querySelectorAll('input[type="password"]').length,
    };
  }).catch(() => null);
  if (!state) return { state: 'unknown' };

  // The form itself is the proof of a usable session.
  if (state.hasForm) return { state: 'already_logged_in' };
  if (state.asksToSignIn || !state.hasMyAds) {
    return {
      state: 'session_required',
      reason: 'Страницата иска вход. Сесията в профила е изтекла или липсва — влез ръчно през живия изглед.',
    };
  }
  return { state: 'signed_in_without_form', password_boxes: state.passwordBoxes };
}

export async function inspectForm(session) {
  const seen = await evaluate(session, `(() => {
    const form = document.forms.namedItem("pub")
    const names = form ? [...form.elements].map((e) => e.name).filter(Boolean) : []
    const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim()
    const html = (document.documentElement?.outerHTML || "").toLowerCase()
    return {
      url: location.href,
      title: document.title,
      form_found: Boolean(form),
      control_count: names.length,
      controls: names.slice(0, 40),
      has_make: names.includes("f5"),
      has_file_input: document.querySelectorAll('input[type="file"]').length > 0,
      body_text: text.slice(0, 400),
      frame_count: document.querySelectorAll('iframe, frame').length,
      markers: ['just a moment', 'cf-challenge', 'cf_chl_', 'checking your browser', 'attention required', 'cloudflare', 'технически затруднения', 'достъпът е ограничен', 'access denied']
        .filter((marker) => html.includes(marker) || text.toLowerCase().includes(marker)),
    }
  })()`);

  const verdict = seen.form_found && seen.control_count > 0 && seen.has_make ? 'SUCCESS' : 'browser_blocked';
  // A real page with no form is a different problem from a block page, and
  // saying which one it is stops the next person chasing the wrong cause.
  const reached = seen.markers.length === 0 && /ДОБАВИ ОБЯВА|Моите обяви|Въвеждане на описанието/i.test(seen.body_text);
  const reason = verdict === 'SUCCESS'
    ? 'Формата на Mobile.bg е реална: document.forms.namedItem("pub") съществува с полетата си.'
    : reached
      ? `Страницата на Mobile.bg се зареди (блокада няма), но формата не е налична: ${seen.control_count} полета, ${seen.frame_count} фрейма. Това е различен проблем от блокировка.`
      : `Формата не се появи: ${seen.control_count} полета.${seen.markers.length ? ` Маркери на блокировка: ${seen.markers.join(', ')}.` : ''} Страницата върна: ${seen.body_text.slice(0, 200) || 'нищо'}`;
  return { ...seen, reached, verdict, reason };
}

// Phone and description are required by Mobile.bg but are constant for us, so
// they are configuration rather than draft data.
const CONTACT_PHONE = process.env.PUBLICATIONS_CONTACT_PHONE || '0887353653';
// The proven publisher left the description empty or fell back to this text; no
// company template is recorded anywhere, so the fallback is kept, not invented.
const DEFAULT_DESCRIPTION = process.env.PUBLICATIONS_DESCRIPTION || '!!!реална крайна цена!!!';

// Steps kept from the proven script: submit step one through actions=2 rather
// than hunting for a «Продължи» control, confirm with the exact «Преглед на
// обявата» text, then check the public page instead of trusting the form.
export async function publishOne(session, item) {
  const result = { row: item.row, make: item.make, model: item.model, year: item.year, price_eur: item.price_eur };
  try {
    // The input contract carries internal values, so the translations happen
    // here, from the tables lifted out of the proven script.
    const makeText = makeLabel(item.make);
    const modelText = modelLabel(item.make, item.model);
    const gearboxText = item.gearbox_label || transmissionLabel(item.transmission);
    const fuelText = item.fuel_label || fuelLabel(item.fuel);
    const colourText = item.color_label || colorLabel(item.color);
    const bodyText = item.body_label || bodyLabel(item);

    await openForm(session);
    if (!(await selectText(session, 'f5', makeText)).ok) throw new Error(`make_option_missing:${makeText}`);
    await waitForOptions(session, 'f6');
    const model = await selectText(session, 'f6', modelText);
    if (!model?.ok) throw new Error(`model:${JSON.stringify(model)}`);
    const fields = [
      ['f8', fuelText, 'select'], ['f25', 'Употребяван', 'select'], ['f9', item.power ?? item.horsepower ?? '', 'input'],
      ['f12', item.price_eur, 'input'], ['f13', item.currency || 'EUR', 'select'], ['f10', gearboxText, 'select'],
      // f11 must be set before f18: choosing it is what reloads the area list.
      ['f11', bodyText, 'select'],
      ['f31', 'Цената е с включено ДДС', 'select'], ['f16', item.mileage, 'input'],
      ['f14', resolveMonth(item), 'select'], ['f15', item.year, 'select'], ['f17', colourText, 'select'],
      ['f18', 'Извън страната', 'select'],
    ];
    for (const [name, value, kind] of fields) {
      const ok = kind === 'select' ? (await selectText(session, name, value)).ok : await setValue(session, name, value, kind);
      if (!ok) throw new Error(`field_missing_or_invalid:${name}`);
    }
    await waitForOptions(session, 'f19');
    if (!(await selectText(session, 'f19', item.country_label || 'Канада')).ok) throw new Error('country_missing');
    if (!(await setValue(session, 'f21', item.description ?? DEFAULT_DESCRIPTION, 'textarea'))) throw new Error('field_missing:f21');
    if (!(await setValue(session, 'f22', CONTACT_PHONE, 'input'))) throw new Error('field_missing:f22');

    // Read back the checked fields before submitting. A mismatch means the page
    // refused a value, and submitting anyway would create a half-filled listing.
    const readback = await evaluate(session, `(() => {
      const f = document.forms.namedItem("pub")
      return {
        f9: f.elements.f9?.value ?? null, f12: f.elements.f12?.value ?? null, f13: f.elements.f13?.value ?? null,
        f16: f.elements.f16?.value ?? null, f18: f.elements.f18?.value ?? null, f19: f.elements.f19?.value ?? null,
        f22: f.elements.f22?.value ?? null,
      }
    })()`);
    result.pre_submit = readback;
    if (readback.f22 !== CONTACT_PHONE) throw new Error(`pre_submit_mismatch:f22 (${readback.f22})`);

    const submitted = await evaluate(session, `(() => {
      const f = document.forms.namedItem("pub")
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f.elements.actions, "2")
      HTMLFormElement.prototype.submit.call(f)
      return true
    })()`);
    if (!submitted) throw new Error('step1_submit_failed');

    let step2 = false;
    for (let i = 0; i < 30; i += 1) {
      step2 = Boolean(await evaluate(session, 'document.querySelector(\'input[type="file"]\') && /Стъпка 2|Добавяне на снимки/.test(document.body.innerText)'));
      if (step2) break;
      await sleep(500);
    }
    if (!step2) {
      // The report records the body tail as the available step-1 diagnostic.
      const tail = await evaluate(session, '(document.body?.innerText || "").slice(-1000)').catch(() => '');
      throw new Error(`step2_not_reached: ${tail}`);
    }

    const staged = await item.stageImages(item.source_images || []);
    if (!staged.length) throw new Error('no_usable_images');
    // The proven flow staged files onto the browser machine through a gateway
    // this build does not have. Playwright's setInputFiles carries the bytes to
    // a remote browser over CDP directly, which is the equivalent operation.
    const fileInput = session.page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) throw new Error('file_input_missing');
    await fileInput.setInputFiles(staged);

    let attached = 0;
    for (let i = 0; i < 180; i += 1) {
      attached = Number(await evaluate(session, 'document.querySelectorAll("li.hasPhoto .photo[style*=\\"background-image\\"]").length')) || 0;
      const processing = Number(await evaluate(session, 'document.querySelectorAll("li.hasPhoto .processing").length')) || 0;
      if (attached >= staged.length && processing === 0) break;
      await sleep(500);
    }
    result.attached = attached;
    result.expected = staged.length;
    if (attached < staged.length) throw new Error(`${attached}/${staged.length} photos attached before final step`);

    await evaluate(session, `(() => { const e = [...document.querySelectorAll("a,button")].find((e) => (e.innerText || e.value || "").trim() === "ПРОДЪЛЖИ"); if (!e) return false; e.click(); return true })()`);
    await sleep(7000);

    const listing = await evaluate(session, `(() => { const e = [...document.querySelectorAll("a")].find((e) => (e.innerText || "").trim() === "Преглед на обявата"); return { url: e?.href || null } })()`);
    if (!listing?.url) {
      const tail = await evaluate(session, '(document.body?.innerText || "").slice(-1200)').catch(() => '');
      throw new Error(`no_public_listing_link: ${tail}`);
    }
    result.listing_url = listing.url;
    result.public_photo_check = await verifyPublicPhotos(session, listing.url, staged.length);
    result.state = result.public_photo_check?.ok ? 'published' : 'published_no_photos';
  } catch (error) {
    result.state = 'failed';
    result.message = String(error);
  }
  return result;
}

// Opens the finished public listing and gathers the evidence the report records
// for a verified publication: the photo line, the really loaded images, the
// active status, the price line and the phone flag. A listing with a broken
// carousel must not be called published.
export async function verifyPublicPhotos(session, url, expected) {
  await session.send('Page.navigate', { url });
  await sleep(10000);
  await sleep(500);
  const photos = await evaluate(session, `(() => {
    const photoLines = [...document.body.innerText.matchAll(/\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/g)].map((m) => ({ visible: Number(m[1]), total: Number(m[2]) }))
    const sourceImages = [...document.querySelectorAll("img.carouselimg")]
      .map((image) => image.dataset.src || image.currentSrc || image.src)
      .filter((source) => source && !source.includes("nophoto"))
    const uniqueSourceImages = [...new Set(sourceImages)]
    const realLoadedImages = [...document.images].filter((image) => {
      const source = image.currentSrc || image.src
      return source && !source.includes("nophoto") && image.naturalWidth > 0 && image.naturalHeight > 0
    }).length
    const maxPhotoTotal = Math.max(0, ...photoLines.map((line) => line.total))
    return {
      url: location.href,
      photoLines,
      sourceImageCount: uniqueSourceImages.length,
      realLoadedImages,
      maxPhotoTotal,
      expected: Number(${JSON.stringify(expected)}),
      ok: uniqueSourceImages.length >= 1 && realLoadedImages >= 1 && maxPhotoTotal >= Number(${JSON.stringify(expected)})
    }
  })()`);

  const evidence = await evaluate(session, `(() => {
    const text = (document.body.innerText || "").replace(/\\s+/g, " ")
    const priceMatch = text.match(/(\\d[\\d\\s.,]{2,})\\s*€/)
    const phoneOnPage = /0\\d{9}/.test(text.replace(/\\s+/g, ''))
    const inactive = /неактивна|изтрита|не е налична|обявата не е намерена/i.test(text)
    return {
      title: document.title,
      price_line: priceMatch ? priceMatch[0].trim() : null,
      phone: phoneOnPage,
      active: !inactive && text.length > 200,
    }
  })()`);

  // Internal success is not enough: a public URL, an active page and real
  // photos are what the report accepts as proof.
  return { ...photos, ...evidence, ok: photos.ok && evidence.active };
}