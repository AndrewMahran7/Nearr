/**
 * scripts/testSavedPlaceSourceEnrichment.ts
 *
 * A video that resolves to a place the user ALREADY saved must enrich that
 * exact saved_places row, not be discarded because "already saved".
 *
 * Covers the merge policy itself (pure), the save path that applies it
 * (behavioral, against an in-memory Supabase double), and the two client
 * short-circuits that used to skip the save entirely.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  alreadySavedActionCopy,
  hasAttachedSource,
  isSameSourceUrl,
  planSavedPlaceEnrichment,
} from '../lib/savedPlaceSourceMerge';
import {
  chooseBatchCandidate,
  reconcileMultiPlaceBatch,
  selectedBatchTargets,
  toggleBatchRow,
} from '../lib/multiPlaceBatch';
import { normalizeShareUrl } from '../lib/shareAgent/tiktokUrl';
import type { ShareJobMentionSlot } from '../lib/shareJobResult';

const shareUrlKey = (url: string): string => normalizeShareUrl(url).url;
const REEL = 'https://www.instagram.com/reel/AbC123/';
const TIKTOK = 'https://www.tiktok.com/@chef/video/7412345678901234567';

// ---------------------------------------------------------------------------
// 1. PRIMARY REPRODUCTION — manual save with no source, later video attaches.
// ---------------------------------------------------------------------------
{
  const manualSave = {
    source_url: null,
    source_type: 'manual',
    ai_note: null,
    notes: 'Go with Dad',
  };
  const plan = planSavedPlaceEnrichment(
    manualSave,
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'The breakfast burrito looked ridiculous.' },
    shareUrlKey,
  );
  assert.equal(plan.source, 'attached');
  assert.deepEqual(plan.sourcePatch, { source_type: 'instagram', source_url: REEL });
  assert.equal(plan.changed, true);
  // `source_type: 'manual'` with no URL is NOT an attached source.
  assert.equal(hasAttachedSource(manualSave), false);
  assert.equal(hasAttachedSource({ source_url: REEL }), true);
  assert.equal(hasAttachedSource({ source_url: '   ' }), false, 'blank is not a source');
}

// ---------------------------------------------------------------------------
// 2. AI ENRICHMENT — empty ai_note is filled by the later video.
// 3. USER NOTE PRESERVATION — `notes` is never part of any patch.
// ---------------------------------------------------------------------------
{
  const plan = planSavedPlaceEnrichment(
    { source_url: null, ai_note: null },
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'The breakfast burrito looked ridiculous.' },
    shareUrlKey,
  );
  assert.equal(plan.aiNote, 'attached');
  assert.deepEqual(plan.aiNotePatch, { ai_note: 'The breakfast burrito looked ridiculous.' });

  // Every patch this module can emit, across every branch, touches only
  // source_type / source_url / ai_note. Nothing user-authored or stateful.
  const allowed = new Set(['source_type', 'source_url', 'ai_note']);
  const existingStates = [
    { source_url: null, ai_note: null },
    { source_url: REEL, ai_note: 'old cue' },
    { source_url: TIKTOK, ai_note: null },
    { source_url: null, source_type: 'manual', ai_note: 'old cue' },
  ];
  const incomingStates = [
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'new cue' },
    { sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: null },
    { sourceUrl: null, sourceType: 'manual', aiNote: null },
  ];
  for (const existing of existingStates) {
    for (const incoming of incomingStates) {
      const p = planSavedPlaceEnrichment(existing, incoming, shareUrlKey);
      for (const key of Object.keys({ ...(p.sourcePatch ?? {}), ...(p.aiNotePatch ?? {}) })) {
        assert.ok(allowed.has(key), `enrichment must never write ${key}`);
      }
    }
  }

  // An ai_note that already exists is preserved, even while a source attaches.
  const keepsNote = planSavedPlaceEnrichment(
    { source_url: null, ai_note: 'Written from the first post' },
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'A different cue' },
    shareUrlKey,
  );
  assert.equal(keepsNote.source, 'attached');
  assert.equal(keepsNote.aiNote, 'existing_note_preserved');
  assert.equal(keepsNote.aiNotePatch, null);

  // Whitespace-only incoming notes are not notes.
  assert.equal(
    planSavedPlaceEnrichment({ ai_note: null }, { aiNote: '   \n' }).aiNote,
    'no_incoming_note',
  );
}

// ---------------------------------------------------------------------------
// 6. SAME VIDEO TWICE — idempotent, no source rewrite.
// ---------------------------------------------------------------------------
{
  const plan = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: 'instagram', ai_note: 'cue' },
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'cue' },
    shareUrlKey,
  );
  assert.equal(plan.source, 'already_attached');
  assert.equal(plan.sourcePatch, null);
  assert.equal(plan.changed, false, 'resubmitting the same video changes nothing');

  // Harmless URL differences are not different videos — Nearr's existing
  // normalization strips the share-sheet tracking params.
  assert.equal(isSameSourceUrl(REEL, `${REEL}?igsh=abc123`, shareUrlKey), true);
  assert.equal(
    isSameSourceUrl(TIKTOK, `${TIKTOK}?is_from_webapp=1&sender_device=pc`, shareUrlKey),
    true,
  );
  assert.equal(isSameSourceUrl(REEL, TIKTOK, shareUrlKey), false);
  assert.equal(isSameSourceUrl(null, REEL, shareUrlKey), false);
  assert.equal(isSameSourceUrl(REEL, null, shareUrlKey), false);
  // A throwing normalizer degrades to exact comparison instead of crashing.
  const boom = () => { throw new Error('nope'); };
  assert.equal(isSameSourceUrl(REEL, REEL, boom), true);
  assert.doesNotThrow(() => isSameSourceUrl(REEL, TIKTOK, boom));
}

// ---------------------------------------------------------------------------
// 7. EXISTING DIFFERENT SOURCE — preserved, never silently overwritten.
// ---------------------------------------------------------------------------
{
  const plan = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: 'instagram', ai_note: null },
    { sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: 'Second post cue' },
    shareUrlKey,
  );
  assert.equal(plan.source, 'existing_source_preserved');
  assert.equal(plan.sourcePatch, null, 'the first post keeps the single source slot');
  // The independent ai_note slot may still be filled — enrichment is per field.
  assert.equal(plan.aiNote, 'attached');
}

// ---------------------------------------------------------------------------
// A manual re-save must never clobber an attached post.
// ---------------------------------------------------------------------------
{
  const plan = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: 'instagram' },
    { sourceUrl: null, sourceType: 'manual' },
    shareUrlKey,
  );
  assert.equal(plan.source, 'no_incoming_source');
  assert.equal(plan.sourcePatch, null);
  // Even if a manual save somehow carried a URL, `manual` never labels a post.
  assert.equal(
    planSavedPlaceEnrichment({ source_url: null }, { sourceUrl: REEL, sourceType: 'manual' }).source,
    'no_incoming_source',
  );
  assert.deepEqual(planSavedPlaceEnrichment(null, null).sourcePatch, null);
  assert.doesNotThrow(() => planSavedPlaceEnrichment(undefined, undefined));
}

// ---------------------------------------------------------------------------
// Confirmation copy describes what will actually happen.
// ---------------------------------------------------------------------------
{
  const attachable = alreadySavedActionCopy(
    { source_url: null },
    { sourceUrl: REEL, sourceType: 'instagram' },
    shareUrlKey,
  );
  assert.equal(attachable.action, 'Add this post');
  assert.ok(attachable.note && /attached/i.test(attachable.note));

  const different = alreadySavedActionCopy(
    { source_url: REEL, source_type: 'instagram' },
    { sourceUrl: TIKTOK, sourceType: 'tiktok' },
    shareUrlKey,
  );
  assert.equal(different.action, 'View on map');
  assert.ok(different.note && /already attached/i.test(different.note), 'limitation is stated');

  const same = alreadySavedActionCopy(
    { source_url: REEL, source_type: 'instagram', ai_note: 'cue' },
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'cue' },
    shareUrlKey,
  );
  assert.equal(same.action, 'View on map');
  assert.equal(same.note, null, 'nothing to explain when nothing changes');

  // No internal vocabulary leaks into user-facing copy.
  for (const copy of [attachable, different, same]) {
    const text = `${copy.action} ${copy.note ?? ''}`;
    assert.doesNotMatch(text, /source_url|source_type|ai_note|enrich|upsert|candidate|dedupe/i);
  }
}

// ---------------------------------------------------------------------------
// 1/8/9/10/12. Behavioral: the save path applied against a Supabase double.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

/** Minimal PostgREST double: enough for update().eq().is() and select chains. */
function makeDb(rows: Row[]) {
  const writes: Array<{ patch: Row; matched: number }> = [];
  const api = {
    rows,
    writes,
    update(patch: Row) {
      const filters: Array<(row: Row) => boolean> = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return chain;
        },
        is(column: string, value: null) {
          filters.push((row) => (row[column] ?? null) === value);
          return chain;
        },
        /** Stands in for awaiting the PostgREST builder. */
        run() {
          const matched = rows.filter((row) => filters.every((f) => f(row)));
          for (const row of matched) Object.assign(row, patch);
          writes.push({ patch, matched: matched.length });
          return { error: null };
        },
      };
      return chain;
    },
  };
  return api;
}

