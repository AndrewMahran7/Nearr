import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  partitionPlaceVideos,
  selectRepresentativeFrame,
  selectVideoHero,
  videoGridColumnCount,
  type GalleryCandidate,
  type PlaceVideoItem,
} from '../lib/placeVideoGallery';

const frame = (id: string, timestampSeconds: number, extra: Record<string, unknown> = {}) => ({ id, timestampSeconds, storagePath: `u/j/t/${id}.jpg`, ...extra });
const selected = selectRepresentativeFrame([frame('only', 4)]);
assert.equal(selected?.id, 'only', '1. one video yields one representative');
assert.equal(selectRepresentativeFrame([frame('a', 1), frame('b', 2), frame('c', 3), frame('d', 4), frame('e', 5)])?.id, 'a', '2. five frames still yield one');
assert.equal(selectRepresentativeFrame([frame('far', 1, { relevance: 'vayrin_selected' }), frame('place', 18, { relevance: 'candidate_evidence' })], [18.2])?.id, 'place', '4. place timestamp wins');
assert.equal(selectRepresentativeFrame([frame('blurry', 1, { sharpness: 0.1 }), frame('sharp', 1, { sharpness: 0.9 })])?.id, 'sharp', '5. sharp frame wins');
assert.equal(selectRepresentativeFrame([frame('face', 1, { faceOnly: true }), frame('wide', 1, { width: 1600, height: 900 })])?.id, 'wide', '6. contextual frame wins');

const video = (identityKey: string, ownership: 'OWNER' | 'COMMUNITY', visibility: GalleryCandidate['communityVisibility'] = 'PUBLIC_SOURCE_ELIGIBLE', reachability: GalleryCandidate['sourceReachability'] = 'REACHABLE'): GalleryCandidate => ({
  identityKey, sourceId: identityKey, thumbnailUrl: `https://images.test/${identityKey}.jpg`, platform: 'instagram', creatorHandle: 'creator', originalUrl: `https://instagram.com/reel/${identityKey}`, ownership, communityVisibility: visibility, sourceReachability: reachability, createdAt: '2026-09-05T12:00:00Z',
});
const partitioned = partitionPlaceVideos([
  video('same', 'COMMUNITY'), video('same', 'OWNER'), video('same', 'OWNER'),
  video('public', 'COMMUNITY'), video('private', 'COMMUNITY', 'PRIVATE_SOURCE'),
  video('unknown', 'COMMUNITY', 'UNKNOWN'), video('gone', 'COMMUNITY', 'PUBLIC_SOURCE_ELIGIBLE', 'UNAVAILABLE'),
  { ...video('synthetic', 'COMMUNITY'), synthetic: true },
]);
assert.deepEqual(partitioned.ownerVideos.map((item) => item.sourceId), ['same'], '3/8. duplicate owner source is one tile');
assert.deepEqual(partitioned.communityVideos.map((item) => item.sourceId), ['public'], '9-12/15/47. only safe public community, owner precedence');
assert.equal(Object.prototype.hasOwnProperty.call(partitioned.communityVideos[0]!, 'userId'), false, '13. saver id absent');
assert.equal(partitioned.communityVideos[0]?.creatorHandle, 'creator', '14. public creator attribution retained');
const threeOwnerVideos = partitionPlaceVideos([video('video-a', 'OWNER'), video('video-b', 'OWNER'), video('video-c', 'OWNER')]);
assert.deepEqual(threeOwnerVideos.ownerVideos.map((item) => item.sourceId), ['video-a', 'video-b', 'video-c'], '45. three different videos for one place all remain');

const owner = partitioned.ownerVideos[0] as PlaceVideoItem;
const community = partitioned.communityVideos[0] as PlaceVideoItem;
assert.equal(selectVideoHero(['provider'], [owner], [community])?.kind, 'PROVIDER', '16/17. provider media remains first');
assert.equal(selectVideoHero([], [owner], [community])?.kind, 'OWNER_VIDEO', '23. owner video hero fallback');
assert.equal(selectVideoHero([], [], [community])?.kind, 'COMMUNITY_VIDEO', '24. eligible community hero fallback');
assert.equal(selectVideoHero([], [], []), null, '25. normal empty fallback');
assert.equal(videoGridColumnCount(), 2, '26. grid is two columns');

