// supabase/functions/process-share-link/index.ts
//
// Server-side handler for the iOS Share Extension's "silent save" flow.
//
// Input  (POST JSON):
//   { url: string, accessToken?: string }
//
// Output (JSON):
//   {
//     status: "saved" | "ambiguous" | "failed_requires_app" | "open_app",
//     message?: string,
//     savedPlaceId?: string,
//     candidates?: PlaceCandidate[],
//     reason?: string
//   }
//
// Runtime: Supabase Edge Functions (Deno).
//
// Required env (set via `supabase secrets set ...`):
//   SUPABASE_URL                  (auto-populated by Supabase runtime)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-populated by Supabase runtime)
//   GEMINI_API_KEY                (optional — heuristic fallback if missing)
//   GOOGLE_PLACES_KEY             (required — server-side text search)
//
// Constraints:
//   - NO secrets ever leak to the client/extension. All calls to Gemini /
//     Google Places happen here.
//   - On any unexpected error we return { status: "open_app" } so the
//     extension falls back to the existing deep-link flow and the user is
//     never stuck.
//   - Saving is idempotent: dedupe places by google_place_id, upsert
//     saved_places by (user_id, place_id).

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — this file targets the Deno Edge runtime, not the RN tsconfig.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ---------------------------------------------------------------------------
// Types (mirrors of the contract documented in ShareExtension.tsx)
// ---------------------------------------------------------------------------

type ResultCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
};

