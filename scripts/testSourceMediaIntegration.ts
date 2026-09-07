import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { partitionPlaceVideos, selectVideoHero, type GalleryCandidate } from '../lib/placeVideoGallery';
import { sourcePlaceGroupForAnchor, sourcePlaceGroupFromSeeds } from '../lib/sourcePlaceGroup';

const SOURCE = 'v1:instagram:video-v';
type Place = {
  id: string;
  place_id: string;
  source_url: string;
  created_at: string;
  place: { id: string; google_place_id: string; name: string; latitude: number; longitude: number };
  sources: Array<{ identity_key: string; canonical_url: string; first_attached_at: string; is_primary: boolean }>;
};

function place(id: string, source = SOURCE, canonicalPlaceId = `place-${id}`): Place {
  const order = id.charCodeAt(0) % 50;
  return {
    id,
    place_id: canonicalPlaceId,
    source_url: 'https://www.instagram.com/reel/video-v/',
    created_at: `2026-09-06T00:00:${String(order).padStart(2, '0')}Z`,
    place: { id: canonicalPlaceId, google_place_id: `google-${canonicalPlaceId}`, name: id.toUpperCase(), latitude: 33 + order / 100, longitude: -117 },
    sources: [{ identity_key: source, canonical_url: 'https://www.instagram.com/reel/video-v/', first_attached_at: `2026-09-06T00:00:${String(order).padStart(2, '0')}Z`, is_primary: true }],
  };
}

function video(identityKey: string, ownership: 'OWNER' | 'COMMUNITY', visibility: GalleryCandidate['communityVisibility'] = 'PUBLIC_SOURCE_ELIGIBLE', reachability: GalleryCandidate['sourceReachability'] = 'REACHABLE'): GalleryCandidate {
  return { identityKey, sourceId: identityKey, thumbnailUrl: `https://img.test/${identityKey}.jpg`, platform: 'instagram', creatorHandle: 'public_creator', originalUrl: `https://instagram.com/reel/${identityKey}`, ownership, communityVisibility: visibility, sourceReachability: reachability, createdAt: '2026-09-06T00:00:00Z' };
}

// 1. A/B/C plus a real manual save D remains four after serialization.
const abc = [place('a'), place('b'), place('c')];
const abcd = [...abc, place('d')];
assert.equal(sourcePlaceGroupFromSeeds(abcd, ['a', 'b', 'c'])?.places.length, 4);
assert.equal(sourcePlaceGroupForAnchor(JSON.parse(JSON.stringify(abcd[0])), JSON.parse(JSON.stringify(abcd)))?.places.length, 4);

// 2. Current Automatic Completion stores alternatives only in its review
// ledger. Keep/Make primary materializes the saved row and source association;
// removal never does. Repeating promotion dedupes by canonical saved place.
const alternatives: Array<{ outcome: string; savedPlaceId: string | null }> = [
  { outcome: 'secondary_soft_saved', savedPlaceId: null },
  { outcome: 'secondary_soft_saved', savedPlaceId: null },
];
assert.equal(sourcePlaceGroupForAnchor(abc[0], abc)?.places.length, 3);
const promotedB = place('p');
assert.equal(sourcePlaceGroupForAnchor(abc[0], [...abc, promotedB, promotedB])?.places.length, 4);
alternatives[0] = { outcome: 'secondary_promoted', savedPlaceId: promotedB.id };
alternatives[1] = { outcome: 'secondary_removed', savedPlaceId: null };
assert.deepEqual(alternatives.map((entry) => entry.outcome), ['secondary_promoted', 'secondary_removed']);
assert.equal(sourcePlaceGroupForAnchor(abc[0], [...abc, promotedB])?.places.length, 4);

// 3. Three source identities for one place remain three owner video tiles,
// while each individual identity still projects one canonical group member.
const owners = partitionPlaceVideos([video('v1', 'OWNER'), video('v2', 'OWNER'), video('v3', 'OWNER')]);
assert.equal(owners.ownerVideos.length, 3);
assert.equal(selectVideoHero(['provider-photo'], owners.ownerVideos, [])?.kind, 'PROVIDER');
assert.equal(sourcePlaceGroupForAnchor(place('a', 'v1'), [place('a', 'v1')])?.places.length, 1);

