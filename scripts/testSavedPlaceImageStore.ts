import assert from 'node:assert/strict';

import {
  acquirePlacePresentationImage,
  clearSavedPlaceImages,
  isUsableSavedPlaceImage,
  persistSavedPlaceImage,
  removeSavedPlaceImage,
  resetSavedPlaceImageStoreForTests,
  savedPlaceImageDirectory,
  savedPlaceImageUri,
  type SavedPlaceImageStoreDependencies,
} from '../lib/savedPlaceImageStore';

async function run() {
  const files = new Map<string, number>();
  const removed: string[] = [];
  let downloads = 0;
  let copies = 0;
  const deps: SavedPlaceImageStoreDependencies = {
    documentDirectory: 'file://documents/',
    cacheDirectory: 'file://cache/',
    getInfo: async (uri) => ({ exists: files.has(uri), isDirectory: false, size: files.get(uri) }),
    makeDirectory: async () => undefined,
    download: async (_remote, local) => {
      downloads += 1;
      await Promise.resolve();
      files.set(local, 256);
      return { uri: local, status: 200 };
    },
    copy: async (from, to) => {
      copies += 1;
      const size = files.get(from);
      if (!size) throw new Error('missing_source');
      files.set(to, size);
    },
    move: async (from, to) => {
      const size = files.get(from);
      if (!size) throw new Error('missing_source');
      files.delete(from);
      files.set(to, size);
    },
    remove: async (uri) => {
      removed.push(uri);
      for (const key of [...files.keys()]) {
        if (key === uri || (uri.endsWith('/') && key.startsWith(uri))) files.delete(key);
      }
    },
  };

  assert.equal(
    savedPlaceImageUri('file://documents/', 'owner-a', 'saved-a'),
    'file://documents/nearr/saved-place-images/owner-a/saved-a/hero.jpg',
  );
  const [shown, one, coalesced] = await Promise.all([
    acquirePlacePresentationImage('https://photo.test/a', deps),
    persistSavedPlaceImage({ userId: 'owner-a', savedPlaceId: 'saved-a', sourceUri: 'https://photo.test/a' }, deps),
    persistSavedPlaceImage({ userId: 'owner-a', savedPlaceId: 'saved-a', sourceUri: 'https://photo.test/a' }, deps),
  ]);
  assert.ok(shown?.startsWith('file://cache/'));
  assert.equal(one, coalesced);
  assert.equal(downloads, 1, 'active display and save-time persistence share one download');
  assert.equal(await isUsableSavedPlaceImage(one, deps), true);

  files.set('file://incoming/source.jpg', 128);
  const copiesBeforeLocal = copies;
  const copied = await persistSavedPlaceImage({
    userId: 'owner-a', savedPlaceId: 'saved-b', sourceUri: 'file://incoming/source.jpg',
  }, deps);
  assert.equal(copies, copiesBeforeLocal + 1);
  assert.equal(await isUsableSavedPlaceImage(copied, deps), true);

  await removeSavedPlaceImage('owner-a', 'saved-a', deps);
  assert.equal(files.has(savedPlaceImageUri('file://documents/', 'owner-a', 'saved-a')), false);
  assert.ok(removed.includes(savedPlaceImageDirectory('file://documents/', 'owner-a', 'saved-a')));

  await clearSavedPlaceImages('owner-a', deps);
  assert.ok(removed.includes(savedPlaceImageDirectory('file://documents/', 'owner-a')));

  const failing: SavedPlaceImageStoreDependencies = {
    ...deps,
    download: async () => { throw new Error('disk_full'); },
  };
  const failed = await persistSavedPlaceImage({
    userId: 'owner-b', savedPlaceId: 'saved-c', sourceUri: 'https://photo.test/c',
  }, failing);
  assert.equal(failed, null, 'disk failure never fails the durable place save');

  resetSavedPlaceImageStoreForTests();
  console.log('PASS saved-place image persistence, coalescing, validation, deletion, account cleanup, and failure safety');
}

void run().catch((error) => {
  resetSavedPlaceImageStoreForTests();
  console.error(error);
  process.exitCode = 1;
});
