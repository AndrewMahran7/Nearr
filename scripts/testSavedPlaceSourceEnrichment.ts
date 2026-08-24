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
  // The PAIR moves together, in one guarded write. Never per field.
  assert.deepEqual(plan.sourcePatch, {
    patch: { source_type: 'instagram', source_url: REEL },
    expectSourceUrl: null,
  });
  assert.equal(plan.sourceTypePatch, null, 'no separate type write exists on attach');
  assert.equal(plan.representedSourceUrl, REEL);
  assert.equal(plan.changed, true);
  // `source_type: 'manual'` with no URL is NOT an attached source.
  assert.equal(hasAttachedSource(manualSave), false);
  assert.equal(hasAttachedSource({ source_url: REEL }), true);
  assert.equal(hasAttachedSource({ source_url: '   ' }), false, 'blank is not a source');

  const tiktokPlan = planSavedPlaceEnrichment(
    manualSave,
    {
      sourceUrl: 'https://m.tiktok.com/@Chef/video/7412345678901234567/?is_from_webapp=1',
      sourceType: 'tiktok',
      aiNote: null,
    },
    shareUrlKey,
  );
  assert.equal(tiktokPlan.source, 'attached');
  assert.equal(
    shareUrlKey(tiktokPlan.sourcePatch!.patch.source_url),
    TIKTOK,
    'a later TikTok source attaches with canonical exact-post identity',
  );
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
  assert.deepEqual(plan.aiNotePatch, {
    patch: { ai_note: 'The breakfast burrito looked ridiculous.' },
    expectSourceUrl: REEL,
  });

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
      const written = {
        ...(p.sourcePatch?.patch ?? {}),
        ...(p.sourceTypePatch?.patch ?? {}),
        ...(p.aiNotePatch?.patch ?? {}),
      };
      for (const key of Object.keys(written)) {
        assert.ok(allowed.has(key), `enrichment must never write ${key}`);
      }
      // A note is only ever planned for the post this place represents.
      if (p.aiNotePatch) {
        assert.equal(p.aiNotePatch.expectSourceUrl, p.representedSourceUrl);
        assert.notEqual(p.representedSourceUrl, null);
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
  assert.equal(plan.sourceTypePatch, null, 'the type is already correct');
  assert.equal(plan.changed, false, 'resubmitting the same video changes nothing');

  // Harmless URL differences are not different videos — Nearr's existing
  // normalization strips the share-sheet tracking params.
  assert.equal(isSameSourceUrl(REEL, `${REEL}?igsh=abc123`, shareUrlKey), true);
  assert.equal(
    isSameSourceUrl(TIKTOK, `${TIKTOK}?is_from_webapp=1&sender_device=pc`, shareUrlKey),
    true,
  );
  assert.equal(
    isSameSourceUrl(TIKTOK, 'https://m.tiktok.com/@Chef/video/7412345678901234567/', shareUrlKey),
    true,
    'host/case/trailing-slash variants remain one attached TikTok',
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
  assert.equal(plan.sourceTypePatch, null, 'a different post never relabels the stored one');
  assert.equal(plan.representedSourceUrl, null, 'this place does not represent TikTok B');
  // 5. PROVENANCE: B is not attached, so B's cue must not be stored. The place
  // page renders ai_note beside the ATTACHED post, so it would read as a
  // description of Reel A.
  assert.equal(plan.aiNote, 'withheld_unrepresented_source');
  assert.equal(plan.aiNotePatch, null);
  assert.equal(plan.changed, false, 'a different post changes nothing at all');
}

// ---------------------------------------------------------------------------
// 4. MIXED PROVENANCE is unrepresentable: no branch can emit a patch that
// writes one half of the source identity onto another post's URL.
// ---------------------------------------------------------------------------
{
  const existingStates = [
    { source_url: null, source_type: null },
    { source_url: null, source_type: 'manual' },
    { source_url: '', source_type: 'manual' },
    { source_url: REEL, source_type: 'instagram' },
    { source_url: REEL, source_type: null },
    { source_url: REEL, source_type: 'manual' },
    { source_url: TIKTOK, source_type: 'tiktok' },
  ];
  const incomingStates = [
    { sourceUrl: REEL, sourceType: 'instagram' },
    { sourceUrl: REEL + '?igsh=xyz', sourceType: 'instagram' },
    { sourceUrl: TIKTOK, sourceType: 'tiktok' },
    { sourceUrl: null, sourceType: 'manual' },
  ];
  for (const existing of existingStates) {
    for (const incoming of incomingStates) {
      const p = planSavedPlaceEnrichment(existing, incoming, shareUrlKey);
      if (p.sourcePatch) {
        // Attach writes BOTH halves or neither.
        assert.deepEqual(
          Object.keys(p.sourcePatch.patch).sort(),
          ['source_type', 'source_url'],
          'the source identity is never written per field',
        );
      }
      if (p.sourceTypePatch) {
        // A lone type write is legal ONLY for the URL already stored.
        assert.equal(p.sourceTypePatch.expectSourceUrl, existing.source_url);
        assert.ok(
          isSameSourceUrl(existing.source_url, incoming.sourceUrl, shareUrlKey),
          'a type may only ever describe a provably identical URL',
        );
      }
      // Nothing conditional is ever planned without a represented source.
      if (p.sourceTypePatch || p.aiNotePatch) assert.notEqual(p.representedSourceUrl, null);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. LEGACY MALFORMED ROWS — the same URL may complete its own type; a
// different URL may not lend its type to someone else's URL.
// ---------------------------------------------------------------------------
{
  // source_url = real URL, source_type = null → the same post fills the type.
  const fillsNull = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: null, ai_note: null },
    { sourceUrl: REEL + '?igsh=abc', sourceType: 'instagram' },
    shareUrlKey,
  );
  assert.equal(fillsNull.source, 'already_attached');
  assert.deepEqual(fillsNull.sourceTypePatch, {
    patch: { source_type: 'instagram' },
    expectSourceUrl: REEL,
    expectSourceType: null,
  });
  assert.equal(fillsNull.sourcePatch, null, 'the stored URL is not rewritten');

  // source_url = real URL, source_type = 'manual' → the same correction applies.
  const fillsManual = planSavedPlaceEnrichment(
    { source_url: TIKTOK, source_type: 'manual' },
    { sourceUrl: TIKTOK, sourceType: 'tiktok' },
    shareUrlKey,
  );
  assert.deepEqual(fillsManual.sourceTypePatch, {
    patch: { source_type: 'tiktok' },
    expectSourceUrl: TIKTOK,
    expectSourceType: 'manual',
  });

  // A DIFFERENT post may not repair those rows — that is exactly how
  // `source_url = Reel A, source_type = tiktok` would be born.
  const strangerCannotRelabel = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: null },
    { sourceUrl: TIKTOK, sourceType: 'tiktok' },
    shareUrlKey,
  );
  assert.equal(strangerCannotRelabel.sourceTypePatch, null);
  assert.equal(strangerCannotRelabel.sourcePatch, null);
  assert.equal(strangerCannotRelabel.changed, false);

  // An already-correct type is not rewritten.
  assert.equal(
    planSavedPlaceEnrichment(
      { source_url: REEL, source_type: 'instagram' },
      { sourceUrl: REEL, sourceType: 'link' },
      shareUrlKey,
    ).sourceTypePatch,
    null,
  );
}

