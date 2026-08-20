import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateTargetedVideoAiNote,
  planVideoAiNoteInvariant,
} from '../lib/videoDerivedAiNote';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260819000001_video_ai_note_guarantee.sql'),
  'utf8',
);
const finalizer = fs.readFileSync(
  path.join(root, 'supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
const worker = fs.readFileSync(
  path.join(root, 'services/media-worker/src/pipeline/runMediaTask.ts'),
  'utf8',
);

const instagram = {
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/reel/source-a/',
};

// Canonical provenance is data-based, not route-based. Legacy/future `link`
// and null labels remain eligible when a real source URL is attached.
assert.equal(planVideoAiNoteInvariant(instagram, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant(instagram, '  \n '), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant(instagram, 'Existing useful cue.'), 'already_satisfied');
assert.equal(planVideoAiNoteInvariant({ ...instagram, source_type: 'manual' }, null), 'not_video_derived');
assert.equal(planVideoAiNoteInvariant({ source_type: 'link', source_url: instagram.source_url }, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant({ source_type: null, source_url: instagram.source_url }, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant({ source_type: 'instagram', source_url: ' ' }, null), 'not_video_derived');

const places = [
  {
    name: 'Pasta Sisters',
    memoryCue: 'That spicy vodka rigatoni looked ridiculous.',
    memoryCueEvidence: [{ source: 'speech' as const, value: 'spicy vodka rigatoni' }],
  },
  {
    name: 'Courtyard Matcha',
    memoryCue: 'Quiet courtyard and matcha drinks looked unreal.',
    memoryCueEvidence: [{ source: 'frame' as const, value: 'quiet courtyard and matcha drinks' }],
  },
  {
    name: 'Cliff Cove',
    memoryCue: 'Cliffside swimming below the coastal trail looked wild.',
    memoryCueEvidence: [{ source: 'frame' as const, value: 'cliffside swimming below the coastal trail' }],
  },
];

// Strong auto-save, confirmation, picker, manual fallback, and retry completion
// all converge through the same final-place evaluator.
for (const finalPlaceName of ['Pasta Sisters', 'Courtyard Matcha', 'Cliff Cove']) {
  const result = evaluateTargetedVideoAiNote({ finalPlaceName, places });
  assert.equal(result.status, 'generated');
  assert.equal(result.targetMatch, 'matched');
  assert.ok(result.note?.endsWith('.'));
}

// Multi-place posts receive independently scoped notes; selecting only 2/3
// asks for only those final targets and never copies a post-level cue.
const selected = ['Pasta Sisters', 'Cliff Cove'].map((finalPlaceName) =>
  evaluateTargetedVideoAiNote({ finalPlaceName, places }).note,
);
assert.deepEqual(selected, [
  'That spicy vodka rigatoni looked ridiculous.',
  'Cliffside swimming below the coastal trail looked wild.',
]);
assert.notEqual(selected[0], selected[1]);

// Correction safety: Place B cannot inherit a valid Place A note. The task is
// targeted at B and must await/regenerate B-scoped evidence.
const corrected = evaluateTargetedVideoAiNote({
  finalPlaceName: 'Correct Place B',
  places: [places[0]!],
});
assert.equal(corrected.note, null);
assert.equal(corrected.targetMatch, 'missing');

// Ambiguous same-name evidence is withheld instead of guessing across slots.
const ambiguous = evaluateTargetedVideoAiNote({
  finalPlaceName: 'Pasta Sisters',
  places: [places[0]!, { ...places[0] }],
});
assert.equal(ambiguous.note, null);
assert.equal(ambiguous.targetMatch, 'ambiguous');

// Blank model output is a failure, never completion.
const blank = evaluateTargetedVideoAiNote({
  finalPlaceName: 'Pasta Sisters',
  places: [{ ...places[0], memoryCue: ' \n ' }],
});
assert.equal(blank.note, null);
assert.equal(blank.status, 'not_requested');

// Persistence-boundary coverage and idempotency: every saved_places insert or
// provenance/note change reaches one trigger; one partial unique task per final
// saved place prevents duplicate provider work.
assert.match(migration, /after insert or update of place_id, source_url, source_type, ai_note[\s\S]+execute function public\.ensure_video_ai_note_task\(\)/i);
assert.match(migration, /unique index if not exists share_media_tasks_ai_note_saved_place_uidx[\s\S]+where task_kind = 'ai_note_enrichment'/i);
assert.match(migration, /on conflict \(saved_place_id\) where task_kind = 'ai_note_enrichment'/i);
assert.match(migration, /coalesce\(length\(trim\(new\.ai_note\)\), 0\) = 0/i);
assert.match(migration, /video_derived_saved_places_without_ai_note/i);
assert.match(migration, /before update of place_id[\s\S]+execute function public\.invalidate_video_ai_note_on_place_change\(\)/i);
assert.match(migration, /new\.ai_note := null/i);

// Hybrid convergence: save is never rolled back for AI; transient finalizer
// failures are requeued with bounded existing attempts, while terminal missing
// evidence remains observable.
assert.match(worker, /task\.task_kind === 'ai_note_enrichment'[\s\S]+media\.code === 'finalizer_unavailable'[\s\S]+requeueTask/i);
assert.match(finalizer, /failure_code: failureCode\.slice\(0, 200\)/);
assert.match(finalizer, /generationOutcome: noteResult\.status/);
assert.match(finalizer, /retryCount: Number\(task\.attempts\)/);

// Data-integrity contract: only ai_note is written, with final id/user/source
// and observed blank-value guards. `notes` is selected for audit but untouched.
const guaranteeStart = finalizer.indexOf('async function finalizeVideoAiNoteTask');
const guaranteeEnd = finalizer.indexOf('/**\n * Enrich a metadata-auto-saved row', guaranteeStart);
const guaranteeBody = finalizer.slice(guaranteeStart, guaranteeEnd);
assert.match(guaranteeBody, /\.update\(\{ ai_note: noteResult\.note \}\)/);
assert.match(guaranteeBody, /\.eq\('source_url', representedSource\)/);
assert.doesNotMatch(guaranteeBody, /\.update\(\{[^}]*\bnotes\s*:/s);
assert.match(guaranteeBody, /userNotePreserved: true/);

console.log('PASS video-derived saved places converge through one durable, final-place-scoped AI-note invariant');
