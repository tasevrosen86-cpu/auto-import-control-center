// Prepares the selected pictures so the API can fetch them from our own host.
//
// The API does not accept uploads. `advertpicts` is given file paths and
// Mobile.bg downloads them itself from the host registered against the account,
// so three things have to be true before a picture can be sent:
//
//   * the file must be reachable over HTTPS under the registered domain — hence
//     the copy into the public web root;
//   * the path sent must be the part *after* that domain, because the domain is
//     fixed server-side and is not repeated in the request;
//   * the name must end in `.jpg` or `.jpeg`, so a source served as .webp or
//     .png has to be re-encoded before it can go out.
//
// Re-encoding is done with sharp when it is present. It is declared as an
// optional dependency on purpose: if the native build is unavailable the
// service still runs, JPEG sources still publish, and every non-JPEG is reported
// by name instead of being sent as something Mobile.bg would reject.

import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

export type SourceImage = {
  source_url: string | null;
  local_path: string | null;
  is_selected: boolean;
  is_main: boolean;
  display_order: number;
};

export type PreparedPicture = {
  // The name only, e.g. "image-1.jpg".
  filename: string;
  // What is sent to the API: the part below the registered domain.
  path: string;
  source_url: string;
  bytes: number;
  converted_from: string | null;
  is_main: boolean;
};

export type SkippedPicture = {
  source_url: string | null;
  reason: string;
};

export type PreparedBatch = {
  pictures: PreparedPicture[];
  skipped: SkippedPicture[];
  directory: string | null;
  directory_path: string | null;
};

const MOBILE_BG_MAX_PHOTOS = 17;
const MOBILE_BG_FILENAME = /^[a-zA-Z0-9_\-/]{1,100}\.(?:jpg|jpeg)$/;

