import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import type { MobileBgDraftField } from '@/types';

export type PublishTransport = 'BROWSER_ON_DEMAND' | 'OFFICIAL_API';

export type PublishReadiness = {
  ready: boolean;
  missing: string[];
};

// An official Mobile.bg partner API can be added later.  Until its public,
// documented contract is available, direct POST requests are intentionally
// not attempted: they are session/CSRF dependent and would break silently.
export function getPublishReadiness(fields: MobileBgDraftField[]): PublishReadiness {
  const values = new Map(fields.map(field => [field.field_key, String(field.value || '').trim()]));
  const missing = MOBILE_BG_FIELD_MAP
    .filter(field => field.required)
    .filter(field => !values.get(field.key))
    .map(field => field.mobile_bg_label);

  return { ready: missing.length === 0, missing };
}

export function publisherTransportLabel(transport: PublishTransport): string {
  return transport === 'OFFICIAL_API' ? 'Официален API' : 'Браузър при заявка';
}
