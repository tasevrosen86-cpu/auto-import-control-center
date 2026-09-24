// Decides whether a draft may be sent to the API, and says why not when it may
// not.
//
// The browser path answers this by trying to fill the form and reporting what
// did not land. The API path can answer it *before* touching the network: the
// fields are known, the required parameters are documented, and the account has
// a fixed set of IDs it accepts. So this is a pre-flight check, and its whole
// output is shown to the broker before anything is sent.

import {
  buildPayload,
  intersectWithCatfields,
  readCatfields,
  REQUIRED_API_PARAMS,
  type DraftFieldRow,
  type DraftExtraRow,
  type BuiltPayload,
} from './mapping.js';
import type { SourceImage, PreparedBatch } from './pictures.js';

export type ReadinessSeverity = 'blocker' | 'warning';

export type ReadinessIssue = {
  severity: ReadinessSeverity;
  code: string;
  // Written for a broker: what is wrong and what to do about it.
  message: string;
  // The draft fields that have to be filled, when the issue is about values.
  fields?: string[];
};

export type Readiness = {
  ready: boolean;
  issues: ReadinessIssue[];
  payload: BuiltPayload;
  selected_images: number;
  // Set when a blocker is only about the pictures. The listing can still be
  // published and the pictures retried after the cause is fixed.
  pictures_only: boolean;
};

export type ReadinessInput = {
  fields: DraftFieldRow[];
  extras: DraftExtraRow[];
  images: SourceImage[];
  category?: string | null;
  catfields?: unknown;
  hasCredentials: boolean;
  // Present once a previous attempt created the listing. With an id the run can
  // skip straight to the pictures instead of creating a second listing.
  existingListingId?: string | null;
  pictureBaseUrl?: string;
};

// The values that must be present for the publish call itself. These are the
// documented essentials plus the ones the browser path already treated as
// mandatory, so a draft that was publishable before stays publishable.
const MANDATORY_FIELDS = ['make', 'model', 'year', 'mileage', 'fuel', 'gearbox', 'price', 'currency'];

const MANDATORY_LABELS: Record<string, string> = {
  make: 'Марка', model: 'Модел', year: 'Година', mileage: 'Пробег',
  fuel: 'Гориво', gearbox: 'Скоростна кутия', price: 'Цена', currency: 'Валута',
  location: 'Регион', phone: 'Телефон', category: 'Категория',
};

