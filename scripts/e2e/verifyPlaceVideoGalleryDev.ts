/** Dev-only live contract smoke for Place Video Gallery V1. */
import { randomUUID } from 'node:crypto';

import { createEphemeralIdentity, openSession, type EphemeralIdentity } from './session';

type Gallery = {
  placeId: string;
  ownerVideos: Array<{ sourceId: string; originalUrl: string; ownership: string }>;
  communityVideos: Array<{ sourceId: string; originalUrl: string; ownership: string }>;
  totalVideoCount: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function main() {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  const owner = session.identity!;
  let viewer: EphemeralIdentity | null = null;
  let placeId: string | null = null;
  const storagePaths: string[] = [];
  try {
    viewer = await createEphemeralIdentity(session.admin, session.config, `${session.correlationId}-viewer`);
    const suffix = randomUUID();
    const { data: place, error: placeError } = await session.admin.from('places').insert({
      google_place_id: `nearr-e2e-place-video-${suffix}`,
      name: 'Nearr E2E Place Video Gallery',
      formatted_address: 'Development fixture — ephemeral',
      latitude: 33.6595,
      longitude: -117.9988,
      category: 'restaurant',
    }).select('id').single();
    if (placeError || !place) throw new Error(`place fixture failed: ${placeError?.message ?? 'missing row'}`);
    placeId = place.id;

    const urls = [
      'https://www.instagram.com/reel/DJ1CVA8vbfV/',
      'https://www.instagram.com/reel/DWrKNRujq4X/',
      'https://www.instagram.com/reel/DWJ2zaqEQOk/',
    ];
    const identities = urls.map((url, index) => ({
      identity_key: `v1:instagram:place-video-e2e-${suffix}-${index + 1}`,
      identity_version: 1,
      platform: 'instagram',
      content_id: `place-video-e2e-${suffix}-${index + 1}`,
      canonical_url: url,
      original_url: url,
      creator_handle: `public_creator_${index + 1}`,
    }));
    const { data: ownerSave, error: ownerSaveError } = await session.admin.from('saved_places').insert({
      user_id: owner.userId, place_id: placeId, source_type: 'instagram', source_url: urls[0],
    }).select('id').single();
    if (ownerSaveError || !ownerSave) throw new Error(`owner save failed: ${ownerSaveError?.message ?? 'missing row'}`);
    const { error: sourcesError } = await session.admin.from('saved_place_sources').insert(identities.map((source, index) => ({
      ...source, saved_place_id: ownerSave.id, user_id: owner.userId, is_primary: index === 0,
    })));
    if (sourcesError) throw new Error(`owner sources failed: ${sourcesError.message}`);

    const { data: viewerSave, error: viewerSaveError } = await session.admin.from('saved_places').insert({
      user_id: viewer.userId, place_id: placeId, source_type: 'instagram', source_url: urls[0],
    }).select('id').single();
    if (viewerSaveError || !viewerSave) throw new Error(`viewer save failed: ${viewerSaveError?.message ?? 'missing row'}`);
    const { error: viewerSourceError } = await session.admin.from('saved_place_sources').insert({
      ...identities[0], saved_place_id: viewerSave.id, user_id: viewer.userId, is_primary: true,
    });
    if (viewerSourceError) throw new Error(`viewer source failed: ${viewerSourceError.message}`);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    for (let index = 0; index < 5; index += 1) {
      const path = `${placeId}/e2e-${suffix}-${index + 1}.jpg`;
      const { error } = await session.admin.storage.from('place-video-thumbnails').upload(path, jpeg, {
        contentType: 'image/jpeg', upsert: true,
      });
      if (error) throw new Error(`thumbnail ${index + 1} failed: ${error.message}`);
      storagePaths.push(path);
    }
    const now = new Date().toISOString();
    const media: Array<Record<string, unknown>> = identities.map((source, index) => ({
      place_id: placeId, ...source,
      representative_frame_storage_path: storagePaths[index],
      representative_frame_timestamp_seconds: index + 1,
      community_visibility: 'PUBLIC_SOURCE_ELIGIBLE', source_reachability: 'REACHABLE',
      public_access_verified_at: now, is_synthetic: false,
    }));
    media.push({
      place_id: placeId, identity_key: `v1:instagram:private-${suffix}`, identity_version: 1,
      platform: 'instagram', content_id: `private-${suffix}`, canonical_url: urls[0], original_url: urls[0],
      creator_handle: 'private_fixture', representative_frame_storage_path: storagePaths[3],
      representative_frame_timestamp_seconds: 4, community_visibility: 'PRIVATE_SOURCE',
      source_reachability: 'REACHABLE', public_access_verified_at: null, is_synthetic: false,
    });
    media.push({
      place_id: placeId, identity_key: `v1:instagram:unknown-${suffix}`, identity_version: 1,
      platform: 'instagram', content_id: `unknown-${suffix}`, canonical_url: urls[1], original_url: urls[1],
      creator_handle: 'unknown_fixture', representative_frame_storage_path: storagePaths[4],
      representative_frame_timestamp_seconds: 5, community_visibility: 'UNKNOWN',
      source_reachability: 'UNKNOWN', public_access_verified_at: null, is_synthetic: true,
    });
    const { error: mediaError } = await session.admin.from('place_video_media').upsert(media, { onConflict: 'place_id,identity_key' });
    if (mediaError) throw new Error(`media fixture failed: ${mediaError.message}`);

    const request = async (identity: EphemeralIdentity): Promise<{ gallery: Gallery; raw: string }> => {
      const response = await fetch(`${session.config.supabaseUrl}/functions/v1/get-place-videos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${identity.accessToken}`, apikey: session.config.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ placeId, includeCommunity: true, limit: 20 }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`gallery endpoint ${response.status}: ${raw.slice(0, 200)}`);
      return { gallery: JSON.parse(raw) as Gallery, raw };
    };
    const ownerResult = await request(owner);
    assert(ownerResult.gallery.ownerVideos.length === 3, 'three distinct videos remain three owner tiles');
    assert(ownerResult.gallery.communityVideos.length === 0, 'owner precedence removes owner/community duplicates');
    assert(ownerResult.gallery.ownerVideos.map((item) => item.originalUrl).join('|') === urls.join('|'), 'owner tiles retain their exact original post URLs');

    const viewerResult = await request(viewer);
    assert(viewerResult.gallery.ownerVideos.length === 1, 'viewer-owned source is in From your saves');
    assert(viewerResult.gallery.communityVideos.length === 2, 'other eligible public sources are community tiles');
    assert(!viewerResult.raw.match(/user_id|saved_place_id|share_job|caption|transcript/i), 'gallery DTO exposes no saver identity or private diagnostics');
    assert(!viewerResult.raw.includes('private_fixture') && !viewerResult.raw.includes('unknown_fixture'), 'private, unknown, and synthetic sources are excluded');
    assert(viewerResult.gallery.totalVideoCount === 3, 'deduped total count is three videos');
  } finally {
    if (storagePaths.length) await session.admin.storage.from('place-video-thumbnails').remove(storagePaths);
    if (viewer) await session.admin.auth.admin.deleteUser(viewer.userId);
    await session.cleanup();
    if (placeId) await session.admin.from('places').delete().eq('id', placeId);
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
