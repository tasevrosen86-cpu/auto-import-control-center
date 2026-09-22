// Admission checks for the direct-link publisher.
//
// The publisher receives a real AutoTrader URL and a manually chosen Mobile.bg
// price. It does not depend on a master-catalogue row, green price cell or a
// pre-created mobile_bg draft. Values are extracted from the source page first
// and then checked here before the browser is allowed to submit the form.

export function isAutoTraderUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /(^|\.)autotrader\.ca$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function preflight(draft) {
  const failures = [];
  const notes = [];
  const sourceUrl = String(draft?.source_url || '');

  if (!isAutoTraderUrl(sourceUrl)) {
    failures.push({ code: 'blocked_source', message: 'Нужен е валиден директен AutoTrader.ca линк.' });
  }

  const price = Number(draft?.price_eur);
  if (!Number.isFinite(price) || price <= 0) {
    failures.push({ code: 'blocked_price_missing', message: 'Въведи крайната цена за Mobile.bg в EUR.' });
  }

  // Colour is optional on Mobile.bg and the extraction reports an unknown colour
  // as absent rather than guessing, so it must not stop the listing. The
  // required set is the data Mobile.bg truly needs to accept the ad.
  for (const field of ['make', 'model', 'year', 'mileage', 'body', 'fuel', 'transmission']) {
    const value = draft?.[field];
    if (value === null || value === undefined || value === '') {
      failures.push({ code: 'blocked_missing_data', message: `Липсва потвърдена стойност за «${field}».` });
    }
  }

  const images = Array.isArray(draft?.source_images) ? draft.source_images : [];
  if (images.length === 0) {
    failures.push({ code: 'blocked_photos', message: 'Източникът не върна реални снимки.' });
  }
  if (images.length > 17) {
    notes.push(`Ще се използват първите 17 от ${images.length} намерени снимки.`);
  }

  return { ok: failures.length === 0, failures, notes };
}

export function isDuplicate(draft, existingJobs) {
  const sourceUrl = String(draft?.source_url || '');
  if (!sourceUrl) return false;
  return (existingJobs || []).some((job) =>
    String(job?.payload?.source_url || '') === sourceUrl
      && job.public_url
      && job.status === 'COMPLETED'
  );
}