// ---------------------------------------------------------------------------
// 6. SAME SOURCE + empty ai_note → the cue MAY fill it (provenance holds).
// 8. An existing note is never overwritten, by any post.
// ---------------------------------------------------------------------------
{
  const sameSourceFillsNote = planSavedPlaceEnrichment(
    { source_url: REEL, source_type: 'instagram', ai_note: null },
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'The breakfast burrito looked ridiculous.' },
    shareUrlKey,
  );
  assert.equal(sameSourceFillsNote.aiNote, 'attached');
  assert.equal(sameSourceFillsNote.aiNotePatch!.expectSourceUrl, REEL);

  for (const incoming of [
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'newer cue' },
    { sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: 'other post cue' },
  ]) {
    const p = planSavedPlaceEnrichment(
      { source_url: REEL, source_type: 'instagram', ai_note: 'the original cue' },
      incoming,
      shareUrlKey,
    );
    assert.equal(p.aiNotePatch, null, 'an existing cue is never rewritten');
  }
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
function applyGuarded(
  db: ReturnType<typeof makeDb>,
  id: unknown,
  guarded: { patch: Row; expectSourceUrl: string | null; expectSourceType?: string | null },
  noteGuard = false,
) {
  let query = db.update(guarded.patch).eq('id', id);
  query = guarded.expectSourceUrl === null
    ? query.is('source_url', null)
    : query.eq('source_url', guarded.expectSourceUrl);
  if (guarded.expectSourceType !== undefined) {
    query = guarded.expectSourceType === null
      ? query.is('source_type', null)
      : query.eq('source_type', guarded.expectSourceType);
  }
  if (noteGuard) query = query.is('ai_note', null);
  return query.run();
}

