import { isGenericContentQuery } from './queryValidation';

/**
 * Evidence-based extraction pipeline (v2).
 *
 * @deprecated STAGE 4 — this is part of the LEGACY pipeline. The
 * authoritative auto-save / candidate decision is now made by the
 * backend agent (lib/shareAgent/agent.ts) gated by lib/shareAgent/safety.ts.
 * This module remains ONLY as the host-app and eval-script fallback
 * when the agent is unavailable. Do NOT add new callers. Slated for
 * removal once the agent is mandatory.
 *
 * Single source of truth for the silent-save decision used by both:
 *   - the host app (app/share.tsx)
 *   - the Edge Function (supabase/functions/process-share-link/index.ts)
 *
 * Pure module: no network, no Places, no Supabase. Inputs in, decision out.
 * Callers run Places verification AFTER this returns and use
 * `ExtractionResult.autoSaveAllowed` plus the candidate ranking helpers
 * to decide silent-save vs candidate picker vs manual fallback.
 *
 * Core product rule:
 *   Wrong silent saves are worse than asking the user to choose.
 *   Auto-save only when evidence is strong AND corroborated.
 *
 * Hierarchy (highest to lowest):
 *   1. Address in caption / description / profile bio.
 *   2. Explicit restaurant / place name in caption + city/state/location.
 *   3. Explicit restaurant / place name alone (must be unique strong match).
 *   4. Verified restaurant profile/account identity (bio has address or city).
 *   5. Tagged restaurant accounts (only if classified, with bio geo).
 *   6. Audio transcript (only if no caption signal).
 *   7. Otherwise: ambiguous.
 *
 * @ handle rule:
 *   Handles are EVIDENCE, not truth. They never become a Places query
 *   on their own. A handle helps only when corroborated by:
 *     - poster bio classifies as restaurant_or_business with a geo anchor, or
 *     - display name + bio agree, or
 *     - caption text near the handle names the venue, or
 *     - a Places candidate strongly name-matches the bio-extracted name.
 *
 * Influencer rule:
 *   If posterType is "influencer", the poster handle/display name is NEVER
 *   used as the venue. We must find the venue in caption / address /
 *   tagged-restaurant evidence; otherwise auto-save is blocked.
 *
 * Address rule:
 *   When an address is present anywhere (caption / description / profile
 *   bio), it is the strongest signal. The caller should geocode it and
 *   verify the candidate is at/near that address. Device location must
 *   not override an explicit address.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExtractionConfidence = 'high' | 'medium' | 'low';

export type PosterType = 'restaurant' | 'influencer' | 'unknown';

export type AutoSaveBlockedReason =
  | 'weak_query'
  | 'handle_only'
  | 'device_location_only'
  | 'poster_is_influencer'
  | 'no_corroboration'
  | 'name_mismatch'
  | 'address_present_but_candidate_far'
  | 'source_context_conflict'
  | 'no_signal';

export type NameSource =
  | 'caption_explicit'
  | 'caption_near_handle'
  | 'transcript'
  | 'verified_profile'
  | 'address_resolved'
  | 'unknown';

export type AddressSource = 'caption' | 'profile_bio' | 'unknown';

export type LocationSource =
  | 'caption_city'
  | 'caption_state'
  | 'pin_emoji'
  | 'profile_bio'
  | 'unknown';

export type ExtractionEvidence = {
  nameSource: NameSource;
  addressSource: AddressSource;
  locationSource: LocationSource;
  /** True when handle text influenced the chosen name. */
  handleUsed: boolean;
  /** Short human reason; empty string when no handle was used. */
  handleReason: string;
};

export type ProfileEnrichment = {
  handle: string;
  classification:
    | 'restaurant_or_business'
    | 'food_creator'
    | 'repost_page'
    | 'personal_account'
    | 'unrelated_or_unknown';
  category?: string;
  displayName?: string;
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  confidence: ExtractionConfidence;
};

/** Structured AI output (new schema). All fields optional for backward-compat. */
export type AIStructuredResult = {
  query?: string;
  placeName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  posterType?: PosterType;
  taggedAccounts?: string[];
  confidence?: ExtractionConfidence;
  reason?: string;
  /** Whether AI thinks user should confirm. Treated as a hint, not a gate. */
  needsUserConfirmation?: boolean;
};

