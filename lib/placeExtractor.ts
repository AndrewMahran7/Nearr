/**
 * Place query extractor.
 *
 * @deprecated STAGE 4 — this module is part of the LEGACY heuristic
 * extraction pipeline. The new backend agent (lib/shareAgent/agent.ts)
 * is now the source of truth for venue selection. This module remains
 * ONLY as the host-app fallback when the agent fails (e.g. no
 * GEMINI_API_KEY, network timeout, server unavailable). Do NOT add new
 * callers. Slated for removal in a future stage once the agent is
 * mandatory and a thin manual-search-only fallback replaces this code
 * path. See docs/ARCHITECTURE.md "Stage 4 cleanup" for the plan.
 *
 * Given the public OG/Twitter/title metadata we pulled from a shared link
 * (TikTok, Instagram, generic), produce ONE concise query string that has
 * the best chance of matching a real venue in Google Places text search.
 *
 * Why this exists:
 *   The naive approach -- feed the cleaned title straight to Places --
 *   fails on captions like:
 *     "Jack's Dining Room on Instagram: My favorite chicken sandwich...
 *      @lecoupe_friedchicken, Los Angeles"
 *   because "Jack's Dining Room" is the *creator*, not the place. The
 *   actual venue lives in the @-handle and the trailing city.
 *
 * How:
 *   1. Strip platform / creator boilerplate ("X on Instagram", etc.).
 *   2. Look for strong place signals in priority order:
 *        a. Text immediately following a location-pin emoji.
 *        b. @handles that are co-located with food/place keywords.
 *        c. Substrings shaped like "<Name>, <City>".
 *        d. A title-cased phrase that doesn't look like a username.
 *   3. Combine the strongest signal with any explicit city found.
 *   4. Score confidence based on which signals fired together.
 *
 * NOTE -- future-proofing:
 *   This is intentionally a *deterministic, local* heuristic so it ships in
 *   V1 with no LLM dependency, no extra latency, and no API key on device.
 *   When we want better results we should replace the body of
 *   `extractPlaceQueryFromShareMetadata` with a fetch to a Supabase Edge
 *   Function that calls an LLM (e.g. OpenAI / Claude) server-side. The
 *   client must NEVER hold an LLM API key directly.
 */

import type { ShareSource } from './shareParser';
import {
  classifyExtractedQuery,
  isGenericContentQuery,
  looksLikeVenueNameCandidate,
} from './queryValidation';

export type PlaceExtractionInput = {
  source: ShareSource;
  title: string | null;
  description: string | null;
  url: string;
  /** Whatever the existing buildQuery() in shareParser produced, if any. */
  cleanedQuery?: string | null;
};

export type PlaceExtractionConfidence = 'high' | 'medium' | 'low';

export type PlaceQueryStrength = 'strong' | 'medium' | 'weak';

export type PlaceExtraction = {
  query: string;
  confidence: PlaceExtractionConfidence;
  /** Short, human-readable reason for debugging / dev surface. */
  reason?: string;
};