function applyEnrichment(db: ReturnType<typeof makeDb>, existing: Row, incoming: {
  sourceUrl?: string | null;
  sourceType?: string | null;
  aiNote?: string | null;
}) {
  const plan = planSavedPlaceEnrichment(existing, incoming, shareUrlKey);
  if (plan.sourcePatch) applyGuarded(db, existing.id, plan.sourcePatch);
  if (plan.sourceTypePatch) applyGuarded(db, existing.id, plan.sourceTypePatch);
  if (plan.aiNotePatch) applyGuarded(db, existing.id, plan.aiNotePatch, true);
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
  // 10. Both jobs observe an empty slot and both plan an attach.
  const jobA = planSavedPlaceEnrichment(
    snapshot,
    { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'Reel A cue' },
    shareUrlKey,
  );
  const jobB = planSavedPlaceEnrichment(
    snapshot,
    { sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: 'TikTok B cue' },
    shareUrlKey,
  );
  assert.equal(jobA.source, 'attached');
  assert.equal(jobB.source, 'attached');

  // A commits fully; B then runs its whole sequence against the changed row.
  applyGuarded(db, 'saved-1', jobA.sourcePatch!);
  applyGuarded(db, 'saved-1', jobA.aiNotePatch!, true);
  applyGuarded(db, 'saved-1', jobB.sourcePatch!);
  applyGuarded(db, 'saved-1', jobB.aiNotePatch!, true);

  // The final row must be internally coherent — never Reel A + tiktok, and
  // never Reel A captioned with TikTok B's words.
  assert.deepEqual(
    { url: saved.source_url, type: saved.source_type, note: saved.ai_note },
    { url: REEL, type: 'instagram', note: 'Reel A cue' },
    'the winner owns the URL, the type AND the note',
  );
  assert.equal(db.rows.length, 1);
  // B's two writes both matched nothing: its source lost the slot, and its
  // note failed the `source_url` precondition.
  assert.equal(db.writes[2]!.matched, 0, "the loser's source write matched no rows");
  assert.equal(db.writes[3]!.matched, 0, "the loser's note write matched no rows");
}

// 10 (reverse order). Whichever job wins, the result is coherent — the
// assertion is on internal consistency, not on who wins.
{
  const saved: Row = { id: 'saved-1', source_url: null, source_type: 'manual', ai_note: null };
  const db = makeDb([saved]);
  const snapshot = { ...saved };
  const jobA = planSavedPlaceEnrichment(
    snapshot, { sourceUrl: REEL, sourceType: 'instagram', aiNote: 'Reel A cue' }, shareUrlKey,
  );
  const jobB = planSavedPlaceEnrichment(
    snapshot, { sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: 'TikTok B cue' }, shareUrlKey,
  );
  // Interleaved: both sources first, then both notes.
  applyGuarded(db, 'saved-1', jobB.sourcePatch!);
  applyGuarded(db, 'saved-1', jobA.sourcePatch!);
  applyGuarded(db, 'saved-1', jobA.aiNotePatch!, true);
  applyGuarded(db, 'saved-1', jobB.aiNotePatch!, true);
  assert.deepEqual(
    { url: saved.source_url, type: saved.source_type, note: saved.ai_note },
    { url: TIKTOK, type: 'tiktok', note: 'TikTok B cue' },
    'B won the slot, so B owns the type and the note',
  );
}