export type ExtractionPipelineInput = {
  source: 'tiktok' | 'instagram' | 'link';
  url: string;
  title: string | null;
  description: string | null;
  /** Pre-cleaned caption query (from shareParser.buildQuery). */
  cleanedQuery: string | null;
  /** Detected poster handle (lowercase, no @). */
  posterHandle?: string | null;
  /** Profile enrichments (handle -> classification + bio evidence). */
  enrichments?: ProfileEnrichment[];
  /** Optional video transcript. */
  transcript?: string | null;
  /** Optional structured AI output. */
  ai?: AIStructuredResult | null;
};

export type ExtractionResult = {
  /** What to feed Google Places. May be empty when no signal. */
  query: string;
  placeName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  /** Free-text location hint for ranking bias. */
  sourceContext: string | null;
  posterHandle: string | null;
  posterDisplayName: string | null;
  posterType: PosterType;
  taggedAccounts: string[];
  confidence: ExtractionConfidence;
  evidence: ExtractionEvidence;
  /**
   * True ONLY when Places verification of the chosen evidence may be
   * silently saved without user confirmation. Caller still must verify
   * the Places candidate strongly matches and is geographically plausible.
   */
  autoSaveAllowed: boolean;
  /** When autoSaveAllowed=false, why. null when allowed. */
  needsConfirmationReason: AutoSaveBlockedReason | null;
};

// ---------------------------------------------------------------------------
// Constants (kept local so this file is self-contained and re-portable)
// ---------------------------------------------------------------------------

const PLACE_KEYWORDS: readonly string[] = [
  'restaurant', 'cafe', 'café', 'coffee', 'bar', 'pub', 'bistro', 'diner',
  'pizza', 'pizzeria', 'taco', 'tacos', 'taqueria', 'sushi', 'ramen',
  'burger', 'burgers', 'bbq', 'barbecue', 'bakery', 'donut', 'doughnut',
  'gelato', 'brewery', 'winery', 'kitchen', 'grill', 'steakhouse', 'noodle',
  'noodles', 'dumpling', 'thai', 'indian', 'mexican', 'chicken', 'sandwich',
  'deli', 'eatery', 'shop', 'market', 'house', 'joint',
];

const CREATOR_KEYWORDS: readonly string[] = [
  'foodie', 'food blogger', 'food critic', 'food writer', 'food influencer',
  'content creator', 'food creator', 'reviews', 'food reviews',
  'restaurant reviews', 'finds', 'food finds', 'guide', 'food guide',
  'eats', 'best eats', 'media', 'magazine', 'newsletter', 'curator',
  'hungry', 'munchies', 'tasting',
];

const LATIN_LETTER_CLASS = 'A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF';
const LATIN_NAME_CHAR_CLASS = `${LATIN_LETTER_CLASS}'\\u2019-`;
const CAPITALIZED_WORD_RE = `[A-Z][${LATIN_NAME_CHAR_CLASS}]+`;
const CAPITALIZED_PHRASE_RE = `${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){0,4}`;
const HASHTAG_RE = /#[^\s#@]+/g;
const PIN_MARKER_RE = /[📍📌]/g;
const NAME_START_RE = new RegExp(`^[A-Z][${LATIN_LETTER_CLASS}'-]+`);

// Address: "<#> <street> <suffix>". Conservative.
const ADDRESS_RE =
  /\b(\d{1,5})\s+([A-Za-z][\w'.\- ]{1,50}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|wharf))\b\.?/i;

// Address with optional city + state + zip after.
const ADDRESS_WITH_CITY_RE =
  /\b\d{1,5}\s+[A-Za-z][\w'.\- ]{1,50}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|wharf)\b[^\n,;]*?(?:,\s*[A-Za-z.'\- ]+)?(?:,?\s*([A-Z]{2}))?(?:\s+\d{5})?/i;

const CITY_STATE_RE =
  new RegExp(`\\b(${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){0,3}),\\s*([A-Z]{2})\\b`);

const PIN_EMOJI_RE = /[📍📌]/;

const HANDLE_RE = /@([A-Za-z0-9._]{2,30})/g;

const GENERIC_WEAK_PREFIX_RE =
  /^(?:my|our|this|that|best|favorite|hidden gem|vibes|going|follow|check out|come with|come to|having fun|guys run|run don'?t walk|need to go|you need to go|you have to try)\b/i;

const GENERIC_WEAK_QUERY_RE =
  /\b(?:vibes only|good time|with the crew|date night|weekend plans|must try|slaps|so good|fire|yum|yummy|delicious|food recs?|best thing i ate)\b/i;

// Common known location aliases for sourceContext normalization.
const LOCATION_ALIASES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bNYC\b/i, value: 'New York, NY' },
  { pattern: /\bNew York\b/i, value: 'New York, NY' },
  { pattern: /\bBrooklyn\b/i, value: 'Brooklyn, NY' },
  { pattern: /\bManhattan\b/i, value: 'Manhattan, NY' },
  { pattern: /\bLos Angeles\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bDTLA\b/i, value: 'Downtown Los Angeles, CA' },
  { pattern: /\bDowntown LA\b/i, value: 'Downtown Los Angeles, CA' },
  { pattern: /\bLA\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bSan Francisco\b/i, value: 'San Francisco, CA' },
  { pattern: /\bSF\b/i, value: 'San Francisco, CA' },
];

