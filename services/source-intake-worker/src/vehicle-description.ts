import type { Page } from 'playwright';

export type VehicleInstructions = { text: string; from: string };

// Mobile.bg shows this text as «Допълнителна информация», but the dealer's own
// wording lives in AutoTrader's "Vehicle Description" section, not in any
// structured field: the trim ("528i") appears there and nowhere else, while
// listingDetails.vehicle.model only ever carries the model line ("5 Series").
export const SELLER_NOTES_SELECTOR = 'section[data-cy="seller-notes-section"] #sellerNotesSection .SellerNotesSection_content__te2EB';

export const META_DESCRIPTION_SELECTOR = 'meta[name="description"]';

// Kept in its own module so a test can drive the real function against a saved
// page: index.ts runs the worker on import, so nothing there is importable.
export async function vehicleDescription(page: Page): Promise<VehicleInstructions> {
  const notes = page.locator(SELLER_NOTES_SELECTOR).first();
  // innerText, not textContent: the dealer writes paragraph breaks as <br>/<hr>,
  // which only innerText turns back into newlines.
  const text = ((await notes.innerText().catch(() => '')) || '').trim();
  if (text) return { text, from: 'dom.seller-notes-section' };
  // AutoTrader sometimes renders the same text only into the social meta tag.
  const meta = ((await page.locator(META_DESCRIPTION_SELECTOR).getAttribute('content').catch(() => '')) || '').trim();
  return { text: meta, from: meta ? 'meta.description' : '' };
}