// 5. A different post cannot supply an ai_note even when the slot is empty.
{
  const saved: Row = {
    id: 'saved-1', source_url: REEL, source_type: 'instagram', ai_note: null,
  };
  const db = makeDb([saved]);
  const plan = applyEnrichment(db, saved, {
    sourceUrl: TIKTOK, sourceType: 'tiktok', aiNote: 'The birria ramen looked insane.',
  });
  assert.equal(plan.aiNote, 'withheld_unrepresented_source');
  assert.equal(saved.ai_note, null, "TikTok B's cue must not caption Reel A");
  assert.equal(saved.source_url, REEL);
  assert.equal(saved.source_type, 'instagram');
  assert.equal(db.writes.length, 0, 'a different post performs no writes at all');
}

// 3. Same URL, missing type: the type is completed and the URL is untouched.
{
  const saved: Row = { id: 'saved-1', source_url: REEL, source_type: null, ai_note: null };
  const db = makeDb([saved]);
  applyEnrichment(db, saved, {
    sourceUrl: REEL + '?igsh=abc123', sourceType: 'instagram', aiNote: 'Reel A cue',
  });
  assert.equal(saved.source_url, REEL, 'the stored URL is never rewritten');
  assert.equal(saved.source_type, 'instagram');
  assert.equal(saved.ai_note, 'Reel A cue', 'same post, so its cue is legitimate');
}

