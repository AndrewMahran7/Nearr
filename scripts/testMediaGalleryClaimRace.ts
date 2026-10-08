import assert from 'node:assert/strict';
import { promotePlaceVideoMedia } from '../supabase/functions/process-share-jobs/placeVideoMedia';

async function main() {
  const objects = new Map<string, string>();
  let frameBytes = 'first-current-frame';
  let currentRow: Record<string, unknown> | null = null;
  let obsolete = false;
  const admin = {
    storage: { from: () => ({
      download: async () => ({ data: new Blob([frameBytes]), error: null }),
      upload: async (path: string, data: Blob) => { objects.set(path, await data.text()); return { error: null }; },
    }) },
    from: () => {
      const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: currentRow }) };
      return query;
    },
  };
  const args = {
    admin, placeId: 'fixture-place', sourceUrl: 'https://www.instagram.com/reel/Fixture123/',
    platform: 'instagram', publicAccessVerified: true,
    evidenceFrames: [{ id: 'frame', timestampSeconds: 1, storagePath: 'u/j/t/frame.jpg' }],
    persist: async (row: Record<string, unknown>) => {
      if (obsolete) return { error: { message: 'obsolete_media_claim' } };
      currentRow = row;
      return { error: null };
    },
  };
  assert.equal(await promotePlaceVideoMedia(args), true);
  const committedPath = currentRow!['representative_frame_storage_path'] as string;
  assert.equal(objects.get(committedPath), 'first-current-frame');
  // Old callback may upload after a newer state wins, but cannot mutate its bytes/pointer.
  obsolete = true;
  frameBytes = 'obsolete-different-frame';
  assert.equal(await promotePlaceVideoMedia(args), false);
  assert.equal(currentRow!['representative_frame_storage_path'], committedPath);
  assert.equal(objects.get(committedPath), 'first-current-frame');
  assert.equal(objects.size, 2, 'unreferenced stale bytes have their own immutable object key');
  obsolete = false;
  frameBytes = 'first-current-frame';
  assert.equal(await promotePlaceVideoMedia(args), true);
  assert.equal(objects.size, 2, 'same bytes reuse their content-addressed object');
  console.log('PASS gallery claim race: stale upload cannot replace current image bytes/pointer; same bytes deduplicate');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
