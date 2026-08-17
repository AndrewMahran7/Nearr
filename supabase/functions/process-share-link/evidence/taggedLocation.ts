// supabase/functions/process-share-link/evidence/taggedLocation.ts
//
// First-class "tagged location" evidence — a structured place/location a
// platform attaches to a post OUTSIDE the caption text (e.g. YouTube
// `recordingDetails.location`, a TikTok POI/anchor, an Instagram location tag).
//
// STATUS: wired for Instagram only. YouTube and TikTok remain interface-only
// (see their branches below) and still return null, so their behavior is
// unchanged.
//
// Instagram is recovered from the PUBLIC, UNAUTHENTICATED post page Nearr
// already fetches in `metadata/fetchMetadata.ts` — no login, no cookies, no
// private API, and NO additional HTTP request. When a creator uses Instagram's
// built-in location feature, that page carries a typed location object in its
// inline bootstrap JSON:
//
//   "location":{"__typename":"XDTLocationDict","pk":214579632,
//               "lat":33.5226,"lng":-117.7157,"name":"Laguna Niguel, California"}
//
// and an untagged post carries `"location":null` in the same slot. Verified
// across 18 posts from Nearr's own corpus: 14 tagged, 4 untagged, no false
// positives and no false negatives.
//
// GRANULARITY IS NOT KNOWN HERE. Roughly half of the tags observed name an
// exact business ("Pho Bamboo", "Deli Nerds") and half name a city ("Huntington
// Beach, California"). This module deliberately does NOT guess which — that
// would need a gazetteer, and this codebase classifies geography structurally
// from provider entity types, never from the words in a name. The tag is
// emitted as a plain signal and `resolver/resolveSharedPlace.ts` decides, from
// Google's own entity types, whether it is an exact place or geographic
// context. That distinction is what keeps a city tag from ever becoming the
// saved destination.
//
// This module is intentionally dependency-free and side-effect-free.

import type { SourcePlatform } from '../types.ts';

/** Where a piece of evidence originated. */
export type EvidenceSourceType =
  | 'tagged_location'
  | 'description'
  | 'transcript'
  | 'ocr'
  | 'creator_bio'
  | 'comments'
  | 'user_input';

/** The platform an evidence signal came from (narrower than SourcePlatform). */
export type EvidenceSourcePlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'generic';

/** Confidence the PROVIDER assigns to the raw signal (pre-verification). */
export type EvidenceConfidence = 'high' | 'medium' | 'low';

/**
 * A structured location signal attached to a post by the platform, separate
 * from free-text caption/description. Any subset of the optional fields may be
 * present depending on the provider — the resolver uses whatever is available
 * (name/address/coords/external id) to VERIFY against Google Places.
 */
export type TaggedLocationSignal = {
  sourceType: EvidenceSourceType;
  sourcePlatform: EvidenceSourcePlatform;
  /** Human-readable label, e.g. "Blue Bottle Coffee, Oakland". */
  rawText?: string | null;
  /** The provider's raw object, kept for diagnostics (no secrets). */
  rawMetadata?: Record<string, unknown> | null;
  confidence: EvidenceConfidence;
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Provider place id (e.g. Google `place_id`, Foursquare `fsq_id`). */
  externalPlaceId?: string | null;
  /**
   * Exactly which first-party feature produced this signal. `sourceType` +
   * `sourcePlatform` already narrow it, but a single explicit value keeps the
   * origin legible end-to-end and impossible to confuse with caption, model,
   * visual or comment evidence once the signal has travelled a few boundaries.
   */
  provenance?: TaggedLocationProvenance | null;
  /**
   * The PLATFORM's own id for the tagged location (Instagram's location `pk`).
   * Deliberately separate from `externalPlaceId`: this is not a Google/
   * Foursquare id and must never be handed to a provider as one.
   */
  sourceLocationId?: string | null;
};

/** Closed vocabulary of first-party tagged-location origins. */
export type TaggedLocationProvenance = 'instagram_location_tag';

/**
 * What a tagged location turned out to DENOTE, decided from provider entity
 * types at resolve time — never from the words in the tag's name.
 *
 *   exact_place        — a business/POI. A hypothesis strong enough to lead
 *                        verification, still confirmed by the user.
 *   geographic_context — a locality/region/country. Scopes the search; can
 *                        never itself become the saved destination.
 *   unknown            — the provider returned nothing usable to classify it.
 */
export type TaggedLocationGranularity = 'exact_place' | 'geographic_context' | 'unknown';

/** Map the resolver's `SourcePlatform` to the narrower evidence platform. */
export function toEvidencePlatform(
  platform: SourcePlatform,
): EvidenceSourcePlatform {
  switch (platform) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'tiktok';
    case 'youtube':
      return 'youtube';
    default:
      return 'generic';
  }
}

/**
 * Extract a platform-tagged location, if one is available WITHOUT any new
 * provider, any additional request, or any unsafe scraping.
 *
 * Instagram reads the tag out of the public page HTML the caller already has.
 * Every other platform still returns null and is unchanged.
 */
