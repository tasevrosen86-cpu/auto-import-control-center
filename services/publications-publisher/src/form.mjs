// The Mobile.bg form steps, taken from the proven mobilebg-direct-publisher.
//
// Everything here talks to a `session` object rather than to Playwright or to
// the browser gateway directly. Both of those expose the same Chrome DevTools
// protocol — Playwright through context.newCDPSession(page) — so the step logic
// below is identical for either transport. That is the whole point: we keep the
// steps that already published real listings and change only how they are carried.

export const FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(`Скриптът в страницата върна грешка: ${result.exceptionDetails.text || 'непозната'}`);
  }
  return result.result?.value;
}

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

// Returns the options the page really offered when nothing matches, so a failed
// run explains itself instead of leaving a bare "option_missing".
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

// Waits for a dependent option list instead of sleeping a fixed time: the model
// list follows the make and the country list follows the location.
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
  // The wizard lives inside frames on this site, so give them time to settle
  // before deciding the page is not the form.
  await waitForFormInAnyFrame(session, 20);
  await sleep(500);
}

// The form is not always in the top document: mobile.bg serves its publisher
// inside frames, so a lookup limited to the main frame reports "no form" on a
// page that is actually showing the form. This walks every frame.
async function waitForFormInAnyFrame(session, attempts) {
  if (!session.page) return false;
  for (let i = 0; i < attempts; i += 1) {
    for (const frame of session.page.frames()) {
      try {
        if (await frame.evaluate(() => Boolean(document.forms.namedItem('pub')))) return true;
      } catch { /* a frame can be detached mid-walk */ }
    }
    await sleep(500);
  }
  return false;
}

// The form is only really there if it carries its own controls. Reading this
// first keeps a block page from being mistaken for a half-filled form.
//
// The verdict is explicit: `SUCCESS` only when document.forms.namedItem("pub")
// exists with its fields, otherwise `browser_blocked`. Cloudflare and its
// interstitial are named in the reason so a block is never misread as a
// mapping problem.
export async function inspectForm(session) {
  // Frames first: the form is inside one, and reading only the top document is
  // what made a real Mobile.bg page look like a block page.
  if (session.page) {
    for (const frame of session.page.frames()) {
      try {
        const inFrame = await frame.evaluate(`(() => {
          const form = document.forms.namedItem("pub")
          if (!form) return null
          const names = [...form.elements].map((e) => e.name).filter(Boolean)
          return { url: location.href, title: document.title, form_found: true, frame: true, control_count: names.length, controls: names.slice(0, 40), has_make: names.includes("f5"), has_file_input: document.querySelectorAll('input[type="file"]').length > 0 }
        })()`);
        if (inFrame?.form_found) {
          const verdict = inFrame.control_count > 0 && inFrame.has_make ? 'SUCCESS' : 'browser_blocked';
          return {
            ...inFrame,
            verdict,
            reason: verdict === 'SUCCESS'
              ? 'Формата на Mobile.bg е реална: document.forms.namedItem("pub") съществува с полетата си, във фрейм.'
              : `Формата е намерена, но с ${inFrame.control_count} полета${inFrame.has_make ? '' : ' и без марката'}.`,
          };
        }
      } catch { /* a frame can be detached mid-walk */ }
    }
  }

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
const DEFAULT_DESCRIPTION = process.env.PUBLICATIONS_DESCRIPTION || '!!!реална крайна цена!!!';

// Steps kept from the proven script: submit step one through actions=2 rather
// than hunting for a «Продължи» control, confirm with the exact «Преглед на
// обявата» text, then check the public page instead of trusting the form.
export async function publishOne(session, item) {
  const result = { make: item.make, model: item.model, year: item.year, price_eur: item.price_eur };
  try {
    const makeText = { RAM: 'Dodge', Volkswagen: 'VW' }[item.make] || item.make;
    const modelText = item.model;
    await openForm(session);
    if (!(await selectText(session, 'f5', makeText)).ok) throw new Error(`make_option_missing:${makeText}`);
    await waitForOptions(session, 'f6');
    const model = await selectText(session, 'f6', modelText);
    if (!model?.ok) throw new Error(`model:${JSON.stringify(model)}`);
    const fields = [
      ['f8', item.fuel_label, 'select'], ['f25', 'Употребяван', 'select'], ['f9', item.power || '', 'input'],
      ['f12', item.price_eur, 'input'], ['f13', item.currency || 'EUR', 'select'], ['f10', item.gearbox_label, 'select'],
      ['f11', item.body_label, 'select'], ['f31', 'Цената е с включено ДДС', 'select'], ['f16', item.mileage, 'input'],
      ['f14', item.month_label, 'select'], ['f15', item.year, 'select'], ['f17', item.color_label, 'select'],
      ['f18', 'Извън страната', 'select'],
    ];
    for (const [name, value, kind] of fields) {
      const ok = kind === 'select' ? (await selectText(session, name, value)).ok : await setValue(session, name, value, kind);
      if (!ok) throw new Error(`field_missing_or_invalid:${name}`);
    }
    await waitForOptions(session, 'f19');
    if (!(await selectText(session, 'f19', item.country_label || 'Канада')).ok) throw new Error('country_missing');
    if (!(await setValue(session, 'f21', item.description || DEFAULT_DESCRIPTION, 'textarea'))) throw new Error('field_missing:f21');
    if (!(await setValue(session, 'f22', CONTACT_PHONE, 'input'))) throw new Error('field_missing:f22');

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
    if (!step2) throw new Error('step2_not_reached');

    const staged = await item.stageImages();
    if (!staged.length) throw new Error('no_usable_images');
    const documentNode = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const input = await session.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type="file"]' });
    if (!input.nodeId) throw new Error('file_input_missing');
    await session.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: staged });

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
    if (!listing?.url) throw new Error('no_public_listing_link');
    result.listing_url = listing.url;
    result.public_photo_check = await verifyPublicPhotos(session, listing.url, staged.length);
    result.state = result.public_photo_check?.ok ? 'published' : 'published_no_photos';
  } catch (error) {
    result.state = 'failed';
    result.message = String(error);
  }
  return result;
}

// Opens the finished public listing and counts photos that are really loaded,
// not just referenced. A listing with a broken carousel must not be called
// published.
export async function verifyPublicPhotos(session, url, expected) {
  await session.send('Page.navigate', { url });
  await sleep(10000);
  await sleep(500);
  return evaluate(session, `(() => {
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
}