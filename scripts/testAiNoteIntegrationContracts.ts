import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { savedPlaceNarrative, whySavedDisplay } from '../lib/placeDetailUi';
import { planSavedPlaceEnrichment } from '../lib/savedPlaceSourceMerge';
import {
  readSavedPlaceFromCache,
  setSavedPlacesCacheStore,
  writeSavedPlacesCache,
} from '../lib/savedPlacesCache';
import { buildShareJobCandidatePayload, normalizeMentionSlots } from '../lib/shareJobResult';
import type { SavedPlaceWithPlace } from '../types';

const cue = 'Try the matcha flight and strawberry cream latte.';
const payload = buildShareJobCandidatePayload(
  [{ googlePlaceId: 'g1', name: 'Matcha House', latitude: 1, longitude: 2, aiNote: cue }],
  [{
    mentionId: 'm1',
    displayName: 'Matcha House',
    outcome: 'verified_single',
    aiNote: cue,
    candidates: [{ googlePlaceId: 'g1', name: 'Matcha House', latitude: 1, longitude: 2, aiNote: cue }],
  }],
);
assert.equal(payload.candidates[0]!.aiNote, cue, 'manual candidate preserves the generated note');
assert.equal(normalizeMentionSlots(payload.mentionSlots)[0]!.aiNote, cue, 'logical slot preserves its own note');