// Mobile.bg checks the extension, and its error text explicitly allows only
// [a-zA-Z0-9_-/]{1,100}. A draft id is a UUID, whose hyphens are allowed, but
// the directory is sanitised anyway so the claim holds by construction.
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function extensionOf(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

// A successful conversion is only trusted if the bytes really are a JPEG: a
// truncated download or an error page saved as an image would otherwise be
// published as a broken photo.
async function toJpeg(buffer: Buffer): Promise<Buffer | null> {
  if (isJpeg(buffer)) return buffer;
  try {
    const mod = await import('sharp');
    const sharp = (mod.default ?? mod) as unknown as (input: Buffer) => {
      jpeg: (opts?: Record<string, unknown>) => { toBuffer: () => Promise<Buffer> };
      rotate: () => { jpeg: (opts?: Record<string, unknown>) => { toBuffer: () => Promise<Buffer> } };
    };
    // `rotate()` with no argument applies the EXIF orientation, so a portrait
    // photo from a phone is not published sideways.
    const converted = await sharp(buffer).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return isJpeg(converted) ? converted : null;
  } catch {
    return null;
  }
}

export type PrepareOptions = {
  draftId: string;
  // Absolute path of the public web root, e.g. /var/www/html. The pictures go
  // into a subdirectory of it so a deploy that copies over the root leaves them
  // alone.
  publicRoot: string;
  // URL path prefix that maps to `publicRoot`, e.g. "" for the domain root.
  publicPrefix?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPhotos?: number;
  keepExisting?: boolean;
};

// Downloads the selected pictures into the public web root and returns the paths
// to hand to the API. The draft is never modified: a failure here leaves the
// draft exactly as it was, so the run can be retried after fixing the cause.
export async function preparePictures(
  images: SourceImage[],
  options: PrepareOptions,
): Promise<PreparedBatch> {
  const {
    draftId,
    publicRoot,
    publicPrefix = '',
    fetchImpl = fetch,
    timeoutMs = Number(process.env.MOBILE_BG_API_IMAGE_TIMEOUT_MS || 45000),
    maxPhotos = MOBILE_BG_MAX_PHOTOS,
    keepExisting = false,
  } = options;

  const eligible = images
    .filter(image => image.is_selected)
    .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.display_order - b.display_order);
  const selected = eligible.slice(0, maxPhotos);

  const skipped: SkippedPicture[] = [];
  if (eligible.length > maxPhotos) {
    skipped.push({
      source_url: null,
      reason: `Mobile.bg приема до ${maxPhotos} снимки; пропуснати ${eligible.length - maxPhotos} от ${eligible.length} избрани.`,
    });
  }
  if (selected.length === 0) {
    return { pictures: [], skipped, directory: null, directory_path: null };
  }

  const segment = safeSegment(draftId);
  const directory = `mobilebg-pictures/${segment}`;
  const directoryPath = join(publicRoot, 'mobilebg-pictures', segment);
  if (keepExisting) {
    // A retry of the picture step alone reuses what a previous attempt already
    // downloaded, so a transient Mobile.bg failure does not re-fetch every file.
    const existing = await readdir(directoryPath).catch(() => null);
    if (existing && existing.length > 0) {
      const pictures: PreparedPicture[] = existing
        .filter(name => MOBILE_BG_FILENAME.test(name))
        .sort()
        .map((name, index) => ({
          filename: name,
          path: `${publicPrefix}/${directory}/${name}`.replace(/\/{2,}/g, '/'),
          source_url: '',
          bytes: 0,
          converted_from: null,
          is_main: index === 0,
        }));
      if (pictures.length > 0) return { pictures, skipped, directory, directory_path: directoryPath };
    }
  }

  await rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(directoryPath, { recursive: true });

  const pictures: PreparedPicture[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const image = selected[index];
    const position = index + 1;
    const label = `Снимка #${position}`;
    try {
      let buffer: Buffer;
      if (image.local_path && image.local_path.startsWith('/')) {
        // Already on this machine. Read rather than fetch, so a local path that
        // is not served over HTTP still works.
        const { readFile } = await import('node:fs/promises');
        buffer = await readFile(image.local_path);
      } else if (image.source_url) {
        const response = await fetchImpl(image.source_url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
          skipped.push({ source_url: image.source_url, reason: `${label}: източникът върна HTTP ${response.status}.` });
          continue;
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        skipped.push({ source_url: null, reason: `${label}: липсва адрес и липсва локален файл.` });
        continue;
      }
      if (buffer.length === 0) {
        skipped.push({ source_url: image.source_url, reason: `${label}: файлът е празен.` });
        continue;
      }
      const from = extensionOf(image.source_url || image.local_path || '');
      const jpeg = await toJpeg(buffer);
      if (!jpeg) {
        skipped.push({
          source_url: image.source_url,
          reason: `${label}: форматът „${from || 'неизвестен'}“ не можа да се преобразува в .jpg. Mobile.bg приема само .jpg/.jpeg.`,
        });
        continue;
      }
      const filename = `image-${position}.jpg`;
      await writeFile(join(directoryPath, filename), jpeg);
      pictures.push({
        filename,
        path: `${publicPrefix}/${directory}/${filename}`.replace(/\/{2,}/g, '/'),
        source_url: image.source_url || image.local_path || '',
        bytes: jpeg.length,
        converted_from: isJpeg(buffer) ? null : from || 'неизвестен',
        is_main: image.is_main || position === 1,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'непозната грешка';
      skipped.push({ source_url: image.source_url, reason: `${label}: ${message}` });
    }
  }

  return { pictures, skipped, directory, directory_path: directoryPath };
}

// Verifies a prepared file is publicly readable at the path that will be sent.
// A file written but not served — wrong root, blocked extension, missing
// permission — would make Mobile.bg fail with a message that names no cause, so
// the check happens here where the reason is still known.
export async function verifyPubliclyReadable(
  baseUrl: string,
  picture: PreparedPicture,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const url = `${baseUrl.replace(/\/+$/, '')}${picture.path.startsWith('/') ? '' : '/'}${picture.path}`;
  try {
    const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (response.ok) return { ok: true, status: response.status, error: null };
    // Some static servers answer HEAD with 405 while serving GET normally, so a
    // range request is used to confirm without downloading the whole file.
    const ranged = await fetchImpl(url, { headers: { Range: 'bytes=0-2' }, signal: AbortSignal.timeout(15000) });
    if (ranged.ok || ranged.status === 206) return { ok: true, status: ranged.status, error: null };
    return {
      ok: false, status: ranged.status,
      error: `Файлът не е публично достъпен (HTTP ${ranged.status}) на ${picture.path}.`,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'непозната грешка';
    return { ok: false, status: null, error: `Проверката на ${picture.path} се провали: ${message}` };
  }
}

export function isAcceptableFilename(path: string): boolean {
  return MOBILE_BG_FILENAME.test(basename(path));
}

export async function directorySize(path: string): Promise<number> {
  const names = await readdir(path).catch(() => [] as string[]);
  let total = 0;
  for (const name of names) {
    const info = await stat(join(path, name)).catch(() => null);
    if (info?.isFile()) total += info.size;
  }
  return total;
}