export type AccountIdentityExtraction = {
  query: string;
  confidence: PlaceExtractionConfidence;
  reason:
    | 'account-display-name'
    | 'account-handle'
    | 'profile-url-handle';
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Words that strongly suggest a nearby token is the venue (vs. a creator).
const PLACE_KEYWORDS: string[] = [
  'restaurant', 'cafe', 'café', 'coffee', 'bar', 'pub', 'bistro', 'diner',
  'pizza', 'pizzeria', 'taco', 'tacos', 'taqueria', 'sushi', 'ramen',
  'burger', 'bbq', 'barbecue', 'bakery', 'donut', 'doughnut', 'gelato',
  'brewery', 'winery', 'cocktail', 'kitchen', 'grill', 'steakhouse',
  'noodle', 'noodles', 'dumpling', 'thai', 'indian', 'mexican',
  'chicken', 'sandwich', 'deli', 'shop', 'store', 'market', 'eatery',
];

// Extra modifiers we use only for splitting handles -- not for "is this
// placey?" scoring (otherwise "fried" alone would score random handles).
const HANDLE_SPLIT_TOKENS: string[] = [
  ...PLACE_KEYWORDS,
  'fried', 'grilled', 'roasted', 'smoked', 'spicy', 'hot', 'cold', 'sweet',
  'house', 'bros', 'co', 'company',
  // Common city/neighborhood tokens so handles like
  // "villastacoslosangeles" split into "villas tacos los angeles" and
  // "fathersofficesantamonica" splits into "...santa monica".
  'los', 'angeles', 'new', 'york', 'san', 'francisco', 'santa', 'monica',
  'brooklyn', 'queens', 'manhattan', 'venice', 'pasadena', 'arcadia',
  'highland', 'park', 'silver', 'lake', 'echo', 'feliz', 'studio',
  'koreatown', 'chinatown', 'downtown', 'hollywood', 'beverly', 'hills',
];

const LATIN_LETTER_CLASS = 'A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF';
const LATIN_NAME_CHAR_CLASS = `${LATIN_LETTER_CLASS}.'\\u2019-`;
const CAPITALIZED_WORD_RE = `[A-Z][${LATIN_NAME_CHAR_CLASS}]+`;
const HASHTAG_RE = /#[^\s#@]+/g;
const PIN_MARKER_RE = /[📍📌]/g;
const TITLE_POSSESSIVE_RE = new RegExp(`^[A-Z][${LATIN_NAME_CHAR_CLASS}]+'s\\s`);

// Trailing ", City Name" pattern. Up to 4 capitalized words.
const CITY_HINT_RE =
  new RegExp(`,\\s*(${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){0,3})\\s*$`);

// "X on Instagram", "X on TikTok", "(@user) on Instagram" -- the creator
// boilerplate that poisons naive title extraction.
const CREATOR_BOILERPLATE_RE =
  /^(.*?)(?:\s*\(@[^)]+\))?\s+on\s+(?:instagram|tiktok|youtube|facebook)\b.*$/i;

// Location-pin / map emojis. Users very often put one immediately before
// the venue name in a caption.
const LOCATION_EMOJI_RE =
  /[📍📌🗺🌍🌎🌏]/;