// 10. OWNERSHIP — the id filter plus RLS keeps another user's row out of reach.
{
  const mine: Row = { id: 'saved-a', user_id: 'user-a', place_id: 'place-1', source_url: null, ai_note: null };
  const theirs: Row = { id: 'saved-b', user_id: 'user-b', place_id: 'place-1', source_url: null, ai_note: null };
  const db = makeDb([mine, theirs]);
  const plan = planSavedPlaceEnrichment(mine, { sourceUrl: REEL, sourceType: 'instagram' }, shareUrlKey);
  applyGuarded(db, mine.id, plan.sourcePatch!);
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
  assert.equal(row.selectedForSave, false, 'Save all never opts into enriching an existing row');
  assert.equal(selectedBatchTargets(batch).length, 0);
  const explicitlySelected = toggleBatchRow(batch, 'm1');
  assert.equal(selectedBatchTargets(explicitlySelected).length, 1, 'explicit selection reaches the existing place');

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
    /title=\{broadSingle \? 'See places in this area' : 'Save this place'\}[\s\S]{0,700}handleSaveStored\(single\)/,
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
  // 12. Every write goes through the one guarded applier, so no call site can
  // forget a precondition. The applier turns `expect*` into is()/eq() filters.
  assert.match(
    service,
    /query = guarded\.expectSourceUrl === null\s*\n\s*\? query\.is\('source_url', null\)\s*\n\s*: query\.eq\('source_url', guarded\.expectSourceUrl\)/,
    'the observed source_url is the precondition for every enrichment write',
  );
  assert.match(
    service,
    /query\.is\('source_type', null\)[\s\S]{0,90}query\.eq\('source_type', guarded\.expectSourceType\)/,
  );
  for (const patch of ['sourcePatch', 'sourceTypePatch', 'aiNotePatch']) {
    assert.match(
      service,
      new RegExp(`if \\(plan\\.${patch}\\) \\{\\s*\\n\\s*await applyGuarded\\(plan\\.${patch}`),
      `${patch} is applied only through the guarded writer`,
    );
  }
  assert.match(service, /applyGuarded\(plan\.aiNotePatch, 'ai_note attach', \(query\) => query\.is\('ai_note', null\)\)/);
  assert.doesNotMatch(
    service,
    /\.update\(\{ source_url:/,
    'source_url is never written outside the paired patch',
  );
  // The enriched row is re-read so the client cache is not stale.
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
  // 13. The metadata path shares the POLICY MODULE, not a parallel copy of it.
  const save = read('supabase/functions/process-share-link/save.ts');
  assert.match(save, /import \{ planSavedPlaceEnrichment \} from '\.\.\/\.\.\/\.\.\/lib\/savedPlaceSourceMerge\.ts'/);
  assert.match(save, /const plan = planSavedPlaceEnrichment\(/);
  assert.match(
    save,
    /query = guarded\.expectSourceUrl === null\s*\n\s*\? query\.is\('source_url', null\)\s*\n\s*: query\.eq\('source_url', guarded\.expectSourceUrl\)/,
    'the edge function applies the same preconditions as the client',
  );
  assert.match(save, /if \(plan\.sourcePatch\) await applyGuarded\(plan\.sourcePatch/);
  assert.match(save, /if \(plan\.sourceTypePatch\) await applyGuarded\(plan\.sourceTypePatch/);
  assert.match(save, /if \(plan\.aiNotePatch\) await applyGuarded\(plan\.aiNotePatch, 'ai_note attach', true\)/);
  // It reads the columns the policy needs; a plan built from a partial row
  // would silently mis-decide.
  assert.match(save, /select\('id, source_url, source_type, ai_note'\)/);
  assert.match(save, /'id, source_url, source_type, ai_note, place_id, place:places\(/);
  assert.doesNotMatch(save, /patch\.notes = autoNote/, 'generated cues never land in user notes');

  // 14. The media/RPC path: the note is written only while the row still names
  // THIS post, so a reused row carrying a different post is never captioned.
  const worker = read('supabase/functions/process-share-jobs/index.ts');
  assert.match(
    worker,
    /\.update\(\{ ai_note: note \}\)[\s\S]{0,400}\.eq\('source_url', canonicalUrl\)\s*\n\s*\.is\('ai_note', null\)/,
    'media auto-save ai_note is guarded by source provenance',
  );
  assert.match(
    worker,
    /\.update\(\{ ai_note: note \}\)[\s\S]{0,400}\.eq\('source_url', task\.canonical_url \|\| task\.source_url\)/,
    'post-save enrichment ai_note is guarded by source provenance',
  );

  const migration = read('supabase/migrations/20260814000001_saved_place_source_enrichment.sql');
  // ONE conditional statement writes the identity: the URL is filled only when
  // empty, and the row is excluded outright when it holds a different post.
  assert.match(
    migration,
    /update public\.saved_places sp\s*\n\s*set source_url = case\s*\n\s*when coalesce\(trim\(sp\.source_url\), ''\) = '' then p_source_url\s*\n\s*else sp\.source_url\s*\n\s*end,\s*\n\s*source_type = p_source_type,/,
    'the RPC writes the source identity in one coherent statement',
  );
  assert.match(
    migration,
    /where sp\.id = v_saved_place_id\s*\n\s*and \(\s*\n\s*coalesce\(trim\(sp\.source_url\), ''\) = ''\s*\n\s*or \(sp\.source_url = p_source_url and coalesce\(sp\.source_type, 'manual'\) = 'manual'\)\s*\n\s*\);/,
    'a different post is excluded from the update entirely',
  );
  // Guard against a regression to two independent per-field updates.
  assert.equal(
    (migration.match(/update public\.saved_places/g) ?? []).length,
    1,
    'exactly one saved_places update in the reuse branch',
  );
  assert.doesNotMatch(migration, /alter table|create table|drop column/i, 'no schema change');
}

console.log('PASS saved-place source enrichment: existing saves are enriched, never discarded or overwritten');