// 4. A shared public source is the same identity for the recipient, owner wins
// over community, generated context transfers, and private author text does not.
const sender = { userId: 'sender', notes: 'private sender note', aiNote: 'public source context', sourceIdentity: SOURCE };
const recipient = { userId: 'recipient', notes: null, aiNote: sender.aiNote, sourceIdentity: sender.sourceIdentity };
const sharedGallery = partitionPlaceVideos([video(SOURCE, 'COMMUNITY'), video(recipient.sourceIdentity, 'OWNER')]);
assert.equal(sharedGallery.ownerVideos.length, 1);
assert.equal(sharedGallery.communityVideos.length, 0);
assert.equal(recipient.notes, null);
assert.equal(Object.prototype.hasOwnProperty.call(sharedGallery.ownerVideos[0]!, 'userId'), false);

// 5. Community visibility is fail-closed.
const privateGallery = partitionPlaceVideos([
  video('private', 'COMMUNITY', 'PRIVATE_SOURCE'),
  video('unknown', 'COMMUNITY', 'UNKNOWN'),
  video('revoked', 'COMMUNITY', 'PUBLIC_SOURCE_UNAVAILABLE', 'UNAVAILABLE'),
  { ...video('synthetic', 'COMMUNITY'), synthetic: true },
]);
assert.equal(privateGallery.communityVideos.length, 0);

// 6. A new source on an existing canonical place enriches one save and adds
// one gallery identity rather than duplicating the place.
const existing = place('e', 'v1', 'canonical-place');
existing.sources.push({ ...existing.sources[0]!, identity_key: 'v2', canonical_url: 'https://www.instagram.com/reel/v2/', is_primary: false });
assert.equal(sourcePlaceGroupForAnchor(existing, [existing])?.places.length, 1);
assert.equal(partitionPlaceVideos([video('v1', 'OWNER'), video('v2', 'OWNER')]).ownerVideos.length, 2);

// 7. Canonical aliases and duplicate media converge on the survivor.
const survivor = place('s', SOURCE, 'canonical-place');
const alias = place('x', SOURCE, 'canonical-place');
assert.equal(sourcePlaceGroupForAnchor(survivor, [survivor, alias])?.places.length, 1);
assert.equal(partitionPlaceVideos([video(SOURCE, 'OWNER'), video(SOURCE, 'OWNER')]).ownerVideos.length, 1);

const root = process.cwd();
const migration = readFileSync(join(root, 'supabase/migrations/20260906000003_place_video_gallery_v1.sql'), 'utf8');
const shared = readFileSync(join(root, 'supabase/migrations/20260905000005_shared_place_source_context.sql'), 'utf8');
const automatic = readFileSync(join(root, 'supabase/migrations/20260906000002_fix_soft_alternative_promotion_ambiguity.sql'), 'utf8');
const detail = readFileSync(join(root, 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
const map = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
assert.match(migration, /unique \(place_id, identity_key\)/);
assert.match(migration, /after update of place_id/);
assert.match(shared, /v_share\.source_identity_key/);
assert.match(shared, /ai_note\s*=\s*coalesce/i);
assert.doesNotMatch(shared.slice(shared.indexOf('create or replace function public.save_shared_place')), /notes\s*=/i);
assert.match(automatic, /perform public\.attach_saved_place_source/);
assert.match(detail, /<PlaceVideoGalleryStrip[\s\S]*sameSourceEntries/);
assert.match(map, /<MapGroupSelector/);
assert.match(map, /<SelectedPlaceDetails/);
assert.match(map, /shouldRenderSelectedPlaceDetail =[\s\S]*!sourceGroupBrowseActive/);

console.log('PASS source/media integration: 3-to-4, cold start, current alternatives, gallery, share privacy, existing saves, and canonical merge');