type Result =
  | { status: 'saved'; savedPlaceId: string; message?: string }
  | { status: 'ambiguous'; candidates: ResultCandidate[]; reason?: string; message?: string }
  | { status: 'failed_requires_app'; reason?: string; message?: string }
  | { status: 'open_app'; reason?: string; message?: string };

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ status: 'open_app', reason: 'method_not_allowed' }, 405);
  }

  let body: { url?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return json({ status: 'open_app', reason: 'invalid_json' }, 400);
  }

  const url = (body.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ status: 'open_app', reason: 'missing_url' }, 400);
  }

  // Accept token from body OR Authorization: Bearer <jwt>.
  const headerAuth = req.headers.get('authorization') ?? '';
  const bearer = headerAuth.toLowerCase().startsWith('bearer ')
    ? headerAuth.slice(7).trim()
    : '';
  const accessToken = (body.accessToken ?? bearer ?? '').trim();

  try {
    const result = await processShareLink(url, accessToken);
    return json(result, 200);
  } catch (err) {
    console.error('[process-share-link] unhandled error', err);
    return json({ status: 'open_app', reason: 'server_error' }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function processShareLink(url: string, accessToken: string): Promise<Result> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const PLACES_KEY =
    Deno.env.get('GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ??
    '';

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.warn('[process-share-link] missing supabase env');
    return { status: 'open_app', reason: 'server_misconfigured' };
  }
  if (!PLACES_KEY) {
    console.warn('[process-share-link] missing GOOGLE_PLACES_KEY');
    return { status: 'open_app', reason: 'server_misconfigured' };
  }

  // ---- 1. authenticate user ------------------------------------------
  if (!accessToken) {
    return { status: 'open_app', reason: 'missing_auth' };
  }
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser(accessToken);
  if (userErr || !userRes?.user) {
    console.log('[process-share-link] auth failed', userErr?.message);
    return { status: 'open_app', reason: 'invalid_auth' };
  }
  const userId = userRes.user.id;

  // ---- 2. parse share metadata ---------------------------------------
  const source = detectSource(url);
  let title: string | null = null;
  let description: string | null = null;
  try {
    const html = await fetchHtml(url);
    title =
      pickMeta(html, 'og:title') ??
      pickMeta(html, 'twitter:title') ??
      pickTitle(html);
    description =
      pickMeta(html, 'og:description') ??
      pickMeta(html, 'twitter:description') ??
      null;
    title = cleanTitle(title);
    description = cleanDescription(description);
  } catch (err) {
    console.log('[process-share-link] metadata fetch failed', (err as Error)?.message);
  }

  const heuristicQuery = buildQuery(title, description);

  // ---- 3. AI extraction (Gemini) -------------------------------------
  const ai = await extractPlaceAI({
    sourceType: source,
    url,
    title: title ?? undefined,
    description: description ?? undefined,
    fallbackQuery: heuristicQuery ?? undefined,
  });

  const chosenQuery = (ai.query && ai.query.trim()) || heuristicQuery || '';
  const confidence: 'high' | 'medium' | 'low' = ai.confidence;

  if (!chosenQuery) {
    return { status: 'failed_requires_app', reason: 'no_query' };
  }

  // ---- 4. Google Places search ---------------------------------------
  let candidates: ResultCandidate[];
  try {
    candidates = await searchPlaces(chosenQuery, PLACES_KEY);
  } catch (err) {
    console.warn('[process-share-link] places search failed', (err as Error)?.message);
    return { status: 'open_app', reason: 'places_error' };
  }

  // Filter out raw geocoded addresses / regions — we never want to silently
  // save "Highland Park" or a street address. The host app's flow has more
  // sophisticated address-resolution logic; here we just defer to it.
  const businesses = candidates.filter(
    (c) => !isAddressLikeTypes(c.types) && !isLocalityLikeTypes(c.types),
  );

  if (businesses.length === 0) {
    if (candidates.length > 0) {
      // We got results but they were all addresses/regions — let the host
      // app try its richer resolution.
      return { status: 'failed_requires_app', reason: 'address_only' };
    }
    return { status: 'failed_requires_app', reason: 'no_candidate' };
  }

  // ---- 5. decide silent-save vs ambiguous ----------------------------
  // Silent save only when:
  //   - AI confidence is "high"
  //   - exactly one strong business candidate (or one clearly dominant)
  const top = businesses[0];
  const second = businesses[1];

  const dominant =
    !second ||
    (confidence === 'high' && nameOverlapScore(top.name, chosenQuery) >= 1);

  const canSilentSave = confidence === 'high' && dominant;

  if (!canSilentSave) {
    return {
      status: 'ambiguous',
      candidates: businesses.slice(0, 5),
      reason: 'multiple_candidates',
    };
  }

  // ---- 6. save (idempotent) ------------------------------------------
  try {
    const savedPlaceId = await saveForUser(
      userClient,
      userId,
      top,
      url,
      source,
    );
    return {
      status: 'saved',
      savedPlaceId,
      message: `Saved “${top.name}” to Nearr`,
    };
  } catch (err) {
    console.warn('[process-share-link] save failed', (err as Error)?.message);
    return { status: 'failed_requires_app', reason: 'save_error' };
  }
}

// ---------------------------------------------------------------------------
// Save logic (mirrors services/savedPlacesService.ts contract)
// ---------------------------------------------------------------------------

async function saveForUser(
  client: any,
  userId: string,
  c: ResultCandidate,
  sourceUrl: string,
  source: 'tiktok' | 'instagram' | 'link',
): Promise<string> {
  // 1. Resolve canonical places row (SELECT first, INSERT only if missing).
  let placeId: string | null = null;
  if (c.googlePlaceId) {
    const { data: existing, error: lookupErr } = await client
      .from('places')
      .select('id')
      .eq('google_place_id', c.googlePlaceId)
      .maybeSingle();
    if (lookupErr) throw new Error(`place lookup: ${lookupErr.message}`);
    if (existing) placeId = existing.id;
  }

  if (!placeId) {
    const payload = {
      google_place_id: c.googlePlaceId,
      name: c.name,
      formatted_address: c.formattedAddress ?? null,
      latitude: c.latitude,
      longitude: c.longitude,
      category: pickCategory(c.types),
      google_maps_url: null, // textsearch doesn't return canonical URL
    };
    const { data: inserted, error: insertErr } = await client
      .from('places')
      .insert(payload)
      .select('id')
      .single();
    if (insertErr) {
      // 23505: race with another concurrent insert. Recover by re-selecting.
      if ((insertErr as any).code === '23505' && c.googlePlaceId) {
        const { data: raced } = await client
          .from('places')
          .select('id')
          .eq('google_place_id', c.googlePlaceId)
          .maybeSingle();
        if (raced) placeId = raced.id;
      }
      if (!placeId) throw new Error(`place insert: ${insertErr.message}`);
    } else {
      placeId = inserted.id;
    }
  }

  // 2. Upsert saved_places by (user_id, place_id).
  const savedPayload = {
    user_id: userId,
    place_id: placeId,
    radius_value: null, // use profile default
    radius_unit: null,
    source_type: source,
    source_url: sourceUrl,
    notes: null,
  };

  const { data: saved, error: savedErr } = await client
    .from('saved_places')
    .insert(savedPayload)
    .select('id')
    .single();

  if (savedErr) {
    if ((savedErr as any).code === '23505') {
      // Already saved; refresh source fields and return existing id.
      const { data: existingSaved } = await client
        .from('saved_places')
        .select('id')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .maybeSingle();
      if (existingSaved) {
        await client
          .from('saved_places')
          .update({ source_type: source, source_url: sourceUrl })
          .eq('id', existingSaved.id);
        return existingSaved.id;
      }
    }
    throw new Error(`saved_places insert: ${savedErr.message}`);
  }
  return saved.id;
}

// ---------------------------------------------------------------------------
// Google Places (server-side text search)
// ---------------------------------------------------------------------------

async function searchPlaces(query: string, key: string): Promise<ResultCandidate[]> {
  const params = new URLSearchParams({ query, key });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
  );
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  const json = await res.json();
  const status = json.status as string;
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    throw new Error(`Places ${status}: ${json.error_message ?? ''}`);
  }
  return (json.results ?? []).slice(0, 8).map((r: any) => ({
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? undefined,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    types: Array.isArray(r.types) ? r.types : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Gemini (server-side AI extraction)
// ---------------------------------------------------------------------------

type AIResult = { query: string; confidence: 'high' | 'medium' | 'low'; reason: string };

async function extractPlaceAI(input: {
  sourceType?: string;
  url?: string;
  title?: string;
  description?: string;
  fallbackQuery?: string;
}): Promise<AIResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!apiKey) {
    return {
      query: (input.fallbackQuery ?? input.title ?? '').trim(),
      confidence: 'low',
      reason: 'GEMINI_API_KEY not configured',
    };
  }
  const prompt = buildAIPrompt(input);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('empty gemini response');
    const obj = JSON.parse(extractJsonObject(text) ?? text);
    const query = typeof obj.query === 'string' ? obj.query.trim() : '';
    const confRaw = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : '';
    const confidence: 'high' | 'medium' | 'low' =
      confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'low';
    if (!query) {
      return {
        query: (input.fallbackQuery ?? '').trim(),
        confidence: 'low',
        reason: 'gemini empty query',
      };
    }
    return { query, confidence, reason: typeof obj.reason === 'string' ? obj.reason : '' };
  } catch (err) {
    console.log('[process-share-link] gemini failed', (err as Error)?.message);
    return {
      query: (input.fallbackQuery ?? input.title ?? '').trim(),
      confidence: 'low',
      reason: 'gemini error',
    };
  }
}

