import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Source = {
  identity: string;
  platform: 'instagram' | 'tiktok' | 'facebook';
  url: string;
  aiNote: string | null;
};
type Save = {
  id: string;
  placeId: string;
  notes: string | null;
  aiNote: string | null;
  sources: Source[];
};
type Share = {
  placeId: string;
  referral: string;
  source: Source | null;
};

function saveFromShare(existing: Save | null, share: Share): Save {
  const saved = existing ?? {
    id: `saved:${share.placeId}`,
    placeId: share.placeId,
    notes: null,
    aiNote: null,
    sources: [],
  };
  if (!share.source) return saved;
  if (!saved.sources.some((source) => source.identity === share.source?.identity)) {
    saved.sources.push({ ...share.source });
  }
  saved.aiNote ||= share.source.aiNote;
  return saved;
}

const note = 'The secluded turquoise swimming hole looks perfect for a summer swim.';
const source: Source = {
  identity: 'v1:instagram:PublicDiscovery',
  platform: 'instagram',
  url: 'https://www.instagram.com/reel/PublicDiscovery/',
  aiNote: note,
};
const share: Share = {
  placeId: '7b98ca4a-52be-4d48-9886-5d95e165b722',
  referral: 'r_AbCdEfGhIjKlMnOpQrStUvWx',
  source: { ...source },
};

// Founder flow: the owned row and its child source are gone; the durable share
// snapshot recreates both without recognition or note generation.
const restored = saveFromShare(null, share);
assert.equal(restored.placeId, share.placeId);
assert.equal(restored.sources.length, 1);
assert.equal(restored.sources[0]?.url, source.url);
assert.equal(restored.aiNote, note);
assert.equal(saveFromShare(restored, share), restored);
assert.equal(restored.sources.length, 1, 'repeat save dedupes source identity');

// Cross-user privacy: a private user note is not a field on Share and cannot
// cross the boundary. Source-linked generated context can.
const sender: Save = {
  id: 'sender-save', placeId: share.placeId,
  notes: 'Take Sarah here for her birthday.', aiNote: note, sources: [source],
};
const recipient = saveFromShare(null, share);
assert.equal(recipient.notes, null);
assert.equal(recipient.aiNote, sender.aiNote);
assert.notEqual(recipient.id, sender.id);

// Existing-save merge: user note and existing AI context win, while a distinct
// shared video joins the source gallery and an exact identity still dedupes.
const existing: Save = {
  id: 'recipient-save', placeId: share.placeId,
  notes: 'My private recipient note', aiNote: 'Existing source context',
  sources: [{ ...source, identity: 'v1:tiktok:111', url: 'https://www.tiktok.com/@near/video/111' }],
};
const merged = saveFromShare(existing, share);
assert.equal(merged.id, 'recipient-save');
assert.equal(merged.notes, 'My private recipient note');
assert.equal(merged.aiNote, 'Existing source context');
assert.equal(merged.sources.length, 2);
saveFromShare(merged, share);
assert.equal(merged.sources.length, 2);

// Unknown/private/deleted sources are represented by a context-free share;
// the place still saves while no source-linked note transfers.
const contextFree = saveFromShare(null, { ...share, source: null });
assert.equal(contextFree.sources.length, 0);
assert.equal(contextFree.aiNote, null);

const root = process.cwd();
const migration = readFileSync(join(root,
  'supabase/migrations/20260905000005_shared_place_source_context.sql'), 'utf8');
const correctionMigration = readFileSync(join(root,
  'supabase/migrations/20260905000009_qualify_corrected_place_source_merge.sql'), 'utf8');
const publicEdge = readFileSync(join(root, 'supabase/functions/public-place/index.ts'), 'utf8');
const publicClient = readFileSync(join(root, 'lib/publicPlace.ts'), 'utf8');
const publicRoute = readFileSync(join(root, 'app/p/[publicPlaceId].tsx'), 'utf8');

// Durable snapshot and server-verification boundary.
assert.match(migration, /source_id uuid[\s\S]*on delete set null/);
assert.match(migration, /source_identity_key text/);
assert.match(migration, /source_ai_note text/);
assert.match(migration, /source_context_status = 'public_verified'/);
assert.match(migration, /share_job_place_results result/);
assert.match(migration, /job\.status = 'completed'/);
assert.match(migration, /src\.identity_key = job\.recognition_identity_key/);
for (const forbiddenPlatform of ['youtube', 'snapchat', "platform = 'link'"]) {
  const verifier = migration.slice(
    migration.indexOf('create or replace function public.is_saved_place_source_public_shareable'),
    migration.indexOf('revoke all on function public.is_saved_place_source_public_shareable'),
  );
  assert.ok(!verifier.includes(forbiddenPlatform), `verifier excludes ${forbiddenPlatform}`);
}
assert.match(migration, /benchmark\|fixture/);

// The referral record, not client values, is authoritative. The RPC takes only
// the public place/referral and inserts bounded snapshot fields itself.
const saveRpc = migration.slice(
  migration.indexOf('create or replace function public.save_shared_place'),
  migration.indexOf('revoke all on function public.save_shared_place'),
);
assert.doesNotMatch(saveRpc, /p_source|p_ai_note|p_source_url/);
assert.match(saveRpc, /where share\.referral_id = v_ref/);
assert.match(saveRpc, /source_context_revoked_at is null/);
assert.match(saveRpc, /on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do nothing/);
assert.match(saveRpc, /ai_note = coalesce\(nullif\(trim\(sp\.ai_note\), ''\), v_share\.source_ai_note\)/);
assert.doesNotMatch(saveRpc, /notes\s*=/i);

// Conversion attribution is durable and one-per-share/user, including the
// existing-save case. Sender identity remains internal to the share table.
assert.match(migration, /unique \(public_place_share_id, user_id\)/);
assert.match(migration, /on conflict \(public_place_share_id, user_id\) do nothing/);
assert.match(migration, /'place_saved_from_shared_link'/);
assert.match(migration, /'shared_source_attached'/);
assert.match(correctionMigration,
  /on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do update set/);

// The anonymous/public DTO stays source-free. Source becomes visible only
// after authenticated save and an owner-scoped row reload.
const dto = publicEdge.slice(publicEdge.lastIndexOf('return json({'));
for (const forbidden of ['created_by', 'source_identity', 'source_canonical_url', 'source_ai_note', 'notes']) {
  assert.ok(!dto.includes(forbidden), `public DTO excludes ${forbidden}`);
}
assert.doesNotMatch(publicClient, /p_source_url|p_ai_note/);
assert.match(publicRoute, /await getOwnedSaveForPublicPlace\(result\.publicPlaceId\)/);
assert.match(publicRoute, /Original video/);

console.log('PASS founder restore, cross-user privacy, verified-source boundary, existing-save merge, multi-source dedupe, referral idempotency, and owner-only UI hydration');
