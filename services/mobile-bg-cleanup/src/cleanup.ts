// The file-removal half of the cleanup worker, kept separate from the queue
// handling so it can be tested against a real temporary directory instead of a
// mock. `index.ts` is only the runner.

import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Mirrors `safeSegment` in the API publisher, which is what names the directory.
export function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export type DirectoryRemoval = { removed: boolean; bytes: number };

export async function removeDirectory(path: string): Promise<DirectoryRemoval> {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isDirectory()) return { removed: false, bytes: 0 };
  let bytes = 0;
  const names = await readdir(path).catch(() => [] as string[]);
  for (const name of names) {
    const fileInfo = await stat(join(path, name)).catch(() => null);
    if (fileInfo?.isFile()) bytes += fileInfo.size;
  }
  await rm(path, { recursive: true, force: true });
  return { removed: true, bytes };
}

export async function removeFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;
  await rm(path, { force: true });
  return true;
}

export type CleanupResult = {
  pictures_removed: boolean;
  picture_bytes: number;
  screenshots_removed: number;
  notes: string[];
  failed: boolean;
  error_message: string | null;
};

// Removes every server-side file that belonged to one draft: its picture
// directory, and the browser screenshots keyed by its old job ids.
//
// The id is re-derived here rather than trusted from the queue. A queue row is
// written by the database function, but this worker is the last thing between a
// bad value and `rm -r` on the web root, so it checks anyway: if the id is not
// clean, nothing is deleted.
export async function cleanDraftFiles(options: {
  draftId: string;
  picturesRoot: string;
  screenshotDir: string;
  screenshotPrefix?: string;
  jobIds?: string[];
}): Promise<CleanupResult> {
  const {
    draftId,
    picturesRoot,
    screenshotDir,
    screenshotPrefix = 'mobile-bg-',
    jobIds = [],
  } = options;

  const notes: string[] = [];
  const result: CleanupResult = {
    pictures_removed: false,
    picture_bytes: 0,
    screenshots_removed: 0,
    notes,
    failed: false,
    error_message: null,
  };

  const segment = safeSegment(draftId);
  if (!segment || segment !== draftId) {
    result.failed = true;
    result.error_message = `Невалиден идентификатор на чернова: ${draftId}`;
    return result;
  }

  try {
    const directory = resolve(picturesRoot, segment);
    const removal = await removeDirectory(directory);
    result.pictures_removed = removal.removed;
    result.picture_bytes = removal.bytes;
    notes.push(removal.removed
      ? `Изтрити снимки в ${directory} (${removal.bytes} байта).`
      : 'Няма запазени снимки за черновата.');

    for (const jobId of jobIds) {
      const screenshot = join(screenshotDir, `${screenshotPrefix}${safeSegment(jobId)}.png`);
      if (await removeFile(screenshot)) result.screenshots_removed += 1;
    }
    if (result.screenshots_removed > 0) {
      notes.push(`Изтрити ${result.screenshots_removed} временни скрийншота.`);
    }
  } catch (cause) {
    result.failed = true;
    result.error_message = cause instanceof Error ? cause.message : 'непозната грешка';
  }

  return result;
}
