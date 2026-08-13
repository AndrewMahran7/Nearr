import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildShareJobCandidatePayload, normalizeMentionSlots } from '../lib/shareJobResult';

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

console.log('PASS auto/manual AI-note persistence and non-fatal finalization contracts');