export function checkReadiness(input: ReadinessInput): Readiness {
  const issues: ReadinessIssue[] = [];
  const values = new Map<string, string>();
  for (const row of input.fields) {
    const value = String(row.value ?? '').trim();
    if (value) values.set(row.field_key, value);
  }

  const payload = buildPayload(input.fields, input.extras, { category: input.category });
  const selectedImages = input.images.filter(image => image.is_selected);
  const pictureOnlyBlockers: ReadinessIssue[] = [];

  if (!input.hasCredentials) {
    issues.push({
      severity: 'blocker', code: 'NO_CREDENTIALS',
      message: 'Липсват потребител и парола за Mobile.bg. Без тях API-ът не може да генерира token.',
    });
  }

  const missing = MANDATORY_FIELDS.filter(key => !values.get(key));
  if (missing.length > 0) {
    issues.push({
      severity: 'blocker', code: 'MISSING_FIELDS',
      message: `Липсват задължителни полета: ${missing.map(key => MANDATORY_LABELS[key] || key).join(', ')}.`,
      fields: missing,
    });
  }

  // The API needs a region. The draft stores the origin joined with a country,
  // and only a joined value it knows how to split gets a region out of it.
  if (!payload.params.locat) {
    issues.push({
      severity: 'blocker', code: 'MISSING_LOCATION',
      message: `Липсва регион за публикуване („${MANDATORY_LABELS.location}“). API-ът изисква параметър locat.`,
      fields: ['location'],
    });
  }

  const price = Number(payload.params.price);
  if (payload.params.price !== undefined && (!Number.isFinite(price) || price <= 0)) {
    issues.push({
      severity: 'blocker', code: 'BAD_PRICE',
      message: 'Цената трябва да е положително число. За „цена при запитване“ API-ът иска празна цена и параметър priceneg=1, което още не се поддържа.',
      fields: ['price'],
    });
  }

  const currency = payload.params.currency;
  if (currency && !['EUR', 'BGN', 'лв.', 'USD'].includes(currency)) {
    issues.push({
      severity: 'blocker', code: 'BAD_CURRENCY',
      message: `Валутата „${currency}“ не е сред приетите от API-то (EUR, лв., USD).`,
      fields: ['currency'],
    });
  }

  if (selectedImages.length === 0) {
    pictureOnlyBlockers.push({
      severity: 'blocker', code: 'NO_IMAGES',
      message: 'Няма избрани снимки. Обявата може да се публикува, но ще остане без снимки, докато не избереш поне една.',
    });
  }
  if (selectedImages.length > 17) {
    issues.push({
      severity: 'warning', code: 'TOO_MANY_IMAGES',
      message: `Избрани са ${selectedImages.length} снимки; Mobile.bg приема до 17. Ще бъдат изпратени първите 17.`,
    });
  }

  // A parameter the API does not declare for this category is dropped rather
  // than sent. Reported as a warning because the publish itself usually still
  // works — the value just does not reach Mobile.bg.
  const catfields = readCatfields(input.catfields);
  const { dropped } = intersectWithCatfields(payload.params, catfields);
  if (dropped.length > 0) {
    issues.push({
      severity: 'warning', code: 'DROPPED_PARAMS',
      message: `Тези параметри не са обявени от Mobile.bg за избраната категория и няма да бъдат изпратени: ${dropped.map(item => item.api_key).join(', ')}. Ако някой от тях е важен, категорията вероятно е сгрешена.`,
    });
  }

  if (payload.unmapped.length > 0) {
    issues.push({
      severity: 'warning', code: 'UNMAPPED_FIELDS',
      message: `Тези полета от черновата нямат съответствие в API-то и остават само в нашия запис: ${payload.unmapped.map(item => item.field_key).join(', ')}.`,
    });
  }

  if (catfields.understood && catfields.names.size > 0) {
    const absent = REQUIRED_API_PARAMS.filter(key => !catfields.names.has(key) && key !== 'topmenu' && key !== 'rub');
    if (absent.length > 0 && !input.existingListingId) {
      issues.push({
        severity: 'warning', code: 'UNEXPECTED_SCHEMA',
        message: `Mobile.bg не обяви тези очаквани параметри: ${absent.join(', ')}. Възможно е категорията да е сгрешена; провери отговора в диагностиката.`,
      });
    }
  }

  for (const warning of payload.warnings) {
    issues.push({ severity: 'warning', code: 'CATEGORY', message: warning });
  }

  if (input.pictureBaseUrl && !/^https:\/\//i.test(input.pictureBaseUrl)) {
    pictureOnlyBlockers.push({
      severity: 'blocker', code: 'BAD_PICTURE_HOST',
      message: `Адресът за снимки трябва да е HTTPS, за да може Mobile.bg да ги свали. Зададен е „${input.pictureBaseUrl}“.`,
    });
  }

  const blockers = issues.filter(issue => issue.severity === 'blocker');
  const allPictureOnly = blockers.length === 0 && pictureOnlyBlockers.length > 0;
  const finalIssues = [...issues, ...pictureOnlyBlockers];

  return {
    ready: finalIssues.every(issue => issue.severity !== 'blocker') || allPictureOnly,
    issues: finalIssues,
    payload,
    selected_images: selectedImages.length,
    pictures_only: allPictureOnly,
  };
}

// A short, human summary for the action log and the screen header.
export function summarizeReadiness(readiness: Readiness): string {
  const blockers = readiness.issues.filter(issue => issue.severity === 'blocker');
  const warnings = readiness.issues.filter(issue => issue.severity === 'warning');
  if (blockers.length === 0 && warnings.length === 0) return 'Готово за изпращане към Mobile.bg.';
  if (blockers.length === 0) return `Готово за изпращане с ${warnings.length} предупреждения.`;
  return `Не е готово: ${blockers.length} пречки, ${warnings.length} предупреждения.`;
}

export type { PreparedBatch };
