// @ts-nocheck -- Supabase Edge/Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF_RE = /^r_[A-Za-z0-9_-]{20,64}$/;
const EVENT_NAMES = new Set([
  'shared_place_save_cta',
  'shared_place_open_in_app_cta',
  'shared_place_get_app_cta',
]);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 90;
const rateWindows = new Map<string, { startedAt: number; count: number }>();

type PlaceRow = {
  id: string;
  merged_into_place_id: string | null;
  name: string;
  category: string | null;
  formatted_address: string | null;
  short_formatted_address: string | null;
  google_primary_type: string | null;
  google_type_label: string | null;
  latitude: number;
  longitude: number;
  business_status: string | null;
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function placeIdFromUrl(url: URL): string | null {
  const marker = '/public-place/';
  const offset = url.pathname.indexOf(marker);
  if (offset < 0) return null;
  const tail = url.pathname.slice(offset + marker.length);
  const id = tail.split('/')[0] ?? '';
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

function cleanRef(value: unknown): string | null {
  return typeof value === 'string' && REF_RE.test(value) ? value : null;
}

function cleanChannel(value: unknown): 'web' | 'app' {
  return value === 'app' ? 'app' : 'web';
}

// Lightweight abuse control for one Edge isolate. The client address is kept
// only in memory, never logged or persisted. Platform-level limits remain the
// outer boundary; this stops one caller from cheaply amplifying DB writes.
function requestAllowed(request: Request): boolean {
  const now = Date.now();
  if (rateWindows.size > 4_096) {
    for (const [key, value] of rateWindows) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateWindows.delete(key);
    }
  }
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = request.headers.get('cf-connecting-ip')?.trim() || forwarded || 'unknown';
  const key = `${address}:${request.method}`;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

function addressParts(address: string | null) {
  const parts = (address ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const country = parts.length >= 2 ? parts[parts.length - 1] : null;
  const regionPart = parts.length >= 3 ? parts[parts.length - 2] : null;
  const locality = parts.length >= 3 ? parts[parts.length - 3] : parts.length === 2 ? parts[0] : null;
  const region = regionPart?.replace(/\s+\d[\d -]*$/, '') || null;
  return { locality, region, country };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }

  const url = new URL(request.url);
  const requestedId = placeIdFromUrl(url);
  if (!requestAllowed(request)) {
    return json({ error: 'rate_limited' }, 429, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
  }
  if (!requestedId) return json({ error: 'place_not_found' }, 404);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'service_unavailable' }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const seen = new Set<string>();
  let currentId = requestedId;
  let place: PlaceRow | null = null;
  for (let depth = 0; depth < 16; depth += 1) {
    if (seen.has(currentId)) return json({ error: 'place_unavailable' }, 404);
    seen.add(currentId);
    const { data, error } = await db
      .from('places')
      .select('id, merged_into_place_id, name, category, formatted_address, short_formatted_address, google_primary_type, google_type_label, latitude, longitude, business_status')
      .eq('id', currentId)
      .maybeSingle();
    if (error) {
      console.error('[public-place] lookup_failed', error.message);
      return json({ error: 'service_unavailable' }, 503);
    }
    if (!data) return json({ error: 'place_not_found' }, 404);
    place = data as PlaceRow;
    if (!place.merged_into_place_id) break;
    currentId = place.merged_into_place_id;
    place = null;
  }
  if (!place) return json({ error: 'place_unavailable' }, 404);
  if (place.business_status === 'CLOSED_PERMANENTLY') {
    return json({ error: 'place_unavailable' }, 404);
  }

  const channel = cleanChannel(url.searchParams.get('channel'));
  let referralId = cleanRef(url.searchParams.get('ref'));
  let referralValid = false;
  if (referralId) {
    const { data: share } = await db
      .from('public_place_shares')
      .select('canonical_place_id')
      .eq('referral_id', referralId)
      .maybeSingle();
    if (share?.canonical_place_id) {
      const { data: shareCanonical } = await db.rpc('resolve_public_place_id', {
        p_public_id: share.canonical_place_id,
      });
      referralValid = shareCanonical === place.id;
    }
    if (!referralValid) referralId = null;
  }

  const baseProperties = {
    requested_public_place_id: requestedId,
    public_place_id: place.id,
    referral_id: referralId,
    referral_valid: referralValid,
    channel,
    redirected: requestedId !== place.id,
  };

  if (request.method === 'POST') {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    const eventName = typeof body.eventName === 'string' ? body.eventName : '';
    if (!EVENT_NAMES.has(eventName)) return json({ error: 'invalid_event' }, 400);
    const { error } = await db.from('analytics_events').insert({
      user_id: null,
      event_name: eventName,
      properties: baseProperties,
      platform: cleanChannel(body.channel),
    });
    if (error) console.warn('[public-place] event_insert_failed', error.message);
    return json({ ok: true }, 202, { 'Cache-Control': 'no-store' });
  }

  const eventNames = ['place_link_opened', `place_link_opened_${channel}`, 'shared_place_viewed'];
  const { error: analyticsError } = await db.from('analytics_events').insert(
    eventNames.map((eventName) => ({
      user_id: null,
      event_name: eventName,
      properties: baseProperties,
      platform: channel,
    })),
  );
  if (analyticsError) console.warn('[public-place] open_event_insert_failed', analyticsError.message);

  const location = addressParts(place.formatted_address);
  return json({
    requestedPublicId: requestedId,
    publicId: place.id,
    redirected: requestedId !== place.id,
    name: place.name,
    category: place.category,
    placeType: place.google_type_label ?? place.google_primary_type,
    locality: location.locality,
    region: location.region,
    country: location.country,
    displayAddress: place.formatted_address ?? place.short_formatted_address,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    heroImage: null,
    originalVideoUrl: null,
    available: true,
  }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  });
});