/**
 * Strip Instagram profile meta-description boilerplate from caption text.
 * IG profile headers look like:
 *   "1,645 Followers, 302 Following, 187 Posts - DisplayName (@handle) on Instagram: \"bio text\""
 *   "513,100 views, 1,100 comments - DisplayName (@handle) on Instagram: \"bio text\""
 * That text is profile identity, not a user-written caption naming a place.
 * Treating it as caption-explicit evidence causes silent saves of poster
 * identity when the actual post has no real caption text.
 */
function stripInstagramMetaDescription(s: string): string {
  if (!s) return s;
  // Pattern A: "<counts> - <Name> (@handle) on Instagram: "<bio>""
  const re =
    /(?:\d[\d,.]*\s+(?:Followers|Following|Posts|views|comments|likes)[^\n]*?)?-\s*[^\n]*?\(@[A-Za-z0-9._]+\)\s+on\s+Instagram:\s*[\u201C"][^\u201D"\n]*[\u201D"]?/gi;
  return s.replace(re, '').replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runExtractionPipeline(
  input: ExtractionPipelineInput,
): ExtractionResult {
  const rawCaptionBlob = [input.title, input.description].filter(Boolean).join('\n');
  // Strip Instagram meta-description text ("X Followers, Y Posts - Name
  // (@handle) on Instagram: \"bio\""). That text is poster identity copied
  // from the profile page header, NOT a user-written caption. Treating it
  // as caption-explicit evidence causes silent saves of poster identity
  // when the actual post has no real caption.
  const captionBlob = stripInstagramMetaDescription(rawCaptionBlob);
  const transcript = input.transcript?.trim() || null;

  // ---- 1. Collect all signals as candidate evidence -----------------
  const captionAddress = detectAddress(captionBlob);
  const captionCityState = detectCityState(captionBlob);
  const captionPin = detectPinText(captionBlob);
  const captionExplicitName = detectExplicitPlaceName(captionBlob);
  const captionNearHandle = detectNameNearHandle(captionBlob);
  const transcriptName = detectNameFromTranscript(transcript);

  const handles = collectHandles(captionBlob);
  const taggedAccounts = handles.filter(
    (h) => h.toLowerCase() !== input.posterHandle?.toLowerCase(),
  );

  const enrichments = input.enrichments ?? [];
  const posterEnrichment = input.posterHandle
    ? enrichments.find((e) => e.handle.toLowerCase() === input.posterHandle?.toLowerCase())
    : undefined;
  let chosenProfileEnrichment = posterEnrichment;

  const posterDisplayName = posterEnrichment?.displayName ?? null;

  // ---- 2. Classify the poster --------------------------------------
  const posterType = classifyPosterType({
    handle: input.posterHandle ?? null,
    displayName: posterDisplayName,
    enrichment: posterEnrichment,
    captionBlob,
  });

  // ---- 3. AI overrides for structured fields -----------------------
  const ai = input.ai ?? null;

  // ---- 4. Build the chosen evidence by hierarchy -------------------
  // Priority 1: caption address resolves to a business.
  // Priority 2: caption explicit name + city/state.
  // Priority 3: caption explicit name alone (strong unique).
  // Priority 4: verified restaurant profile identity.
  // Priority 5: tagged restaurant account with bio geo.
  // Priority 6: transcript name + caption city.
  // Otherwise: weak / no signal.

  let placeName: string | null = ai?.placeName ?? null;
  let address: string | null = ai?.address ?? null;
  let city: string | null = ai?.city ?? null;
  let state: string | null = ai?.state ?? null;
  let nameSource: NameSource = 'unknown';
  let addressSource: AddressSource = 'unknown';
  let locationSource: LocationSource = 'unknown';
  let handleUsed = false;
  let handleReason = '';
  let confidence: ExtractionConfidence = 'low';
  let chosenQuery = '';
  const aiMatchedVerifiedProfile = ai?.placeName
    ? enrichments.find(
        (entry) =>
          entry.classification === 'restaurant_or_business' &&
          entry.extractedName?.toLowerCase() === ai.placeName?.toLowerCase() &&
          (entry.extractedAddress || entry.extractedCity),
      )
    : undefined;

  if (aiMatchedVerifiedProfile) {
    chosenProfileEnrichment = aiMatchedVerifiedProfile;
    nameSource = 'verified_profile';
    handleUsed = true;
    handleReason =
      aiMatchedVerifiedProfile.handle.toLowerCase() === (input.posterHandle ?? '').toLowerCase()
        ? 'poster_bio_verified'
        : 'tagged_bio_verified';
    address = address ?? aiMatchedVerifiedProfile.extractedAddress ?? null;
    city = city ?? aiMatchedVerifiedProfile.extractedCity ?? null;
    if (locationSource === 'unknown' && aiMatchedVerifiedProfile.extractedCity) {
      locationSource = 'profile_bio';
    }
  }

  // --- Address path (highest) ---
  if (!address && captionAddress) {
    address = captionAddress.full;
    addressSource = 'caption';
  } else if (!address && posterEnrichment?.extractedAddress) {
    address = posterEnrichment.extractedAddress;
    addressSource = 'profile_bio';
  }

  // --- City/state path ---
  if (!city && captionCityState) {
    city = captionCityState.city;
    state = state ?? captionCityState.state;
    locationSource = 'caption_city';
  } else if (!city && captionPin?.locationHint) {
    city = captionPin.locationHint;
    locationSource = 'pin_emoji';
  } else if (!city && posterEnrichment?.extractedCity) {
    city = posterEnrichment.extractedCity;
    locationSource = 'profile_bio';
  }

  // --- Place name path ---
  if (!placeName && captionExplicitName) {
    placeName = captionExplicitName;
    nameSource = 'caption_explicit';
  } else if (!placeName && captionNearHandle) {
    placeName = captionNearHandle.name;
    nameSource = 'caption_near_handle';
    if (captionNearHandle.handle) {
      handleUsed = true;
      handleReason = 'caption_text_near_handle';
    }
  } else if (
    !placeName &&
    posterEnrichment &&
    posterEnrichment.classification === 'restaurant_or_business' &&
    posterEnrichment.extractedName &&
    (posterEnrichment.extractedAddress || posterEnrichment.extractedCity)
  ) {
    placeName = posterEnrichment.extractedName;
    nameSource = 'verified_profile';
    handleUsed = true;
    handleReason = 'poster_bio_verified';
  } else if (!placeName) {
    // Tagged restaurant fallback (must be classified + have bio geo).
    const taggedRestaurant = enrichments.find(
      (e) =>
        e.handle.toLowerCase() !== input.posterHandle?.toLowerCase() &&
        e.classification === 'restaurant_or_business' &&
        e.extractedName &&
        (e.extractedAddress || e.extractedCity),
    );
    if (taggedRestaurant) {
      placeName = taggedRestaurant.extractedName!;
      address = address ?? taggedRestaurant.extractedAddress ?? null;
      city = city ?? taggedRestaurant.extractedCity ?? null;
      if (locationSource === 'unknown' && taggedRestaurant.extractedCity) {
        locationSource = 'profile_bio';
      }
      nameSource = 'verified_profile';
      handleUsed = true;
      handleReason = 'tagged_bio_verified';
      chosenProfileEnrichment = taggedRestaurant;
    }
  }

  // Transcript fallback for name only.
  if (!placeName && transcriptName) {
    placeName = transcriptName;
    nameSource = 'transcript';
  }

  // Pin emoji as last-resort for name (only when it isn't location-only).
  if (!placeName && captionPin?.placeNameHint) {
    placeName = captionPin.placeNameHint;
    nameSource = 'caption_explicit';
  }

  // ---- 5. Confidence assessment -------------------------------------
  if (address && placeName) {
    confidence = 'high';
  } else if (address) {
    confidence = 'high';
  } else if (placeName && (city || state)) {
    confidence = 'medium';
  } else if (placeName) {
    confidence = 'low';
  }
  // Verified profile bio identity: high if address present, medium otherwise.
  if (
    nameSource === 'verified_profile' &&
    (chosenProfileEnrichment?.extractedAddress || chosenProfileEnrichment?.extractedCity)
  ) {
    confidence = chosenProfileEnrichment?.extractedAddress ? 'high' : 'medium';
  }
  // AI confidence overrides downward only (never upgrade past evidence).
  if (ai?.confidence === 'low' && confidence === 'medium') confidence = 'low';

  // ---- 6. Build query string for Places ----------------------------
  chosenQuery = buildQuery({ placeName, address, city, state });
  // Fallback: if we have nothing structured, fall back to the cleaned
  // caption query so Places can still surface candidates for the picker.
  if (!chosenQuery) {
    chosenQuery = (input.cleanedQuery ?? '').trim();
  }

  // ---- 7. Source context for ranking bias --------------------------
  const sourceContext =
    address ?? city ?? captionPin?.locationHint ?? extractAliasContext(captionBlob);

  // ---- 8. Compute autoSaveAllowed + reason -------------------------
  const decision = decideAutoSave({
    placeName,
    address,
    city,
    posterType,
    nameSource,
    handleUsed,
    chosenQuery,
    posterEnrichment: chosenProfileEnrichment,
    captionBlob,
  });

  return {
    query: chosenQuery,
    placeName,
    address,
    city,
    state,
    sourceContext,
    posterHandle: input.posterHandle ?? null,
    posterDisplayName,
    posterType,
    taggedAccounts,
    confidence,
    evidence: {
      nameSource,
      addressSource,
      locationSource,
      handleUsed,
      handleReason,
    },
    autoSaveAllowed: decision.allowed,
    needsConfirmationReason: decision.allowed ? null : decision.reason,
  };
}

// ---------------------------------------------------------------------------
// Decision rules
// ---------------------------------------------------------------------------

function decideAutoSave(params: {
  placeName: string | null;
  address: string | null;
  city: string | null;
  posterType: PosterType;
  nameSource: NameSource;
  handleUsed: boolean;
  chosenQuery: string;
  posterEnrichment: ProfileEnrichment | undefined;
  captionBlob: string;
}): { allowed: true; reason: null } | { allowed: false; reason: AutoSaveBlockedReason } {
  const {
    placeName,
    address,
    city,
    posterType,
    nameSource,
    handleUsed,
    chosenQuery,
    posterEnrichment,
  } = params;

  if (!chosenQuery) return { allowed: false, reason: 'no_signal' };
  if (isGenericContentQuery(chosenQuery) && !address && nameSource !== 'verified_profile') {
    return { allowed: false, reason: 'weak_query' };
  }
  if (isGenericWeakQuery(chosenQuery) && !placeName && !address) {
    return { allowed: false, reason: 'weak_query' };
  }

  // Influencer/creator poster: never auto-save based on poster identity.
  // If the only signal is poster-derived, block.
  if (posterType === 'influencer') {
    if (
      (handleUsed &&
        nameSource !== 'verified_profile' &&
        nameSource !== 'caption_explicit' &&
        nameSource !== 'address_resolved')
    ) {
      return { allowed: false, reason: 'poster_is_influencer' };
    }
  }

  // Handle-only path: never auto-save.
  if (handleUsed && !placeName) {
    return { allowed: false, reason: 'handle_only' };
  }
  if (
    handleUsed &&
    nameSource !== 'verified_profile' &&
    nameSource !== 'caption_explicit' &&
    nameSource !== 'address_resolved' &&
    !address
  ) {
    return { allowed: false, reason: 'handle_only' };
  }

  // Path 1: address present → auto-save allowed (caller verifies candidate near address).
  if (address && placeName) {
    return { allowed: true, reason: null };
  }
  if (address && nameSource === 'caption_explicit') {
    return { allowed: true, reason: null };
  }
  // Address alone (no name) is still the strongest possible signal -- the
  // caller must verify the chosen Places candidate sits at this address,
  // but we never need user confirmation for a literal street address that
  // appeared in the caption or bio.
  if (address) {
    return { allowed: true, reason: null };
  }

  // Path 2: explicit place name + city/state → auto-save allowed.
  if (placeName && nameSource === 'caption_explicit' && city) {
    return { allowed: true, reason: null };
  }

  // Path 3: explicit place name alone → allowed only when the name is
  // distinctive (multi-word, contains a place keyword OR is title-cased
  // proper noun phrase). Caller must still verify a unique strong match.
  if (placeName && nameSource === 'caption_explicit' && isDistinctiveName(placeName)) {
    return { allowed: true, reason: null };
  }

  // Path 4: verified profile (poster bio has address or city) → allowed.
  if (
    nameSource === 'verified_profile' &&
    posterEnrichment &&
    posterEnrichment.classification === 'restaurant_or_business' &&
    (posterEnrichment.extractedAddress || posterEnrichment.extractedCity)
  ) {
    return { allowed: true, reason: null };
  }

  // Path 5: caption-near-handle name + city → allowed (caller verifies).
  if (placeName && nameSource === 'caption_near_handle' && city) {
    return { allowed: true, reason: null };
  }

  // Transcript-only signal → require corroboration.
  if (placeName && nameSource === 'transcript' && !city && !address) {
    return { allowed: false, reason: 'no_corroboration' };
  }

  // Default: block.
  if (!placeName) return { allowed: false, reason: 'weak_query' };
  return { allowed: false, reason: 'no_corroboration' };
}

// ---------------------------------------------------------------------------
// Poster classification
// ---------------------------------------------------------------------------

export function classifyPosterType(params: {
  handle: string | null;
  displayName: string | null;
  enrichment: ProfileEnrichment | undefined;
  captionBlob: string;
}): PosterType {
  const { handle, displayName, enrichment } = params;

  if (enrichment?.classification === 'restaurant_or_business') return 'restaurant';
  if (
    enrichment?.classification === 'food_creator' ||
    enrichment?.classification === 'repost_page'
  ) {
    return 'influencer';
  }

  if (handle && looksLikeCreatorHandle(handle)) return 'influencer';
  if (displayName && looksLikeCreatorPhrase(displayName)) return 'influencer';

  // No enrichment and handle/name look business-like? Stay 'unknown' —
  // we don't trust handle text alone to claim "restaurant".
  return 'unknown';
}

function looksLikeCreatorHandle(handle: string): boolean {
  const h = handle.toLowerCase().replace(/[._]/g, '');
  if (/eats(?:[a-z]{0,4})?$/.test(h)) return true;
  if (/(?:foodie|hungry|munchies|tasting|blogger|critic|reviews?)/.test(h)) return true;
  if (/^(?:la|nyc|sf|chi|miami|seattle|dallas|austin|boston|philly|atl|dc|sd|oc)/.test(h) &&
      /(?:eats|bites|food|grub|spots|picks|finds|guide|scene|digest|insider)$/.test(h)) {
    return true;
  }
  return false;
}

function looksLikeCreatorPhrase(value: string): boolean {
  const lower = value.toLowerCase();
  return CREATOR_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Evidence detectors (pure, regex-based)
// ---------------------------------------------------------------------------

function detectAddress(text: string): { full: string; street: string } | null {
  if (!text) return null;
  const m = text.match(ADDRESS_WITH_CITY_RE);
  if (!m) return null;
  return { full: m[0].replace(/\s+/g, ' ').trim(), street: m[0].trim() };
}

function detectCityState(text: string): { city: string; state: string } | null {
  if (!text) return null;
  const m = text.match(CITY_STATE_RE);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2] };
}

function detectPinText(
  text: string,
): { locationHint: string | null; placeNameHint: string | null } | null {
  if (!text) return null;
  const idx = text.search(PIN_EMOJI_RE);
  if (idx < 0) return null;
  const tail = text.slice(idx + 2, idx + 200).split(/[\n\r]/)[0];
  const cleaned = tail
    .replace(HASHTAG_RE, ' ')
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const stop = cleaned.split(/\b(?:also|and|or|plus)\b|[+|]/i)[0].trim();
  if (!stop) return null;

  // Location-only? (e.g. "Highland Park, Los Angeles, CA")
  if (looksLikeLocationOnly(stop)) {
    return { locationHint: stop, placeNameHint: null };
  }

  // Mixed: "Tatsu Ramen, Sawtelle Japantown" → name + location
  const parts = stop.split(/\s*,\s*/);
  if (parts.length >= 2) {
    const first = parts[0].trim();
    const rest = parts.slice(1).join(', ').trim();
    if (first && containsBusinessKeyword(first)) {
      return { locationHint: rest || null, placeNameHint: first };
    }
    if (first && !looksLikeLocationOnly(first) && rest && looksLikeLocationOnly(rest)) {
      return { locationHint: rest, placeNameHint: first };
    }
  }
  // Single phrase that is name-like.
  if (containsBusinessKeyword(stop) || NAME_START_RE.test(stop)) {
    return { locationHint: null, placeNameHint: stop };
  }
  return { locationHint: stop, placeNameHint: null };
}

/**
 * Find an explicit place name in the caption: capitalized phrase that
 * either contains a business keyword (e.g. "Joe's Pizza") or is followed
 * by " in <City>" / " at <City>".
 */
function detectExplicitPlaceName(text: string): string | null {
  if (!text) return null;
  const stripped = stripCreatorBoilerplate(text);

  // Pattern 1: "<Capitalized words> in <City>"
  const inCity = stripped.match(
    new RegExp(`\\b(${CAPITALIZED_PHRASE_RE})\\s+in\\s+[A-Z][${LATIN_NAME_CHAR_CLASS}]+`),
  );
  if (inCity?.[1] && !isLocationName(inCity[1])) return inCity[1].trim();

  // Pattern 2: "<Capitalized words> + comma + city/state"
  const beforeComma = stripped.match(
    new RegExp(`\\b(${CAPITALIZED_PHRASE_RE})\\s*,\\s*([A-Z][${LATIN_NAME_CHAR_CLASS}]+|[A-Z]{2})\\b`),
  );
  if (beforeComma?.[1] && !isLocationName(beforeComma[1])) {
    return beforeComma[1].trim();
  }

  // Pattern 3: "went to <Name>" / "at <Name>" / "<Name> was"
  const verbName = stripped.match(
    new RegExp(`\\b(?:went to|at|tried|visited)\\s+(${CAPITALIZED_PHRASE_RE})`),
  );
  if (verbName?.[1] && !isLocationName(verbName[1])) return verbName[1].trim();

  // Pattern 4: phrase contains a place keyword.
  const lower = stripped.toLowerCase();
  for (const kw of PLACE_KEYWORDS) {
    if (!lower.includes(kw)) continue;
    // Window around keyword: capture up to 3 capitalized words before it.
    const re = new RegExp(
      `\\b((?:[A-Z][${LATIN_NAME_CHAR_CLASS}]+\\s+){0,3}[A-Z]?[${LATIN_NAME_CHAR_CLASS}]*${escapeRegExp(kw)}[A-Z]?[${LATIN_NAME_CHAR_CLASS}]*)`,
      'i',
    );
    const m = stripped.match(re);
    if (m?.[1]) {
      const candidate = m[1].trim();
      if (
        !isLocationName(candidate) &&
        !/^(?:i|we|my|our|the|this|that|today|here)\b/i.test(candidate) &&
        candidate.split(/\s+/).length >= 2 &&
        // Require an actual capitalized first letter -- the regex uses /iu
        // for keyword-case-insensitivity, which inadvertently also makes
        // the [A-Z] anchors case-insensitive. Reject obvious lowercase
        // verb phrases like "grilled cheeses with smashburgers".
        /^[A-Z]/.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Find explicit text near an @handle: "@handle Name" or "Name @handle".
 * Returns the capitalized phrase with the handle so the caller knows
 * a handle was involved.
 */
function detectNameNearHandle(
  text: string,
): { name: string; handle: string } | null {
  if (!text) return null;
  // "@handle Name Was"
  const after = text.match(
    new RegExp(`@([A-Za-z0-9._]{2,30})\\s+(${CAPITALIZED_PHRASE_RE})`),
  );
  if (after) {
    const handle = after[1];
    const name = after[2].trim();
    if (
      !isLocationName(name) &&
      !looksLikeCreatorHandle(handle) &&
      name.split(/\s+/).length >= 2
    ) {
      return { name, handle };
    }
  }
  // "<Name> @handle"
  const before = text.match(
    new RegExp(`\\b(${CAPITALIZED_WORD_RE}(?:\\s+${CAPITALIZED_WORD_RE}){1,4})\\s+@([A-Za-z0-9._]{2,30})`),
  );
  if (before) {
    const handle = before[2];
    const name = before[1].trim();
    if (!isLocationName(name) && !looksLikeCreatorHandle(handle)) {
      return { name, handle };
    }
  }
  return null;
}

function detectNameFromTranscript(transcript: string | null): string | null {
  if (!transcript) return null;
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const patterns: RegExp[] = [
    /\bthis place is called\s+([^.,!?\n]{2,80})/i,
    /\btoday we(?:'re| are)\s+(?:trying|at|visiting)\s+([^.,!?\n]{2,80})/i,
    /\bwelcome to\s+([^.,!?\n]{2,80})/i,
    /\bwe(?:'re| are)\s+at\s+([^.,!?\n]{2,80})/i,
    /\bwe went to\s+([^.,!?\n]{2,80})/i,
    /\bI(?:'m| am)\s+at\s+([^.,!?\n]{2,80})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const name = m[1].replace(/^the\s+/i, '').replace(/["'`\u201C\u201D]/g, '').trim();
      if (name.length >= 2) return name;
    }
  }
  return null;
}

function collectHandles(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  HANDLE_RE.lastIndex = 0;
  while ((m = HANDLE_RE.exec(text)) !== null) {
    const h = m[1].toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(m[1]);
  }
  return out;
}

function stripCreatorBoilerplate(s: string): string {
  if (!s) return '';
  const colon = s.match(
    /\bon\s+(?:instagram|tiktok|youtube|facebook)\b\s*[:\u2014-]\s*(.+)$/i,
  );
  if (colon?.[1]) return colon[1].trim();
  return s
    .replace(/\(@[A-Za-z0-9._]{2,30}\)\s+on\s+(?:instagram|tiktok|youtube|facebook)\b/i, ' ')
    .replace(/\s+on\s+(?:instagram|tiktok|youtube|facebook)\b/i, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQuery(parts: {
  placeName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}): string {
  const tokens: string[] = [];
  if (parts.placeName) tokens.push(parts.placeName);
  if (parts.address) tokens.push(parts.address);
  else if (parts.city) tokens.push(parts.city);
  if (parts.state && !tokens.some((t) => new RegExp(`\\b${parts.state}\\b`).test(t))) {
    tokens.push(parts.state);
  }
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function extractAliasContext(text: string): string | null {
  if (!text) return null;
  for (const alias of LOCATION_ALIASES) {
    if (alias.pattern.test(text)) return alias.value;
  }
  return null;
}

function isGenericWeakQuery(query: string): boolean {
  if (!query) return true;
  if (GENERIC_WEAK_PREFIX_RE.test(query)) return true;
  if (GENERIC_WEAK_QUERY_RE.test(query)) return true;
  return false;
}

function isDistinctiveName(name: string): boolean {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  if (looksLikeLocationOnly(name)) return false;
  return true;
}

function containsBusinessKeyword(s: string): boolean {
  const lower = s.toLowerCase();
  return PLACE_KEYWORDS.some((kw) => lower.includes(kw));
}

const LOCATION_ONLY_HINTS = new Set<string>([
  'la', 'los angeles', 'nyc', 'new york', 'sf', 'san francisco', 'dtla',
  'brooklyn', 'queens', 'manhattan', 'bronx', 'highland park', 'silver lake',
  'echo park', 'koreatown', 'ktown', 'sawtelle', 'sawtelle japantown',
  'venice', 'santa monica', 'culver city', 'pasadena', 'long beach',
  'arcadia', 'studio city', 'west hollywood', 'weho', 'beverly hills',
  'downtown', 'midtown', 'soho', 'tribeca', 'williamsburg', 'bushwick',
  'astoria', 'flushing', 'chinatown', 'little tokyo', 'french quarter',
  'nola', 'new orleans', 'malibu',
]);

const US_STATE_RE =
  /\b(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;

export function looksLikeLocationOnly(s: string): boolean {
  if (!s) return false;
  const cleaned = s.toLowerCase().replace(PIN_MARKER_RE, '').replace(/[.,]+$/g, '').trim();
  if (!cleaned) return false;
  const parts = cleaned.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const allLocationy = parts.every(
      (p) =>
        LOCATION_ONLY_HINTS.has(p) ||
        US_STATE_RE.test(p) ||
        (/^[a-z][a-z .'-]{1,30}$/.test(p) && !containsBusinessKeyword(p)),
    );
    if (allLocationy) return true;
  }
  if (LOCATION_ONLY_HINTS.has(cleaned)) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if the text is likely just a location name (city/neighborhood/state). */
function isLocationName(s: string): boolean {
  if (!s) return false;
  if (looksLikeLocationOnly(s)) return true;
  const lower = s.toLowerCase();
  return LOCATION_ONLY_HINTS.has(lower);
}

/**
 * Address-aware token normalization for matching against Places candidates.
 * Caller-side helper (exported for the host app + Edge Function).
 *
 * Examples:
 *   normalizeForMatch("Mary's Diner")  → "marys diner"
 *   normalizeForMatch("Marys Diner")   → "marys diner"
 *   normalizeForMatch("Café Du Monde") → "cafe du monde"
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