/** The exact write sequence services/savedPlacesService.ts performs on a
 *  duplicate, expressed against the double so the guards are really exercised. */
function applyEnrichment(db: ReturnType<typeof makeDb>, existing: Row, incoming: {
  sourceUrl?: string | null;
  sourceType?: string | null;
  aiNote?: string | null;
}) {
  const plan = planSavedPlaceEnrichment(existing, incoming, shareUrlKey);
  if (plan.sourcePatch) {
    db.update(plan.sourcePatch).eq('id', existing.id).is('source_url', null).run();
  }
  if (plan.aiNotePatch) {
    db.update(plan.aiNotePatch).eq('id', existing.id).is('ai_note', null).run();
  }
  return plan;
}

// 1/4/5. The row keeps its identity and every piece of user state.
{
  const saved: Row = {
    id: 'saved-1',
    place_id: 'place-1',
    user_id: 'user-a',
    source_url: null,
    source_type: 'manual',
    ai_note: null,
    notes: 'Ask for the corner booth',
    radius_value: 3,
    radius_unit: 'miles',
    notifications_enabled: false,
    visited_at: '2026-07-01T00:00:00Z',
    archived_at: null,
    reminder_opportunity_count: 2,
    created_at: '2026-01-01T00:00:00Z',
  };
  const before = { ...saved };
  const db = makeDb([saved]);
  const plan = applyEnrichment(db, saved, {
    sourceUrl: REEL,
    sourceType: 'instagram',
    aiNote: 'The breakfast burrito looked ridiculous.',
  });

  assert.equal(plan.source, 'attached');
  assert.equal(db.rows.length, 1, 'exactly one saved place remains');
  assert.equal(saved.id, before.id, 'same saved_places.id');
  assert.equal(saved.place_id, before.place_id, 'same place_id');
  assert.equal(saved.source_url, REEL);
  assert.equal(saved.source_type, 'instagram');
  assert.equal(saved.ai_note, 'The breakfast burrito looked ridiculous.');
  // 3/4/5. Untouched user state.
  for (const key of [
    'notes', 'radius_value', 'radius_unit', 'notifications_enabled',
    'visited_at', 'archived_at', 'reminder_opportunity_count', 'created_at', 'user_id',
  ]) {
    assert.deepEqual(saved[key], before[key], `${key} must survive enrichment`);
  }
}