const detail = readFileSync(resolve('components/map/SelectedPlaceDetails.tsx'), 'utf8');
const strip = readFileSync(resolve('components/PlaceVideoGalleryStrip.tsx'), 'utf8');
const page = readFileSync(resolve('app/place/[id]/videos.tsx'), 'utf8');
const endpoint = readFileSync(resolve('supabase/functions/get-place-videos/index.ts'), 'utf8');
const migration = readFileSync(resolve('supabase/migrations/20260906000003_place_video_gallery_v1.sql'), 'utf8');
const promotion = readFileSync(resolve('supabase/functions/process-share-jobs/placeVideoMedia.ts'), 'utf8');
const flags = readFileSync(resolve('lib/featureFlags.ts'), 'utf8');
assert.match(strip, /providerPhotos\.map[\s\S]*kind: 'marker'[\s\S]*ownerVideos[\s\S]*communityVideos/, '16-18. provider/divider/owner/community order');
assert.match(strip, /FROM\{`\\n`\}VIDEOS/, '17. compact divider');
assert.match(detail, /openPlaceVideo[\s\S]*Linking\.openURL/, '20-21. tiles open original post');
assert.match(detail, /!videoGalleryEnabled && shouldShowMoreVideos/, '22. flag off preserves legacy gallery');
assert.match(page, /FROM YOUR SAVES[\s\S]*FOUND BY THE NEARR COMMUNITY/, '27-28. page sections');
assert.match(page, /Saved by you[\s\S]*Nearr community/, '29. labels');
assert.match(page, /creatorHandle[\s\S]*platformName/, '30. creator/platform metadata');
assert.match(page, /Linking\.openURL\(video\.originalUrl\)/, '31. original opens directly');
assert.match(page, /nextCursor[\s\S]*onEndReached/, '32. cursor pagination');
assert.match(page, /if \(!values\.length\) return/, '33. empty headers hidden');
assert.doesNotMatch(page, /user_id|saved_place_id|caption_excerpt|transcript|candidate_payload|storage_path/i, '34. private internals are not rendered');
assert.match(page, /headerBackTitle: 'Back'/, '35. back navigation');
assert.match(endpoint, /PUBLIC_SOURCE_ELIGIBLE[\s\S]*REACHABLE[\s\S]*is_synthetic/, '10-12. endpoint privacy filters');
assert.doesNotMatch(endpoint, /userId:\s*auth\.user\.id/, '13. DTO never returns saver identity');
assert.match(endpoint, /limit \+ 1[\s\S]*nextCursor/, '32. backend pagination bounded');
assert.match(migration, /unique \(place_id, identity_key\)/, '7/15/27. canonical source dedupe');
assert.match(migration, /after update of place_id/, '27. place merge association follows canonical correction');
assert.match(migration, /default 'UNKNOWN'/, '11/21. unknown is fail-closed');
assert.match(migration, /explicit[\s\S]*restriction outranks[\s\S]*PRIVATE_SOURCE[\s\S]*OWNER_ONLY[\s\S]*PUBLIC_SOURCE_UNAVAILABLE[\s\S]*PUBLIC_SOURCE_ELIGIBLE/, '27. canonical merge conflicts fail closed');
assert.match(promotion, /chooseFrame[\s\S]*GALLERY_BUCKET[\s\S]*upload/, '6. one retained frame promoted safely');
assert.match(promotion, /place-video-thumbnails/, '7. promoted frame survives share-evidence cleanup');
assert.match(flags, /EXPO_PUBLIC_PLACE_VIDEO_GALLERY_ENABLED/, '37. client flag exists');
assert.match(endpoint, /PLACE_VIDEO_GALLERY_ENABLED/, '37/39. server flag exists');

for (const event of ['place_video_gallery_viewed','place_video_thumbnail_tapped','place_video_original_opened','place_videos_page_opened','community_video_impression','community_video_opened','owner_video_opened','hero_video_frame_used']) {
  assert.ok(detail.includes(event) || page.includes(event), `analytics event wired: ${event}`);
}
assert.match(detail, /videoHero[\s\S]*Saved by you[\s\S]*Nearr community/, '48. hero video provenance visible');

console.log('PASS place video gallery frame, privacy, dedupe, gallery, page, hero, pagination, and analytics contracts');
