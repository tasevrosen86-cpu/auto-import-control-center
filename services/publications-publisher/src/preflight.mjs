// The rules a job must pass before it is allowed to reach the browser, from
// section 4 of the specification.
//
// These run in the worker, not in the UI. A button that is disabled by CSS is a
// convenience; a job that cannot be queued through these checks is the actual
// guarantee, and the specification says the backend must re-check the draft
// rather than trust what the frontend sent.

const PRICE_LIMIT_EUR = 80000;

// The exact f6 option is decided in the browser, against the options the form
// really offers: a value with no matching option stops the row there with
// `option_missing` and the list the page returned. This set only records the
// models the report happens to name, so a model outside it is a note rather
// than a block — blocking on an incomplete list would reject valid cars.
const MODELS_NAMED_IN_REPORT = new Set([
  'S 550', 'Q5', 'Rav4', 'F150', 'Sierra', 'Silverado', 'Blazer',
  'RAM 1500', 'Countryman', 'Clubman', 'Cooper s', 'Titan crew cab',
]);

export function preflight(draft) {
  const failures = [];
  const notes = [];

  // Source: a valid AutoTrader.ca URL. Encar is not a publishing source.
  const source = String(draft?.source || '');
  const sourceUrl = String(draft?.source_url || '');
  const isAutoTrader = source === 'autotrader.ca' || /^https?:\/\/(www\.)?autotrader\.ca\//i.test(sourceUrl);
  if (!isAutoTrader || !sourceUrl) failures.push({ code: 'blocked_source', message: 'Липсва валиден AutoTrader.ca адрес.' });

  // The green price cell is the eligibility signal, and it is read from the
  // report rather than drawn from frontend styling.
  if (draft?.green_canada_final !== true) failures.push({ code: 'blocked_not_green', message: 'Цената не е от зелената Canada-final клетка.' });

  const price = Number(draft?.price_eur);
  if (!Number.isFinite(price) || price <= 0) failures.push({ code: 'blocked_price_missing', message: 'Липсва одобрена EUR цена.' });
  else if (price > PRICE_LIMIT_EUR) failures.push({ code: 'blocked_price_limit', message: `Цена ${price} EUR надвишава ${PRICE_LIMIT_EUR} EUR.` });

  const model = String(draft?.model || '');
  if (!model) failures.push({ code: 'blocked_model_option', message: 'Липсва модел.' });
  else if (!MODELS_NAMED_IN_REPORT.has(model)) {
    notes.push(`Моделът «${model}» не е сред имената в отчета; точната опция за f6 се решава във формата.`);
  }

  for (const field of ['year', 'mileage', 'body', 'fuel', 'transmission', 'color']) {
    const value = draft?.[field];
    if (value === null || value === undefined || value === '') {
      failures.push({ code: 'blocked_missing_data', message: `Липсва потвърдена стойност за «${field}».` });
    }
  }

  const images = Array.isArray(draft?.source_images) ? draft.source_images : [];
  if (images.length === 0) failures.push({ code: 'blocked_photos', message: 'Няма нито един източник на снимка.' });
  if (images.length > 17) failures.push({ code: 'blocked_photos', message: `Снимките са ${images.length}, а целта е до 17.` });

  return { ok: failures.length === 0, failures, notes };
}

// A duplicate is an active Mobile.bg listing for the same master row. This is
// checked against what the section already recorded, and My Ads when reachable;
// a row with an active URL is never published a second time.
export function isDuplicate(draft, existingJobs) {
  if (!draft?.master_row) return false;
  return (existingJobs || []).some((job) =>
    Number(job?.payload?.master_row) === Number(draft.master_row)
    && job.public_url
    && job.status === 'COMPLETED');
}

export { PRICE_LIMIT_EUR, MODELS_NAMED_IN_REPORT };