// 9. RETRY / 6. same video twice — repeated execution converges.
{
  const saved: Row = { id: 'saved-1', source_url: null, source_type: 'manual', ai_note: null };
  const db = makeDb([saved]);
  const incoming = { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'cue' };
  const first = applyEnrichment(db, saved, incoming);
  const second = applyEnrichment(db, saved, incoming);
  const third = applyEnrichment(db, saved, incoming);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false, 'a retry is a no-op');
  assert.equal(third.changed, false);
  assert.equal(saved.source_url, REEL);
  assert.equal(saved.ai_note, 'cue');
  assert.equal(db.writes.length, 2, 'no redundant writes after the first attach');
}

// RACE: two jobs enriching the same place attach exactly one source. Both plan
// against the pre-write snapshot; the `.is('source_url', null)` guard decides.
{
  const saved: Row = { id: 'saved-1', source_url: null, source_type: 'manual', ai_note: null };
  const db = makeDb([saved]);
  const snapshot = { ...saved };
  const jobA = planSavedPlaceEnrichment(snapshot, { sourceUrl: REEL, sourceType: 'instagram' }, shareUrlKey);
  const jobB = planSavedPlaceEnrichment(snapshot, { sourceUrl: TIKTOK, sourceType: 'tiktok' }, shareUrlKey);
  assert.equal(jobA.source, 'attached');
  assert.equal(jobB.source, 'attached');
  db.update(jobA.sourcePatch!).eq('id', 'saved-1').is('source_url', null).run();
  db.update(jobB.sourcePatch!).eq('id', 'saved-1').is('source_url', null).run();
  assert.equal(saved.source_url, REEL, 'first writer wins; the loser does not overwrite');
  assert.equal(db.writes[1]!.matched, 0, 'the racing write matched no rows');
  assert.equal(db.rows.length, 1);
}