const root = process.cwd();
const finalizer = readFileSync(join(root, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
const candidateSave = readFileSync(join(root, 'services/shareJobCandidateSave.ts'), 'utf8');
const savedService = readFileSync(join(root, 'services/savedPlacesService.ts'), 'utf8');
assert.match(finalizer, /persistAiNoteSupplementally/, 'auto-save stores an available note supplementally');
assert.doesNotMatch(finalizer, /throw new Error\(`media_ai_note_save_failed/, 'AI-note failure cannot fail place finalization');
assert.match(finalizer, /supplemental ai note save failed/, 'supplemental failure is diagnostic only');
assert.match(candidateSave, /aiNote: candidate\.aiNote \?\? null/, 'queue confirmation forwards its existing note');
assert.match(candidateSave, /aiNote: args\.aiNote \?\? undefined/, 'missing note cannot erase an existing saved note');
assert.match(savedService, /ai_note: input\.aiNote \?\? null/, 'new manual saves persist the forwarded note');
assert.match(savedService, /notes: input\.notes \?\? null/, 'new saves never put generated filler in the user field');


// ---------------------------------------------------------------------------
// Precedence. `notes` is the user's; `ai_note` is provenance. They live in
// separate columns and one surface renders `notes ?? ai_note`.
// ---------------------------------------------------------------------------

assert.deepEqual(
  whySavedDisplay({ notes: 'my own words', ai_note: cue }),
  { text: 'my own words', origin: 'user', seedFromSourceNote: false },
  'a user note wins the display and is never blended with the cue',
);
assert.deepEqual(
  whySavedDisplay({ notes: null, ai_note: cue }),
  { text: cue, origin: 'source', seedFromSourceNote: true },
  'with no user note the cue is what Place Detail renders',
);
assert.deepEqual(
  whySavedDisplay({ notes: '   ', ai_note: cue }),
  { text: cue, origin: 'source', seedFromSourceNote: true },
  'a whitespace-only note is not a user note',
);
assert.deepEqual(
  whySavedDisplay({ notes: null, ai_note: null }),
  { text: null, origin: null, seedFromSourceNote: false },
  'neither note present renders nothing — never invented placeholder prose',
);
assert.equal(
  savedPlaceNarrative({ notes: 'mine', ai_note: cue }).canPromoteSourceNote,
  false,
  'the cue is not offered as a replacement once the user has written their own',
);

// ---------------------------------------------------------------------------
// Enrichment on the already-saved path. Additive only.
// ---------------------------------------------------------------------------

const samePost = { sourceUrl: 'https://x.test/p/1', sourceType: 'instagram', aiNote: cue };

const attachesToEmptySlot = planSavedPlaceEnrichment(
  { source_url: null, source_type: null, ai_note: null },
  samePost,
);
assert.equal(attachesToEmptySlot.aiNote, 'attached');
assert.deepEqual(attachesToEmptySlot.aiNotePatch?.patch, { ai_note: cue });
assert.ok(
  !Object.prototype.hasOwnProperty.call(attachesToEmptySlot.aiNotePatch?.patch ?? {}, 'notes'),
  'attaching a cue never writes the user note column',
);

const keepsEarlierCue = planSavedPlaceEnrichment(
  { source_url: 'https://x.test/p/1', source_type: 'instagram', ai_note: 'an earlier cue' },
  samePost,
);
assert.equal(keepsEarlierCue.aiNote, 'existing_note_preserved');
assert.equal(keepsEarlierCue.aiNotePatch, null, 'an existing cue is not regenerated over');

const differentPost = planSavedPlaceEnrichment(
  { source_url: 'https://x.test/p/OTHER', source_type: 'instagram', ai_note: null },
  samePost,
);
assert.equal(differentPost.aiNote, 'withheld_unrepresented_source');
assert.equal(
  differentPost.aiNotePatch,
  null,
  'a cue never captions a post the saved place does not represent',
);

const noCueOffered = planSavedPlaceEnrichment(
  { source_url: null, source_type: null, ai_note: 'kept' },
  { sourceUrl: 'https://x.test/p/1', sourceType: 'instagram', aiNote: null },
);
assert.equal(noCueOffered.aiNote, 'no_incoming_note');
assert.equal(noCueOffered.aiNotePatch, null, 'a save with no evidence cannot blank an existing cue');

// ---------------------------------------------------------------------------
// Offline cache round trip. Place Detail reads this copy when a fetch fails,
// so a cue that survives Postgres but not AsyncStorage is still a missing note.
// ---------------------------------------------------------------------------

async function testCacheRoundTrip(): Promise<void> {
  const memory = new Map<string, string>();
  setSavedPlacesCacheStore({
    async getItem(key) { return memory.get(key) ?? null; },
    async multiSet(pairs) { for (const [key, value] of pairs) memory.set(key!, value!); },
    async multiRemove(keys) { for (const key of keys) memory.delete(key); },
  });
  const row = {
    id: 'saved-1',
    user_id: 'user-1',
    notes: null,
    ai_note: cue,
    place: { id: 'place-1', name: 'Matcha House' },
  } as unknown as SavedPlaceWithPlace;
  await writeSavedPlacesCache('user-1', [row]);
  const restored = await readSavedPlaceFromCache('user-1', 'saved-1');
  assert.equal(restored?.ai_note, cue, 'the cue survives the offline snapshot');
  assert.deepEqual(
    whySavedDisplay({ notes: restored?.notes, ai_note: restored?.ai_note }),
    { text: cue, origin: 'source', seedFromSourceNote: true },
    'a cache-hydrated row renders exactly like a freshly fetched one',
  );
  setSavedPlacesCacheStore(null);
}

// ---------------------------------------------------------------------------
// Read/query and observability contracts.
// ---------------------------------------------------------------------------

assert.match(
  savedService,
  /\.select\('id, source_url, source_type, ai_note, place:places\(\*\)'\)/,
  'the dedupe lookup reads ai_note, so an existing cue is visible to the merge',
);
assert.match(
  finalizer,
  /event: 'ai_note_generation'/,
  'cue outcomes are observable rather than a silent null',
);
assert.match(
  finalizer,
  /status: noteResult\.status/,
  'the log carries the bounded status code',
);
assert.doesNotMatch(
  finalizer,
  /event: 'ai_note_generation'[\s\S]{0,400}(?:memoryCue|proposedNote|caption)/,
  'note diagnostics never carry cue, caption, or user text',
);

void testCacheRoundTrip().then(() => {
  console.log('PASS auto/manual AI-note persistence and non-fatal finalization contracts');
});
