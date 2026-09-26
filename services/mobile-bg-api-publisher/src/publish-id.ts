// Which listing id the pictures are attached to, and what happens when there is
// no trustworthy one.
//
// The id handed to `advertpicts` must come from the `advertpub` answer of the
// current run. An id stored by an earlier run is only a hint about which listing
// to correct, and it is trusted only after Mobile.bg confirms that listing still
// exists. Passing a stored id through unverified is what produced `Wrong ida`.

import { MobileBgApiClient, classifyStoredId, listingIdFromPublish } from './client.js';

export type PictureIdStop = {
  status: 'NEEDS_PUBLISHING' | 'NEEDS_HUMAN_REVIEW';
  stage: string;
  listing_id: string | null;
  // The stored id must be dropped, so a later run does not repeat a call
  // Mobile.bg has already refused.
  clear_stored_id: boolean;
  message: string;
  error: string;
};

export type PictureIdResolution = {
  // The id to attach pictures to, or null when the run must stop first.
  ida: string | null;
  notes: string[];
  stop: PictureIdStop | null;
};

export async function resolvePictureListingId(
  client: MobileBgApiClient,
  options: { storedId: string | null; fields: Record<string, string> },
): Promise<PictureIdResolution> {
  const notes: string[] = [];
  const { storedId, fields } = options;

  if (storedId) {
    const existing = await client.advertLoad(storedId);
    const verdict = classifyStoredId(existing);
    if (verdict === 'reuse') {
      notes.push(`Продължавам със съществуваща обява ${storedId} — няма да създавам втора.`);
      return { ida: storedId, notes, stop: null };
    }
    if (verdict === 'clear') {
      // Mobile.bg itself says this is not a listing of the account. The run
      // stops rather than publishing a second listing on a guess, and the id is
      // cleared so a later run does not repeat the refused call.
      return {
        ida: null, notes,
        stop: {
          status: 'NEEDS_HUMAN_REVIEW', stage: 'PICTURES_ID_CHECK', listing_id: storedId,
          clear_stored_id: true,
          message: `Mobile.bg не познава обява ${storedId}. Снимки не са изпращани. Провери обявите в акаунта, преди да публикуваш отново — иначе може да се дублира.`,
          error: `Mobile.bg не познава обява ${storedId} (${existing.error}). Снимките не са изпратени.`,
        },
      };
    }
    // The check itself failed — a network fault or an expired token. The id is
    // kept, because it may be perfectly good and clearing it would republish.
    return {
      ida: null, notes,
      stop: {
        status: 'NEEDS_PUBLISHING', stage: 'PICTURES_ID_CHECK', listing_id: storedId,
        clear_stored_id: false,
        message: 'Обявата не можа да се провери в Mobile.bg; снимки не са изпращани. Опитай пак.',
        error: `Проверката на обява ${storedId} се провали: ${existing.error}`,
      },
    };
  }

  const publish = await client.advertPub(fields);
  if (!publish.ok) {
    return {
      ida: null, notes,
      stop: {
        status: 'NEEDS_PUBLISHING', stage: 'PUBLISH', listing_id: null,
        clear_stored_id: false,
        message: 'Mobile.bg не прие обявата.',
        error: publish.error || 'Обявата не бе приета.',
      },
    };
  }

  // The id comes from this answer alone. No fallback and no guess: an id taken
  // from anywhere else is exactly what Mobile.bg refused.
  const ida = listingIdFromPublish(publish);
  if (!ida) {
    return {
      ida: null, notes,
      stop: {
        status: 'NEEDS_HUMAN_REVIEW', stage: 'PUBLISH_ID', listing_id: null,
        clear_stored_id: false,
        message: 'Обявата може да е създадена, но отговорът на advertpub не съдържаше валидно ID. Снимки не са изпращани. Провери списъка с обяви в акаунта, преди да опиташ пак, за да не се дублира.',
        error: 'advertpub не върна валидно ID на обявата; без него снимките не се изпращат.',
      },
    };
  }
  notes.push(`Обявата е приета с ID ${ida}.`);
  return { ida, notes, stop: null };
}