export function extractTaggedLocation(_args: {
  platform: SourcePlatform;
  html: string;
  resolvedUrl: string;
  title: string | null;
  description: string | null;
}): TaggedLocationSignal | null {
  switch (_args.platform) {
    case 'youtube':
      // TODO(tagged-location/youtube): when a YouTube Data API v3 provider is
      // available, call `videos.list?part=recordingDetails` and map
      // `recordingDetails.location` { latitude, longitude } +
      // `recordingDetails.locationDescription` into a TaggedLocationSignal
      // (sourceType: 'tagged_location', sourcePlatform: 'youtube',
      // confidence: 'high'). Requires an API key + provider; NOT wired here.
      // Returning null falls back to the existing caption/description path.
      return null;
    case 'tiktok':
      // TODO(tagged-location/tiktok): when the provider returns a tagged
      // place/POI object (anchor / poi_info), map its name/address/coords
      // here. The keyless oEmbed endpoint does NOT expose it and the mobile
      // API requires auth, so no signal is available yet. Returning null
      // falls back to caption/transcript extraction.
      return null;
    case 'instagram':
      return extractInstagramTaggedLocation(_args.html);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

const MAX_LOCATION_NAME = 200;
/** Widest slice we will ever brace-match for one location object. */
const MAX_LOCATION_OBJECT_CHARS = 4_000;
/** The typed marker Instagram stamps on the object. Searched WITHOUT quotes so
 *  the same scan finds it whether the payload is inline or backslash-escaped. */
const LOCATION_DICT_MARKER = 'XDTLocationDict';

/**
 * Recover the creator's Instagram location tag from already-fetched public page
 * HTML. Returns null whenever the tag is absent, unparseable, or carries
 * nothing usable — absence is the NORMAL case for most posts and is never an
 * error, so callers simply continue with caption/media evidence as before.
 */
export function extractInstagramTaggedLocation(
  html: string | null | undefined,
): TaggedLocationSignal | null {
  if (typeof html !== 'string' || !html) return null;

  let searchFrom = 0;
  // Instagram has historically emitted the bootstrap payload more than once.
  // Take the first occurrence that actually parses into something usable.
  for (;;) {
    const marker = html.indexOf(LOCATION_DICT_MARKER, searchFrom);
    if (marker === -1) return null;
    searchFrom = marker + LOCATION_DICT_MARKER.length;
    const dict = parseEnclosingObject(html, marker);
    if (!dict) continue;
    const signal = toInstagramSignal(dict);
    if (signal) return signal;
  }
}

/**
 * Brace-match the JSON object containing `markerIndex` and parse it.
 *
 * The location object is flat (string/number/null values only), so scanning
 * back to the nearest `{` finds its start. Parsing is string-aware so a brace
 * inside a value can never end the object early, and the whole thing is
 * bounded — a markup change that removes the closing brace costs a bounded
 * scan and yields null rather than anything unbounded.
 */
function parseEnclosingObject(
  source: string,
  markerIndex: number,
): Record<string, unknown> | null {
  let start = -1;
  const floor = Math.max(0, markerIndex - MAX_LOCATION_OBJECT_CHARS);
  for (let i = markerIndex; i >= floor; i--) {
    if (source[i] === '{') {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const ceiling = Math.min(source.length, start + MAX_LOCATION_OBJECT_CHARS);
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < ceiling; i++) {
    const ch = source[i];
    if (inString) {
      // A backslash escapes the next character, including a quote. This is
      // what makes the scan correct for the escaped payload variant too.
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;

  const slice = source.slice(start, end);
  const parsed = parseMaybeEscapedJson(slice);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Parse a JSON object that may be embedded raw or backslash-escaped. */
function parseMaybeEscapedJson(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    // Not raw JSON — the payload was embedded as an escaped string.
  }
  try {
    return JSON.parse(slice.replace(/\\"/g, '"'));
  } catch {
    return null;
  }
}

/** Map a parsed location dict onto the shared signal shape, or null when it
 *  identifies nothing we can act on. */
function toInstagramSignal(
  dict: Record<string, unknown>,
): TaggedLocationSignal | null {
  if (dict.__typename !== LOCATION_DICT_MARKER) return null;

  // The NAME is what makes a tag actionable — it is the creator's statement of
  // identity, and it is what the resolver verifies against Google. A dict
  // carrying only coordinates identifies nothing we could confirm, and letting
  // one through would put an empty query on the provider, so it is dropped
  // whole rather than half-kept. Every tag observed across the corpus had one.
  const placeName = boundedName(dict.name);
  if (!placeName) return null;
  const coords = validCoordinates(dict.lat, dict.lng);

  return {
    sourceType: 'tagged_location',
    sourcePlatform: 'instagram',
    provenance: 'instagram_location_tag',
    // The creator chose this from Instagram's own place index, so the raw
    // signal is high-confidence. It is still verified against Google before
    // any candidate is surfaced, and never auto-saved on its own.
    confidence: 'high',
    placeName,
    rawText: placeName,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    sourceLocationId: boundedLocationId(dict.pk),
  };
}

function boundedName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, MAX_LOCATION_NAME) : null;
}

/**
 * Coordinates are accepted only when BOTH are real, in range, and not the null
 * island. A tag that carries a broken pair still contributes its name — the
 * bad field fails closed on its own rather than discarding the whole signal.
 */
function validCoordinates(
  lat: unknown,
  lng: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Exactly (0,0) is the classic "coordinates were never set" sentinel, not a
  // point in the Gulf of Guinea anyone tagged.
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

/** Instagram's numeric location id, as a bounded string. Provenance only. */
function boundedLocationId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d{1,24}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}
