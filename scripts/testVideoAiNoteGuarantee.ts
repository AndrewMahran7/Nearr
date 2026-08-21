import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  classifyVideoAiNoteFailure,
  evaluateTargetedVideoAiNote,
  planVideoAiNoteInvariant,
  savedPlaceIdentityChanged,
  shouldRefreshVideoAiNoteOnDetailOpen,
  videoAiNoteCallbackMatchesTarget,
  videoSourcePlatform,
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
const taskDb = fs.readFileSync(
  path.join(root, 'services/media-worker/src/db/tasks.ts'),
  'utf8',
);
const initialSchema = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260426000001_init_schema.sql'),
  'utf8',
);
const mapScreen = fs.readFileSync(
  path.join(root, 'app/(tabs)/map.tsx'),
  'utf8',
);

const instagram = {
  source_type: 'instagram',
  source_url: 'https://www.instagram.com/reel/source-a/',
};

// Canonical provenance is data-based, not route-based. Explicit normalized
// platforms are authoritative; legacy link/null rows need a social post URL.
assert.equal(planVideoAiNoteInvariant(instagram, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant(instagram, '  \n '), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant(instagram, 'Existing useful cue.'), 'already_satisfied');
assert.equal(planVideoAiNoteInvariant({ ...instagram, source_type: 'manual' }, null), 'not_video_derived');
assert.equal(planVideoAiNoteInvariant({ source_type: 'link', source_url: instagram.source_url }, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant({ source_type: null, source_url: instagram.source_url }, null), 'ensure_enrichment');
assert.equal(planVideoAiNoteInvariant({ source_type: 'instagram', source_url: ' ' }, null), 'not_video_derived');

// A completed async note must become observable from a previously cached
// detail row. One open performs one refresh; an existing note and non-video
// saves never cause extra reads or model work.
assert.equal(shouldRefreshVideoAiNoteOnDetailOpen(instagram, null), true);
assert.equal(shouldRefreshVideoAiNoteOnDetailOpen(instagram, 'Completed async note.'), false);
assert.equal(shouldRefreshVideoAiNoteOnDetailOpen({ source_type: 'manual', source_url: null }, null), false);
assert.match(
  mapScreen,
  /shouldRefreshVideoAiNoteOnDetailOpen\(item, item\.ai_note\)[\s\S]{0,100}void refresh\(\)/,
);

const provenanceCases = [
  ['Instagram reel', 'instagram', 'https://www.instagram.com/reel/abc/', 'instagram'],
  ['Instagram post via legacy link', 'link', 'https://instagram.com/p/abc/', 'instagram'],
  ['Instagram story', 'instagram', 'https://instagram.com/stories/creator/123/', 'instagram'],
  ['TikTok video', 'tiktok', 'https://www.tiktok.com/@creator/video/123', 'tiktok'],
  ['TikTok short legacy', null, 'https://vm.tiktok.com/ZMabc/', 'tiktok'],
  ['Facebook reel', 'facebook', 'https://www.facebook.com/reel/123', 'facebook'],
  ['Facebook watch legacy', 'link', 'https://fb.watch/abc/', 'facebook'],
  ['Facebook post', 'facebook', 'https://facebook.com/creator/posts/123', 'facebook'],
  ['Facebook shared reel', 'facebook', 'https://facebook.com/share/r/abc/', 'facebook'],
  ['YouTube Shorts', 'youtube', 'https://youtube.com/shorts/abc', 'youtube'],
  ['YouTube watch legacy', null, 'https://www.youtube.com/watch?v=abc', 'youtube'],
  ['Snapchat Spotlight', 'snapchat', 'https://www.snapchat.com/spotlight/abc', 'snapchat'],
  ['generic pasted page', 'link', 'https://example.com/best-restaurants', null],
  ['restaurant website', 'link', 'https://restaurant.example/menu', null],
  ['Google Maps URL', 'link', 'https://www.google.com/maps/place/example', null],
  ['legacy Instagram profile', 'link', 'https://instagram.com/somecreator/', null],
  ['explicit Instagram profile', 'instagram', 'https://instagram.com/somecreator/', null],
  ['legacy Snapchat profile', null, 'https://snapchat.com/add/somecreator', null],
  ['explicit Snapchat profile', 'snapchat', 'https://snapchat.com/add/somecreator', null],
  ['empty TikTok short host', 'link', 'https://vm.tiktok.com/', null],
  ['mismatched explicit platform', 'instagram', 'https://example.com/reel/abc', null],
  ['substring spoof from legacy detector', 'instagram', 'https://evilinstagram.com/reel/abc', null],
  ['non-HTTPS source', 'instagram', 'http://instagram.com/reel/abc', null],
  ['unsupported X post', 'link', 'https://x.com/creator/status/123', null],
  ['manual with social URL', 'manual', 'https://instagram.com/reel/abc/', null],
  ['manual no URL', 'manual', null, null],
  ['legacy blank', null, null, null],
] as const;
for (const [label, sourceType, sourceUrl, expected] of provenanceCases) {
  assert.equal(
    videoSourcePlatform({ source_type: sourceType, source_url: sourceUrl }),
    expected,
    label,
  );
}

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

// Dedicated note inference is save-count based, never candidate-count based:
// three picker candidates cost zero before selection, and saving two of three
// recognized places creates exactly two obligations.
const pickerCandidates = places.map((place) => ({ ...place, memoryCue: null, memoryCueEvidence: [] }));
assert.equal(pickerCandidates.filter((place) => place.memoryCue).length, 0);
const selectivelySaved = [places[0]!, places[2]!].map(() =>
  planVideoAiNoteInvariant(instagram, null),
);
assert.deepEqual(selectivelySaved, ['ensure_enrichment', 'ensure_enrichment']);
assert.equal(selectivelySaved.length, 2);

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
const rejected = evaluateTargetedVideoAiNote({
  finalPlaceName: 'Pasta Sisters',
  places: [{
    ...places[0],
    memoryCue: 'A great place worth checking out.',
    memoryCueEvidence: [{ source: 'speech', value: 'great place' }],
  }],
});
assert.equal(rejected.note, null);
assert.equal(rejected.status, 'rejected');
assert.equal(
  classifyVideoAiNoteFailure({ outcome: 'evidence', errorCodes: [], observableEvidenceCount: 2 }),
  'retry_after_generation',
  'validator rejection over real evidence retains a cooled retry obligation',
);

// Provider outages retain an eventual retry obligation; deterministic content
// failures over acquired evidence also remain durable quality retries.
for (const error of [
  'provider_rate_limited',
  'download_timeout',
  'provider_unavailable',
  'provider_changed',
  'finalizer_unavailable',
]) {
  assert.equal(
    classifyVideoAiNoteFailure({ outcome: 'failed', errorCodes: [error] }),
    'retry_after_outage',
    error,
  );
}
for (const input of [
  { outcome: 'insufficient_evidence', errorCodes: [], observableEvidenceCount: 1 },
  { outcome: 'evidence', errorCodes: [], mediaAcquiredOnce: true },
]) {
  assert.equal(classifyVideoAiNoteFailure(input), 'retry_after_generation');
}
assert.equal(
  classifyVideoAiNoteFailure({
    outcome: 'unavailable',
    errorCodes: ['private_or_unavailable'],
    observableEvidenceCount: 0,
    mediaAcquiredOnce: false,
  }),
  'awaiting_evidence',
  'only literal zero-media/zero-observation state may terminate blank',
);

// saved_places.place_id is the non-null internal identity even when the
// provider google_place_id is null. Every A/B provider-null combination is an
// internal FK transition; benign same-place metadata refresh is not.
for (const label of [
  'google A -> google B',
  'google A -> custom B',
  'custom A -> google B',
  'custom A -> custom B',
]) {
  assert.equal(savedPlaceIdentityChanged({ place_id: 'internal-a' }, { place_id: 'internal-b' }), true, label);
}
assert.equal(
  savedPlaceIdentityChanged({ place_id: 'internal-a' }, { place_id: 'internal-a' }),
  false,
  'same place metadata enrichment',
);

// A worker claimed Place A, then the reusable saved row was corrected to B.
// Its late callback must fail the exact FK/source snapshot guard.
assert.equal(videoAiNoteCallbackMatchesTarget({
  savedPlaceId: 'place-b',
  taskPlaceId: 'place-a',
  callbackPlaceId: 'place-a',
  savedSourceUrl: instagram.source_url,
  taskSourceUrl: instagram.source_url,
  callbackSourceUrl: instagram.source_url,
}), false, 'stale Place A callback cannot write after correction to Place B');
assert.equal(videoAiNoteCallbackMatchesTarget({
  savedPlaceId: 'place-b',
  taskPlaceId: 'place-b',
  callbackPlaceId: 'place-b',
  savedSourceUrl: instagram.source_url,
  taskSourceUrl: instagram.source_url,
  callbackSourceUrl: instagram.source_url,
}), true, 'fresh Place B callback remains valid');
assert.match(initialSchema, /place_id\s+uuid not null references public\.places\(id\)/i);

// Persistence-boundary coverage and idempotency: every saved_places insert or
// provenance/note change reaches one trigger; one partial unique task per final
// saved place prevents duplicate provider work.
assert.match(migration, /after insert or update of place_id, source_url, source_type, ai_note[\s\S]+execute function public\.ensure_video_ai_note_task\(\)/i);
assert.match(migration, /unique index if not exists share_media_tasks_ai_note_saved_place_uidx[\s\S]+where task_kind = 'ai_note_enrichment'/i);
assert.match(migration, /on conflict \(saved_place_id\) where task_kind = 'ai_note_enrichment'/i);
assert.match(migration, /target_place_id is distinct from excluded\.target_place_id/i);
assert.match(migration, /sp\.place_id = c\.target_place_id/i);
assert.match(migration, /or old\.place_id is distinct from new\.place_id/i);
assert.match(migration, /or old\.source_url is distinct from new\.source_url/i);
assert.match(migration, /coalesce\(length\(trim\(new\.ai_note\)\), 0\) = 0/i);
assert.match(migration, /video_derived_saved_places_without_ai_note/i);
assert.match(migration, /before update of place_id[\s\S]+execute function public\.invalidate_video_ai_note_on_place_change\(\)/i);
assert.match(migration, /new\.ai_note := null/i);

// Hybrid convergence: a three-attempt cycle remains bounded, but exhaustion
// renews only AI-note obligations on a capped long cooldown. Content failures
// remain durable, and a rejected structured cue escalates to expanded visual
// evidence on the next attempt instead of replaying the same prompt forever.
assert.match(worker, /task\.task_kind === 'ai_note_enrichment'[\s\S]+media\.code === 'finalizer_unavailable'[\s\S]+requeueAiNoteTask/i);
assert.match(worker, /renewAiNoteRetryCycle\(client, task, code\)/);
assert.match(migration, /retry_cycles = case when mt\.task_kind = 'ai_note_enrichment' then mt\.retry_cycles \+ 1/i);
assert.match(migration, /least\(86400, 3600 \* power/i);
assert.match(finalizer, /failure_code: failureCode\.slice\(0, 200\)/);
assert.match(finalizer, /ai_note_outcome: 'awaiting_evidence'/);
assert.match(finalizer, /disposition !== 'awaiting_evidence'/);
assert.match(finalizer, /retryCount: Number\(task\.attempts\)/);
assert.match(worker, /noteStructuredEvidencePreflight/);
assert.match(worker, /task\.ai_note_outcome !== 'retry_after_generation'/);
assert.match(worker, /buildTargetedNoteContext/);
assert.match(worker, /expanded: task\.ai_note_outcome === 'retry_after_generation'/);
assert.match(worker, /noteQualityRetryExpanded/);
assert.match(worker, /target_scene_expanded/);
assert.match(finalizer, /mediaMentions\.mentions\.map\(\(mention: any\) => \[mention\.id, null\]\)/);
assert.doesNotMatch(finalizer, /event: 'ai_note_generation'/);
assert.match(finalizer, /noteEvidenceForLogicalMention/);
assert.match(migration, /evidence_snapshot jsonb/);
assert.match(migration, /media_acquired_once boolean/);
assert.match(migration, /frame_snapshot bytea/);
assert.match(migration, /octet_length\(frame_snapshot\) <= 524288/);
assert.match(migration, /frame_snapshot = null/);
assert.match(migration, /model_input_tokens integer/);
assert.match(migration, /model_output_tokens integer/);
assert.match(migration, /model_thinking_tokens integer/);
assert.match(worker, /accumulateModelDiagnostics/);
assert.match(worker, /restoreRetainedFrameSnapshot/);
assert.match(worker, /recordAiNoteFrameSnapshot/);
assert.match(finalizer, /model_input_tokens: Number\.isFinite\(diagnostics\.modelInputTokens\)/);
const evidenceWriter = taskDb.slice(
  taskDb.indexOf('export async function recordAiNoteEvidenceSnapshot'),
  taskDb.indexOf('/** Best-effort cleanup', taskDb.indexOf('export async function recordAiNoteEvidenceSnapshot')),
);
assert.match(evidenceWriter, /ai_note_evidence_snapshot_failed/);

// Data-integrity contract: only ai_note is written, with final id/user/source
// and observed blank-value guards. `notes` is selected for audit but untouched.
const guaranteeStart = finalizer.indexOf('async function finalizeVideoAiNoteTask');
const guaranteeEnd = finalizer.indexOf('/**\n * Enrich a metadata-auto-saved row', guaranteeStart);
const guaranteeBody = finalizer.slice(guaranteeStart, guaranteeEnd);
assert.match(guaranteeBody, /\.update\(\{ ai_note: noteResult\.note \}\)/);
assert.match(guaranteeBody, /\.eq\('source_url', representedSource\)/);
assert.match(guaranteeBody, /\.eq\('place_id', task\.target_place_id\)/);
assert.match(guaranteeBody, /videoAiNoteCallbackMatchesTarget/);
assert.match(worker, /targetSourceUrl: task\.canonical_url \|\| task\.source_url/);
assert.match(finalizer, /async function markVideoAiNoteTask/);
assert.match(finalizer, /\.eq\('target_place_id', task\.target_place_id\)/);
assert.match(finalizer, /\.eq\('source_url', task\.source_url\)/);
assert.doesNotMatch(guaranteeBody, /\.update\(\{[^}]*\bnotes\s*:/s);
assert.match(guaranteeBody, /userNotePreserved: true/);

console.log('PASS video-derived AI-note provenance, retry, re-arm, correction, and data-integrity contracts');