// 10. OWNERSHIP — the id filter plus RLS keeps another user's row out of reach.
{
  const mine: Row = { id: 'saved-a', user_id: 'user-a', place_id: 'place-1', source_url: null, ai_note: null };
  const theirs: Row = { id: 'saved-b', user_id: 'user-b', place_id: 'place-1', source_url: null, ai_note: null };
  const db = makeDb([mine, theirs]);
  const plan = planSavedPlaceEnrichment(mine, { sourceUrl: REEL, sourceType: 'instagram' }, shareUrlKey);
  db.update(plan.sourcePatch!).eq('id', mine.id).is('source_url', null).run();
  assert.equal(mine.source_url, REEL);
  assert.equal(theirs.source_url, null, "another user's save of the same place is untouched");
}

// ---------------------------------------------------------------------------
// 11. AMBIGUITY — nothing here bypasses the picker. Enrichment happens only
// after the resolver/user has decided WHICH place the post represents.
// ---------------------------------------------------------------------------
const slot = (patch: Partial<ShareJobMentionSlot> = {}): ShareJobMentionSlot => ({
  mentionId: 'm1',
  displayName: "Keno's",
  contextLabel: null,
  primaryVenueName: "Keno's Restaurant",
  hostVenueName: null,
  relationshipType: null,
  outcome: 'verified_single',
  candidates: [{
    googlePlaceId: 'gp-keno',
    name: "Keno's Restaurant",
    formattedAddress: '123 Main St',
    latitude: 33.42,
    longitude: -117.61,
    types: [],
    matchScore: 0.9,
  }],
  aiNote: null,
  saveState: 'pending',
  savedPlaceId: null,
  ...patch,
});

{
  // An ambiguous slot has no selected candidate, so it is not a save target —
  // "the user already saved something with this name" is never a shortcut.
  const ambiguous = reconcileMultiPlaceBatch({
    jobId: 'job-1',
    slots: [slot({
      outcome: 'ambiguous_candidates',
      candidates: [
        { googlePlaceId: 'gp-keno', name: "Keno's Restaurant", formattedAddress: 'A', latitude: 1, longitude: 1, types: [], matchScore: 0.5 },
        { googlePlaceId: 'gp-other', name: "Keno's Cafe", formattedAddress: 'B', latitude: 2, longitude: 2, types: [], matchScore: 0.5 },
      ],
    })],
    savedByGoogleId: { 'gp-keno': 'saved-existing' },
  });
  assert.equal(ambiguous.rows.m1!.resolution, 'ambiguous');
  assert.equal(selectedBatchTargets(ambiguous).length, 0, 'ambiguity still requires a choice');
}

// ---------------------------------------------------------------------------
// THE BUG, at the multi-place review site: a row whose place is already saved
// used to be marked already_saved and dropped from the save. It must now be a
// real save target, because saving is what attaches the post.
// ---------------------------------------------------------------------------
{
  const batch = reconcileMultiPlaceBatch({
    jobId: 'job-1',
    slots: [slot()],
    savedByGoogleId: { 'gp-keno': 'saved-existing' },
  });
  const row = batch.rows.m1!;
  assert.equal(row.persistence, 'pending', 'an existing save is not a terminal state');
  assert.equal(row.savedPlaceId, 'saved-existing', 'the existing row is still identified');
  assert.equal(row.selectedForSave, true);
  assert.equal(selectedBatchTargets(batch).length, 1, 'the post reaches the existing place');
  assert.notEqual(toggleBatchRow(batch, 'm1'), batch, 'the user can still deselect it');

  // A save THIS job already performed stays terminal — no double work.
  const serverSaved = reconcileMultiPlaceBatch({
    jobId: 'job-1',
    slots: [slot({ saveState: 'already_saved', savedPlaceId: 'saved-existing' })],
  });
  assert.equal(serverSaved.rows.m1!.persistence, 'already_saved');
  assert.equal(selectedBatchTargets(serverSaved).length, 0);

  // Picking a candidate that is already saved keeps it selectable too.
  const picked = chooseBatchCandidate(
    reconcileMultiPlaceBatch({ jobId: 'job-2', slots: [slot({ outcome: 'ambiguous_candidates' })] }),
    'm1',
    slot().candidates[0]!,
    'saved-existing',
  );
  assert.equal(picked.rows.m1!.persistence, 'pending');
  assert.equal(picked.rows.m1!.selectedForSave, true);
  assert.equal(picked.rows.m1!.savedPlaceId, 'saved-existing');
}

