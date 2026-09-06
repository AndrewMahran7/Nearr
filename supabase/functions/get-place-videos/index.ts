// @ts-nocheck -- Supabase Edge/Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = 'place-video-thumbnails';
const SIGNED_TTL = 3600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } });
}
function enabled() { return /^(true|1|yes|on)$/i.test((Deno.env.get('PLACE_VIDEO_GALLERY_ENABLED') ?? '').trim()); }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!enabled()) return json({ error: 'feature_disabled' }, 404);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  if (!supabaseUrl || !serviceKey || !anonKey || !authorization) return json({ error: 'unauthorized' }, 401);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const requestedPlaceId = typeof body.placeId === 'string' && UUID.test(body.placeId) ? body.placeId : null;
  if (!requestedPlaceId) return json({ error: 'invalid_place_id' }, 400);
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body.limit) || 20)));
  const includeCommunity = body.includeCommunity === true;
  const cursor = typeof body.cursor === 'string' && !Number.isNaN(Date.parse(body.cursor)) ? body.cursor : null;

  let placeId = requestedPlaceId;
  let placeName: string | null = null;
  const seen = new Set<string>();
  for (let depth = 0; depth < 16; depth += 1) {
    if (seen.has(placeId)) return json({ error: 'place_unavailable' }, 404);
    seen.add(placeId);
    const { data } = await admin.from('places').select('id,name,merged_into_place_id').eq('id', placeId).maybeSingle();
    if (!data) return json({ error: 'place_not_found' }, 404);
    placeName = data.name;
    if (!data.merged_into_place_id) break;
    placeId = data.merged_into_place_id;
  }

  const { data: saves, error: savesError } = await admin
    .from('saved_places').select('id').eq('user_id', auth.user.id).eq('place_id', placeId);
  if (savesError) return json({ error: 'query_failed' }, 503);
  const saveIds = (saves ?? []).map((row) => row.id);
  const { data: ownerSources } = saveIds.length
    ? await admin.from('saved_place_sources')
        .select('identity_key,platform,canonical_url,original_url,creator_handle,creator_name,thumbnail_url,first_attached_at')
        .in('saved_place_id', saveIds)
        .in('platform', ['instagram','tiktok','facebook','youtube','snapchat'])
        .order('first_attached_at', { ascending: false })
    : { data: [] };
  const ownerKeys = [...new Set((ownerSources ?? []).map((row) => row.identity_key))];
  const { data: ownerMedia } = ownerKeys.length
    ? await admin.from('place_video_media').select('*').eq('place_id', placeId).in('identity_key', ownerKeys)
    : { data: [] };
  const mediaByKey = new Map((ownerMedia ?? []).map((row) => [row.identity_key, row]));

  let communityQuery = admin.from('place_video_media').select('*', { count: 'exact' })
    .eq('place_id', placeId)
    .eq('community_visibility', 'PUBLIC_SOURCE_ELIGIBLE')
    .eq('source_reachability', 'REACHABLE')
    .eq('is_synthetic', false)
    .not('representative_frame_storage_path', 'is', null)
    .order('created_at', { ascending: false }).limit(includeCommunity ? limit + 1 : 1);
  if (ownerKeys.length) communityQuery = communityQuery.not('identity_key', 'in', `(${ownerKeys.map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`);
  if (cursor) communityQuery = communityQuery.lt('created_at', cursor);
  const communityResult = includeCommunity ? await communityQuery : { data: [], count: 0, error: null };
  if (communityResult.error) return json({ error: 'query_failed' }, 503);
  const communityRows = (communityResult.data ?? []).slice(0, limit);

  const allPaths = [...new Set([
    ...(ownerSources ?? []).map((source) => mediaByKey.get(source.identity_key)?.representative_frame_storage_path),
    ...communityRows.map((row) => row.representative_frame_storage_path),
  ].filter(Boolean))];
  const signed = allPaths.length ? await admin.storage.from(BUCKET).createSignedUrls(allPaths, SIGNED_TTL) : { data: [] };
  const signedByPath = new Map((signed.data ?? []).filter((row) => row.path && row.signedUrl).map((row) => [row.path, row.signedUrl]));
  const ownerSeen = new Set<string>();
  const ownerVideos = (ownerSources ?? []).flatMap((source) => {
    if (ownerSeen.has(source.identity_key)) return [];
    ownerSeen.add(source.identity_key);
    const media = mediaByKey.get(source.identity_key);
    const thumbnailUrl = (media?.representative_frame_storage_path && signedByPath.get(media.representative_frame_storage_path)) || source.thumbnail_url;
    if (!thumbnailUrl) return [];
    return [{
      sourceId: source.identity_key,
      thumbnailUrl,
      platform: source.platform,
      creatorHandle: source.creator_handle ?? source.creator_name ?? null,
      originalUrl: source.original_url ?? source.canonical_url,
      ownership: 'OWNER',
      createdAt: source.first_attached_at,
    }];
  });
  const communityVideos = communityRows.flatMap((row) => {
    const thumbnailUrl = signedByPath.get(row.representative_frame_storage_path);
    if (!thumbnailUrl) return [];
    return [{
      sourceId: row.identity_key,
      thumbnailUrl,
      platform: row.platform,
      creatorHandle: row.creator_handle ?? row.creator_name ?? null,
      originalUrl: row.original_url ?? row.canonical_url,
      ownership: 'COMMUNITY',
      createdAt: row.created_at,
    }];
  });
  const hasMore = (communityResult.data ?? []).length > limit;
  return json({
    placeId,
    placeName,
    ownerVideos,
    communityVideos,
    totalVideoCount: ownerVideos.length + Number(communityResult.count ?? 0),
    nextCursor: hasMore ? communityRows.at(-1)?.created_at ?? null : null,
  });
});