// @handles -- letters, digits, dots, underscores.
const HANDLE_RE = /@([A-Za-z0-9._]+)/g;
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][\w'.\- ]{1,50}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|wharf)\b/i;
const CITY_STATE_RE =
  new RegExp(`\\b(${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){0,3}),\\s*([A-Z]{2})\\b`);
const GENERIC_WEAK_PREFIX_RE =
  /^(?:my|our|this|that|best|favorite|hidden gem|vibes|going|follow|check out|come with|come to|run don'?t walk|guys run|need to go|you need to go|you have to try|having fun)\b/i;
const GENERIC_WEAK_QUERY_RE =
  /\b(?:vibes only|good time|with the crew|date night|weekend plans|must try|slaps|so good|fire|yum|yummy|delicious|food recs?)\b/i;
const ACCOUNT_PROFILE_URL_RE =
  /(?:instagram|tiktok)\.com\/(?!(?:p|reel|reels|tv|explore|stories|accounts|video)\b)([A-Za-z0-9._]{2,30})(?:\/|$)/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pick the best Google-Places-friendly query from social metadata.
 *
 * TODO(server-side LLM): replace the body with a call to a Supabase Edge
 * Function (e.g. `/functions/extract-place`) that proxies to an LLM. The
 * client should send `{ source, title, description, url, cleanedQuery }`
 * and receive `{ query, confidence, reason }`. Keep this function's
 * signature stable so callers don't change.
 */
export function extractPlaceQueryFromShareMetadata(
  input: PlaceExtractionInput,
): PlaceExtraction | null {
  const { source, title, description, cleanedQuery } = input;

  const titleStripped = stripCreatorBoilerplate(title);
  const haystack = [titleStripped, description].filter(Boolean).join('\n');

  if (!haystack && !cleanedQuery) return null;

  const pinPick = pickAfterLocationPin(haystack);
  const handlePick = pickPlaceyHandle(haystack);
  const city = pickTrailingCity(haystack);
  const phrasePick = pickTitleCasedPhrase(titleStripped);
  const accountPick = extractAccountIdentityFromShareMetadata(input);

  // Priority: a tagged business handle is the strongest signal, even when a
  // 📍 pin emoji is also present — pins very often hold ONLY a
  // neighborhood / city ("📍 Highland Park, Los Angeles") which is
  // location context, not the business name. When both exist we use the
  // handle as the name and the pin as the location.
  let chosen:
    | { value: string; confidence: PlaceExtractionConfidence; reason: string }
    | null = null;

  // If the pin contains nothing but a neighborhood/city/state phrase, we
  // should treat it as location context rather than the venue name.
  const pinIsLocationOnly = !!pinPick && looksLikeLocationOnly(pinPick);

  if (accountPick && accountPick.reason === 'account-display-name') {
    chosen = {
      value: accountPick.query,
      confidence: accountPick.confidence,
      reason: accountPick.reason,
    };
  } else if (handlePick) {
    const name = humanizeHandle(handlePick);
    // Prefer pin-derived location over a trailing-city match when present,
    // since pins are explicitly marked by the author.
    const location = (pinIsLocationOnly ? pinPick : null) ?? city;
    chosen = {
      value: location ? `${name} ${location}` : name,
      // Handles are medium confidence at most — a raw @ identity cannot be
      // verified as a restaurant from the client. The server-side AI layer
      // provides higher confidence when it has enriched account context.
      confidence: location ? 'medium' : 'low',
      reason: location ? 'handle+location' : 'handle+keyword',
    };
  } else if (pinPick && !pinIsLocationOnly) {
    // Pin holds an actual venue name (e.g. "Tatsu Ramen, Sawtelle Japantown").
    chosen = {
      value: pinPick,
      confidence: 'high',
      reason: 'after-location-pin',
    };
  } else if (phrasePick) {
    chosen = {
      value: phrasePick,
      confidence: city ? 'medium' : 'low',
      reason: city ? 'titlecase+city' : 'titlecase',
    };
  } else if (accountPick) {
    chosen = {
      value: accountPick.query,
      confidence: accountPick.confidence,
      reason: accountPick.reason,
    };
  } else if (pinPick && pinIsLocationOnly) {
    // Pin is location-only AND we have nothing else — still better than
    // returning nothing, but mark low confidence so the caller (Places
    // search + candidate picker) treats it cautiously.
    chosen = {
      value: pinPick,
      confidence: 'low',
      reason: 'pin-location-only',
    };
  } else if (
    cleanedQuery &&
    looksLikeVenueNameCandidate(cleanedQuery) &&
    !isGenericContentQuery(cleanedQuery)
  ) {
    chosen = {
      value: cleanedQuery,
      confidence: 'low',
      reason: 'fallback-cleaned-query',
    };
  }

  if (!chosen) return null;

  // Append city if it isn't already in the chosen string.
  let query = chosen.value.trim();
  if (city && !query.toLowerCase().includes(city.toLowerCase())) {
    query = `${query} ${city}`;
  }
  query = collapseWhitespace(query);
  if (query.length > 120) query = query.slice(0, 120).trim();
  if (!query) return null;
  if (
    classifyExtractedQuery(query, {
      city,
      sourceContext: city,
      accountIdentityOnly:
        chosen.reason === 'account-display-name' ||
        chosen.reason === 'account-handle' ||
        chosen.reason === 'profile-url-handle',
      accountIdentitySource: chosen.reason,
    }) === 'generic_content'
  ) {
    return null;
  }

  void source;
  return { query, confidence: chosen.confidence, reason: chosen.reason };
}

export function extractAccountIdentityFromShareMetadata(
  input: PlaceExtractionInput,
): AccountIdentityExtraction | null {
  const profileHandle = detectProfileUrlHandle(input.url);
  const posterHandle = detectPosterHandle(input.title, input.description, input.url);
  if (profileHandle && isLikelyBusinessIdentity(profileHandle)) {
    return {
      query: humanizeHandle(profileHandle),
      confidence: 'medium',
      reason: 'profile-url-handle',
    };
  }

  const displayName =
    parseDisplayNameFromTitle(input.title) ??
    parseDisplayNameFromDescription(input.description) ??
    null;
  if ((posterHandle || profileHandle) && displayName && isLikelyBusinessIdentity(displayName)) {
    return {
      query: collapseWhitespace(stripHandleSuffix(displayName)),
      confidence: 'medium',
      reason: 'account-display-name',
    };
  }

  if (posterHandle && isLikelyBusinessIdentity(posterHandle)) {
    return {
      query: humanizeHandle(posterHandle),
      confidence: 'low',
      reason: 'account-handle',
    };
  }

  return null;
}

export function classifyPlaceQueryStrength(params: {
  query: string | null | undefined;
  extractionReason?: string | null;
  confidence?: PlaceExtractionConfidence | null;
  sourceContextText?: string | null;
  accountIdentityUsed?: boolean;
}): PlaceQueryStrength {
  const query = collapseWhitespace(params.query ?? '');
  if (!query) return 'weak';

  if (ADDRESS_RE.test(query)) return 'strong';

  const hasContext = !!params.sourceContextText || CITY_STATE_RE.test(query) || looksLikeLocationOnly(query);
  const businessLike = looksLikeBusinessQuery(query) || isLikelyBusinessIdentity(query);
  const confidence = params.confidence ?? null;
  const reason = params.extractionReason ?? '';
  const generic =
    isGenericWeakQuery(query) ||
    classifyExtractedQuery(query, {
      sourceContext: params.sourceContextText,
      accountIdentityOnly: params.accountIdentityUsed,
      accountIdentitySource: params.accountIdentityUsed ? reason : null,
    }) === 'generic_content';

  if (generic && !businessLike) return 'weak';
  if (businessLike && hasContext) return 'strong';
  if (reason === 'after-location-pin' && businessLike) return 'strong';
  if (businessLike && (params.accountIdentityUsed || confidence === 'high' || confidence === 'medium')) {
    return 'medium';
  }
  if (businessLike && tokenizeQuery(query).length >= 3 && !generic) return 'medium';
  return 'weak';
}

export function isExplicitAddressQuery(query: string | null | undefined): boolean {
  return !!query && ADDRESS_RE.test(query);
}

export function isAccountIdentityReason(reason: string | null | undefined): boolean {
  return (
    reason === 'account-display-name' ||
    reason === 'account-handle' ||
    reason === 'profile-url-handle'
  );
}

export function hasExplicitSourceBusinessSignal(
  reason: string | null | undefined,
): boolean {
  return (
    reason === 'after-location-pin' ||
    reason === 'handle+location' ||
    reason === 'titlecase' ||
    reason === 'titlecase+city'
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function stripCreatorBoilerplate(s: string | null): string | null {
  if (!s) return null;
  // "<Creator> on Instagram: <caption>" -- keep the caption.
  const colon = s.match(
    /\bon\s+(?:instagram|tiktok|youtube|facebook)\b\s*[:\u2014-]\s*(.+)$/i,
  );
  if (colon && colon[1]) return colon[1].trim();
  // "<Creator> on Instagram" with no caption -- drop the boilerplate.
  const m = s.match(CREATOR_BOILERPLATE_RE);
  if (m && m[1]) return m[1].trim();
  return s.trim();
}

function detectPosterHandle(
  title: string | null,
  description: string | null,
  sourceUrl: string,
): string | null {
  const profileHandle = detectProfileUrlHandle(sourceUrl);
  if (profileHandle) return profileHandle.toLowerCase();

  if (title) {
    const m = title.match(/\(@([A-Za-z0-9._]{2,30})\)/);
    if (m) return m[1].toLowerCase();
  }

  if (description) {
    const m = description.match(/\(@([A-Za-z0-9._]{2,30})\)\s+on\s+(?:Instagram|TikTok)/i);
    if (m) return m[1].toLowerCase();
  }

  return null;
}

function detectProfileUrlHandle(url: string): string | null {
  const match = url.match(ACCOUNT_PROFILE_URL_RE);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseDisplayNameFromTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const handleMatch = trimmed.match(/^(.+?)\s*\(@[A-Za-z0-9._]{2,30}\)$/);
  if (handleMatch?.[1]) return handleMatch[1].trim();
  const platformMatch = trimmed.match(/^(.+?)\s+on\s+(?:instagram|tiktok)\b/i);
  if (platformMatch?.[1]) return platformMatch[1].trim();
  return null;
}

function parseDisplayNameFromDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/-\s*([^\n]+?)\s*\(@[A-Za-z0-9._]{2,30}\)\s+on\s+(?:Instagram|TikTok)/i);
  return match?.[1]?.trim() ?? null;
}

function stripHandleSuffix(value: string): string {
  return value.replace(/\s*\(@[A-Za-z0-9._]{2,30}\)\s*$/i, '').trim();
}

function pickAfterLocationPin(s: string): string | null {
  if (!s) return null;
  const idx = s.search(LOCATION_EMOJI_RE);
  if (idx < 0) return null;
  // Skip the emoji itself (1-2 code units) and grab a window.
  const tail = s.slice(idx + 2, idx + 2 + 120).split(/[\n\r]/)[0];
  const cleaned = tail
    .replace(HASHTAG_RE, ' ')
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.split(' ').slice(0, 6).join(' ');
}

// ---------------------------------------------------------------------------
// Creator / repost handle detection
//
// Returns true when a handle most likely belongs to a food creator,
// influencer, or repost-aggregator rather than an actual venue. Such
// handles are penalized in pickPlaceyHandle to prevent a wrong-restaurant
// autosave.
//
// This is intentionally conservative: false negatives (e.g. treating an
// unusual restaurant called "Hungry Bear" as a creator) are preferred over
// false positives that silently save the wrong place.
//
// The same constants are duplicated in supabase/functions/process-share-link/
// index.ts (Deno cannot import from lib/). Keep both in sync.
// ---------------------------------------------------------------------------
const _CREATOR_EATS_RE = /eats(?:[a-z]{0,4})?$/;
const _CREATOR_INDICATOR_WORDS: readonly string[] = [
  'foodie', 'hungry', 'munchies', 'tasting',
];
const _REPOST_PREFIX_RE =
  /^(?:la|nyc|sf|chi|miami|seattle|dallas|austin|boston|philly|atl|dc|sd|oc)/;
const _REPOST_SUFFIX_RE =
  /(?:eats|bites|food|grub|spots|picks|finds|guide|scene|digest|insider)$/;

function looksLikeCreatorOrRepostHandle(handle: string): boolean {
  const h = handle.toLowerCase().replace(/[._]/g, '');
  if (_CREATOR_EATS_RE.test(h)) return true;
  for (const w of _CREATOR_INDICATOR_WORDS) {
    if (h.includes(w)) return true;
  }
  if (_REPOST_PREFIX_RE.test(h) && _REPOST_SUFFIX_RE.test(h)) return true;
  return false;
}

function pickPlaceyHandle(s: string): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  const handles: string[] = [];
  let m: RegExpExecArray | null;
  HANDLE_RE.lastIndex = 0;
  while ((m = HANDLE_RE.exec(s)) !== null) {
    handles.push(m[1]);
  }
  if (handles.length === 0) return null;

  let best: { handle: string; score: number } | null = null;
  for (const h of handles) {
    const hLower = h.toLowerCase();
    let score = 0;
    for (const kw of PLACE_KEYWORDS) {
      if (hLower.includes(kw.replace(/\s+/g, ''))) score += 2;
      if (lower.includes(kw)) score += 1;
    }
    if (/^\d+$/.test(hLower)) score -= 5;
    // Penalize creator / repost handles — they are not restaurant identities.
    if (looksLikeCreatorOrRepostHandle(h)) score -= 10;
    if (!best || score > best.score) best = { handle: h, score };
  }

  // Require positive score after creator penalty.
  if (!best || best.score <= 0) return null;
  return best.handle;
}

function humanizeHandle(handle: string): string {
  // "lecoupe_friedchicken" -> "lecoupe fried chicken". We deliberately do
  // NOT title-case here; Places handles casing fine and lower-case keeps
  // it from looking like a brand we invented.
  let s = handle.replace(/[._]+/g, ' ').toLowerCase();

  // Iteratively split known compound tokens out of any longer runs.
  // Run twice so adjacent tokens (e.g. "friedchicken") both get split.
  for (let pass = 0; pass < 2; pass++) {
    for (const tok of HANDLE_SPLIT_TOKENS) {
      const compact = tok.replace(/\s+/g, '');
      if (!/^[a-z]+$/.test(compact)) continue;
      // Insert a space BEFORE the token when it's preceded by another letter:
      //   "friedchicken" -> "fried chicken"
      const reBefore = new RegExp(`([a-z])(${compact})(?=[a-z]|$)`, 'g');
      s = s.replace(reBefore, '$1 $2');
      // Insert a space AFTER the token when it's followed by another letter:
      //   "chickensandwich" -> "chicken sandwich"
      const reAfter = new RegExp(`(^|\\s)(${compact})(?=[a-z])`, 'g');
      s = s.replace(reAfter, '$1$2 ');
    }
  }

  return collapseWhitespace(s);
}

function isLikelyBusinessIdentity(value: string): boolean {
  const normalized = collapseWhitespace(value).toLowerCase();
  if (!normalized) return false;
  if (looksLikeCreatorOrRepostHandle(normalized)) return false;
  if (GENERIC_WEAK_QUERY_RE.test(normalized)) return false;

  const compact = normalized.replace(/[^a-z0-9 ]+/g, ' ');
  const tokens = compact.split(/\s+/).filter(Boolean);
  const placeKeywordHits = tokens.filter((token) =>
    PLACE_KEYWORDS.some((keyword) => keyword.replace(/\s+/g, '') === token || keyword === token),
  ).length;

  if (placeKeywordHits >= 1 && tokens.length >= 2) return true;
  if (tokens.length >= 3 && /^[a-z0-9 ._'-]+$/i.test(value) && !GENERIC_WEAK_PREFIX_RE.test(value)) {
    return true;
  }
  return false;
}

function looksLikeBusinessQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return PLACE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function pickTrailingCity(s: string): string | null {
  if (!s) return null;
  const lines = s.split(/[\n\r]/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(CITY_HINT_RE);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function pickTitleCasedPhrase(titleStripped: string | null): string | null {
  const candidate = titleStripped;
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  const hasKeyword = PLACE_KEYWORDS.some((kw) => lower.includes(kw));
  // "Jack's Dining Room" without any food keyword -> probably the creator.
  const looksLikeCreator =
    TITLE_POSSESSIVE_RE.test(candidate) && !hasKeyword;
  if (looksLikeCreator) return null;

  const first = candidate.split(/[.\u2014\-:|\u2022]/)[0].trim();
  if (!first) return null;
  // Reject obvious sentences ("My favorite chicken sandwich is...").
  if (/^(my|the|i|we|our|this|that|here|today)\b/i.test(first)) return null;
  return first.length > 80 ? first.slice(0, 80).trim() : first;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function tokenizeQuery(s: string): string[] {
  return collapseWhitespace(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function isGenericWeakQuery(query: string): boolean {
  const trimmed = collapseWhitespace(query);
  if (!trimmed) return true;
  if (GENERIC_WEAK_PREFIX_RE.test(trimmed) || GENERIC_WEAK_QUERY_RE.test(trimmed)) {
    return true;
  }
  const tokens = tokenizeQuery(trimmed);
  if (tokens.length <= 2 && !looksLikeBusinessQuery(trimmed) && !ADDRESS_RE.test(trimmed)) {
    return true;
  }
  return false;
}

// Words that, on their own or as part of a comma-list, identify a place as
// pure geographic context (a neighborhood / city / state) rather than the
// name of a business. Used so we don't save "Highland Park" when the post
// also tagged a real restaurant.
const LOCATION_ONLY_HINTS = new Set<string>([
  'la', 'los angeles', 'nyc', 'new york', 'sf', 'san francisco', 'dtla',
  'brooklyn', 'queens', 'manhattan', 'bronx', 'highland park', 'silver lake',
  'echo park', 'koreatown', 'ktown', 'sawtelle', 'venice', 'santa monica',
  'culver city', 'pasadena', 'long beach', 'arcadia', 'studio city',
  'west hollywood', 'weho', 'beverly hills', 'downtown', 'midtown', 'soho',
  'tribeca', 'williamsburg', 'bushwick', 'astoria', 'flushing', 'chinatown',
  'little tokyo', 'grand central market', 'french quarter', 'nola',
]);

const US_STATE_RE =
  /\b(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;

/**
 * Heuristic: return true if `s` looks like JUST a location string
 * (neighborhood / city / state), not a venue name. Used to demote
 * pin-emoji content that contains only geography.
 */
export function looksLikeLocationOnly(s: string): boolean {
  if (!s) return false;
  const cleaned = s
    .toLowerCase()
    .replace(PIN_MARKER_RE, '')
    .replace(/[.,]+$/g, '')
    .trim();
  if (!cleaned) return false;

  // Comma-separated location list: "Highland Park, Los Angeles, CA".
  const parts = cleaned.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const allLocationy = parts.every(
      (p) =>
        LOCATION_ONLY_HINTS.has(p) ||
        US_STATE_RE.test(p) ||
        // Short "City Name" tokens with no business keyword.
        (/^[a-z][a-z .'-]{1,30}$/.test(p) && !containsPlaceKeyword(p)),
    );
    if (allLocationy) return true;
  }

  // Single phrase that exactly matches a known neighborhood / city.
  if (LOCATION_ONLY_HINTS.has(cleaned)) return true;

  return false;
}

function containsPlaceKeyword(s: string): boolean {
  const lower = s.toLowerCase();
  return PLACE_KEYWORDS.some((kw) => lower.includes(kw));
}