// ---------------------------------------------------------------------------
// THE BUG, at the single-candidate confirmation site + the write paths.
// ---------------------------------------------------------------------------
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

{
  const screen = read('app/share-jobs/[jobId].tsx');
  // The old shortcut resolved the job and navigated WITHOUT ever saving.
  assert.doesNotMatch(screen, /viewAlreadySaved\s*\(/, 'the save-skipping shortcut is gone');
  assert.match(screen, /alreadySavedActionCopy\(/, 'copy is derived from the merge plan');
  assert.match(
    screen,
    /title=\{alreadySavedCopy\?\.action \?\? 'Save to my map'\}[\s\S]{0,160}handleSaveStored\(single\)/,
    'both cases run the canonical save, which enriches an existing row',
  );
}

{
  const service = read('services/savedPlacesService.ts');
  // 8. Enrichment is applied on BOTH duplicate branches (exact-source reuse and
  // the unique-violation recovery), and each returns the existing row's id.
  assert.equal(
    service.match(/await enrichExistingSavedPlace\(/g)?.length,
    2,
    'every duplicate branch enriches',
  );
  assert.doesNotMatch(service, /\.delete\(\)[\s\S]{0,80}saved_places[\s\S]{0,80}duplicate/i);
  // The guards that make it idempotent and race-safe.
  assert.match(service, /\.update\(plan\.sourcePatch\)[\s\S]{0,120}\.is\('source_url', null\)/);
  assert.match(service, /\.update\(plan\.aiNotePatch\)[\s\S]{0,120}\.is\('ai_note', null\)/);
  // 12. The enriched row is re-read so the client cache is not stale.
  assert.match(service, /readSavedPlaceAfterEnrichment\(/);
}

{
  // 12. CACHE — a duplicate seeds the shared cache with the enriched row.
  const candidateSave = read('services/shareJobCandidateSave.ts');
  assert.match(
    candidateSave,
    /if \(result\.saved\) dependencies\.cache\(result\.saved\)/,
    'an already-saved result still refreshes the cached place',
  );
  const shareScreen = read('app/share.tsx');
  assert.match(shareScreen, /if \(result\.saved\) \{\s*upsertSavedPlaceIntoCache\(result\.saved\)/);
  // 13. Backend-only enrichment (metadata auto-save) reaches the client too.
  const hook = read('hooks/useSavedPlaces.ts');
  assert.match(hook, /scope: 'saved_place_share_completion'/);
  assert.match(hook, /table: 'share_jobs'/);
  assert.match(hook, /typeof payload\?\.new\?\.saved_place_id === 'string'/);
}

{
  // 7. The backend writers follow the same fill-if-empty rule.
  const save = read('supabase/functions/process-share-link/save.ts');
  assert.match(
    save,
    /\.update\(\{ source_type: source, source_url: sourceUrl \}\)[\s\S]{0,120}\.is\('source_url', null\)/,
    'the metadata path never overwrites an attached post',
  );
  assert.match(save, /\.update\(\{ ai_note: note \}\)[\s\S]{0,120}\.is\('ai_note', null\)/);
  assert.doesNotMatch(save, /patch\.notes = autoNote/, 'generated cues never land in user notes');

  const migration = read('supabase/migrations/20260814000001_saved_place_source_enrichment.sql');
  assert.match(
    migration,
    /update public\.saved_places[\s\S]{0,300}where id = v_saved_place_id\s*\n\s*and coalesce\(trim\(source_url\), ''\) = '';/,
    'the auto-save RPC attaches only into an empty source slot',
  );
  assert.doesNotMatch(migration, /alter table|create table|drop column/i, 'no schema change');
}

console.log('PASS saved-place source enrichment: existing saves are enriched, never discarded or overwritten');