function buildAIPrompt(input: {
  sourceType?: string;
  url?: string;
  title?: string;
  description?: string;
  fallbackQuery?: string;
}): string {
  return [
    'You are a place-extraction assistant for a maps app.',
    'Identify the SINGLE real-world business or place referenced by this social media share.',
    'Ignore creator handles, hashtags, emoji, and platform boilerplate.',
    'Prefer tagged business handles (@name) and named venues over neighborhoods.',
    'If only a neighborhood/city is mentioned (no business), confidence MUST be "low".',
    'Return STRICT JSON: {"query": string, "confidence": "high"|"medium"|"low", "reason": string}',
    '',
    `sourceType: ${input.sourceType ?? ''}`,
    `url: ${input.url ?? ''}`,
    `title: ${input.title ?? ''}`,
    `description: ${input.description ?? ''}`,
    `fallbackQuery: ${input.fallbackQuery ?? ''}`,
  ].join('\n');
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Share metadata (ported from lib/shareParser.ts, RN-free)
// ---------------------------------------------------------------------------

const USER_AGENT = 'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const FETCH_TIMEOUT_MS = 8000;

function detectSource(url: string): 'tiktok' | 'instagram' | 'link' {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  return 'link';
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function pickMeta(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtml(m[1]);
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtml(m[1]) : null;
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim()
    .replace(/\s+on TikTok.*/i, '')
    .replace(/\s*\|\s*Instagram.*/i, '')
    .replace(/\s*•\s*Instagram.*/i, '')
    .replace(/\s*\(@[^)]+\)\s*on Instagram.*/i, '')
    .replace(/\s*-\s*YouTube.*/i, '')
    .trim()
    .replace(/^["\u201C\u201D'`]+|["\u201C\u201D'`]+$/g, '')
    .trim();
  return s || null;
}

function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 240) s = s.slice(0, 237).trimEnd() + '\u2026';
  return s;
}

function buildQuery(title: string | null, description: string | null): string | null {
  const candidate = title ?? firstSentence(description);
  if (!candidate) return null;
  let q = candidate
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+on Instagram\b.*$/i, ' ')
    .replace(/\s+on TikTok\b.*$/i, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{So}\p{Sk}]/gu, ' ')
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length > 120) q = q.slice(0, 120).trim();
  return q || null;
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^[^.!?\n]{4,}/);
  return m ? m[0].trim() : s.trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Place type filtering (subset of services/placesService.ts)
// ---------------------------------------------------------------------------

const ADDRESS_LIKE = new Set([
  'street_address','premise','subpremise','route','intersection',
  'postal_code','postal_code_prefix','postal_code_suffix','plus_code','geocode',
]);
const LOCALITY_LIKE = new Set([
  'locality','sublocality','sublocality_level_1','sublocality_level_2',
  'neighborhood','administrative_area_level_1','administrative_area_level_2',
  'administrative_area_level_3','country','political',
]);
const BUSINESS_LIKE = new Set([
  'restaurant','cafe','bar','bakery','food','meal_takeaway','meal_delivery',
  'store','shopping_mall','clothing_store','book_store','grocery_or_supermarket',
  'supermarket','convenience_store','gym','spa','beauty_salon','lodging',
  'museum','art_gallery','movie_theater','night_club','tourist_attraction',
  'amusement_park','park','stadium','liquor_store','pharmacy','pet_store',
]);

function isAddressLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => ADDRESS_LIKE.has(t));
}
function isLocalityLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => LOCALITY_LIKE.has(t));
}

function pickCategory(types?: string[]): string | null {
  if (!types?.length) return null;
  const skip = new Set(['point_of_interest', 'establishment', 'food']);
  const first = types.find((t) => !skip.has(t)) ?? types[0];
  return first ? first.replace(/_/g, ' ') : null;
}

const STOP = new Set(['the','and','for','restaurant','cafe','bar','food','place']);
function nameOverlapScore(name: string, query: string): number {
  const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x));
  const c = new Set(tok(name));
  let hits = 0;
  for (const t of tok(query)) if (c.has(t)) hits++;
  return hits;
}
