// Tests for the file-removal half of the cleanup worker.
//
// These run against a real temporary directory tree, not a mock: the thing under
// test is filesystem behaviour (what gets removed, what is left alone, what
// happens when the root is wrong), and a mock would only assert the mock.

import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDraftFiles, safeSegment, removeDirectory } from '../src/cleanup.js';

const exists = async (path: string) => Boolean(await stat(path).catch(() => null));

async function makeWebRoot(): Promise<{ root: string; pictures: string }> {
  const root = await mkdtemp(join(tmpdir(), 'aicc-cleanup-test-'));
  const pictures = join(root, 'mobilebg-pictures');
  await mkdir(pictures, { recursive: true });
  return { root, pictures };
}

const DRAFT = '79aab858-d14b-45f6-a6b9-3732aa1bae13';

async function testRemovesOnlyThisDraftsPictures() {
  const { root, pictures } = await makeWebRoot();
  const mine = join(pictures, DRAFT);
  const other = join(pictures, '10ce58eb-7c87-47b9-ad26-48de4c75149f');
  await mkdir(mine, { recursive: true });
  await mkdir(other, { recursive: true });
  await writeFile(join(mine, 'image-1.jpg'), Buffer.alloc(1200, 1));
  await writeFile(join(mine, 'image-2.jpg'), Buffer.alloc(800, 2));
  await writeFile(join(other, 'image-1.jpg'), Buffer.alloc(50, 3));
  // A file that belongs to the site itself must never be touched.
  await writeFile(join(root, 'index.html'), '<html></html>');

  const screenshots = await mkdtemp(join(tmpdir(), 'aicc-shots-'));
  const shot = join(screenshots, 'mobile-bg-job-1.png');
  const unrelatedShot = join(screenshots, 'mobile-bg-someone-elses.png');
  await writeFile(shot, Buffer.alloc(10, 9));
  await writeFile(unrelatedShot, Buffer.alloc(10, 9));

  const result = await cleanDraftFiles({
    draftId: DRAFT,
    picturesRoot: pictures,
    screenshotDir: screenshots,
    jobIds: ['job-1'],
  });

  assert.equal(result.failed, false, result.error_message || '');
  assert.equal(result.pictures_removed, true);
  assert.equal(result.picture_bytes, 2000, 'bytes counted from the real files');
  assert.equal(result.screenshots_removed, 1);

  assert.equal(await exists(mine), false, 'own picture directory is gone');
  assert.equal(await exists(other), true, 'another draft keeps its pictures');
  assert.equal(await exists(join(root, 'index.html')), true, 'the site is untouched');
  assert.equal(await exists(shot), false, 'own screenshot is gone');
  assert.equal(await exists(unrelatedShot), true, 'another screenshot stays');
  console.log('ok - removes only this draft\'s pictures and screenshots');
}

async function testMissingDirectoryIsNotAFailure() {
  const { pictures } = await makeWebRoot();
  const screenshots = await mkdtemp(join(tmpdir(), 'aicc-shots-'));
  const result = await cleanDraftFiles({
    draftId: DRAFT,
    picturesRoot: pictures,
    screenshotDir: screenshots,
  });
  assert.equal(result.failed, false, 'a draft that never reached the picture step is normal');
  assert.equal(result.pictures_removed, false);
  assert.equal(result.picture_bytes, 0);
  console.log('ok - a draft with no picture directory is not an error');
}

async function testRejectsUnsafeId() {
  const { root, pictures } = await makeWebRoot();
  await writeFile(join(root, 'index.html'), '<html></html>');

  for (const bad of ['..', '../../etc', 'a/../..', '', 'has space', '7829; rm -rf /']) {
    const result = await cleanDraftFiles({
      draftId: bad,
      picturesRoot: pictures,
      screenshotDir: tmpdir(),
    });
    assert.equal(result.failed, true, `expected ${JSON.stringify(bad)} to be refused`);
    assert.equal(result.pictures_removed, false);
    assert.equal(await exists(join(root, 'index.html')), true, 'nothing was deleted');
    assert.equal(await exists(pictures), true, 'the pictures root survives');
  }
  console.log('ok - a malformed draft id deletes nothing');
}

async function testSegmentMatchesPublisher() {
  // The directory the API publisher writes is `safeSegment(draftId)`. If the two
  // implementations ever disagree, cleanup would silently remove nothing.
  assert.equal(safeSegment(DRAFT), DRAFT);
  assert.equal(safeSegment('a-b_c'), 'a-b_c');
  assert.equal(safeSegment('a/b'), 'ab');
  assert.equal(safeSegment('a.b'), 'ab');
  console.log('ok - segment derivation matches the publisher');
}

async function testRemoveDirectoryReportsBytesOnce() {
  const { pictures } = await makeWebRoot();
  const target = join(pictures, 'x');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'a.jpg'), Buffer.alloc(300, 1));
  const first = await removeDirectory(target);
  assert.equal(first.removed, true);
  assert.equal(first.bytes, 300);
  const second = await removeDirectory(target);
  assert.equal(second.removed, false, 'already gone, and that is not an error');
  console.log('ok - directory removal is idempotent');
}

async function main() {
  await testRemovesOnlyThisDraftsPictures();
  await testMissingDirectoryIsNotAFailure();
  await testRejectsUnsafeId();
  await testSegmentMatchesPublisher();
  await testRemoveDirectoryReportsBytesOnce();
  console.log('\nAll cleanup tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
