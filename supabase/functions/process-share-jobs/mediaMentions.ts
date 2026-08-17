// supabase/functions/process-share-jobs/mediaMentions.ts
//
// PURE (Node + Deno) — turns the media worker's structured place evidence into
// a bounded, deterministic list of ELIGIBLE explicit venue-name MENTIONS that
// the name-driven resolver can independently verify against Google Places.
//
// This is the eligibility + normalization + grouping + geographic-context layer
// for Phase 2 multi-place. It NEVER contacts Google Places, never scores, never
// decides. It only decides which model-proposed names are explicit enough to be
// worth an individual Places search, and prepares them for one.
//
// SAFETY RULES enforced here:
//   • A mention is created ONLY from EXPLICIT evidence (spoken / visible_text /
//     caption / frame). Inferred-only places are dropped (context only).
//   • Generic cuisine terms, vague deictic phrases ("this pizza place"),
//     opinions, and platform CTA text ("subscribe", "follow") never become a
//     mention — they carry no distinctive token.
//   • Geographic context is built ONLY from explicit city/region/country fields
//     on the evidence. Nothing is inferred (never the user's location).
//   • A place that only restates its OWN city/region/country is context, not a
//     destination: it never becomes a searchable mention, so a city can never be
//     laundered into an unrelated business carrying that city's name. It still
//     contributes to `geoContext` for its siblings.
//   • Distinct chain locations are kept separate (grouping never merges two
//     mentions whose region differs).
//
// No I/O, no Deno globals — unit-tested from Node (scripts/testMediaMentions.ts).

import {
  classifyGeographicSourcePlace,
  isGeographicContextOnlySource,
  type MediaPlaceEvidence,
  type PlaceCandidateEvidence,
  type PlaceEvidenceSource,
} from './mediaEvidence.ts';

/** Bounds so a malformed / oversized payload can never fan out unbounded work. */
export const MAX_MENTIONS = 10;

/**
 * How well the post establishes ONE shared country for its destinations.
 *
 *   strong     — corroborated; may scope an ambiguous sibling's search
 *   weak       — a single uncorroborated model field; context only, never applied
 *   conflicted — the post spans several countries; nothing may be applied
 *   none       — no country evidence at all
 */
export type SharedGeoContextStrength = 'strong' | 'weak' | 'conflicted' | 'none';

/** What corroborated a strong shared country (diagnostics; closed vocabulary). */
export type SharedGeoContextSource =
  | 'multiple_places_agree'
  | 'explicit_evidence_text'
  | 'context_only_place';

/**
 * What corroborated a strong shared CITY. Narrower than the country vocabulary
 * on purpose — see `establishSharedCity` for why a city may not be established
 * the same loose ways a country may.
 */
export type SharedCityContextSource = 'multiple_places_agree' | 'redundant_container';

/** Bounded geographic context derived from explicit evidence only. */
export type MediaGeoContext = {
  city: string | null;
  region: string | null;
  country: string | null;
  /** Set only on the POST-LEVEL aggregate, never on a single mention's own geo.
   *  Absent means "not assessed" and is treated as unusable by consumers. */
  countryStrength?: SharedGeoContextStrength;
  /** Present only when `countryStrength === 'strong'`. */
  countrySource?: SharedGeoContextSource;
  /** Distinct countries the post asserted (folded). Diagnostics + conflicts. */
  countryCandidates?: string[];
  /** How firmly the post established ONE shared city. `city` above is populated
   *  ONLY when this is `strong`; anything weaker leaves it null so it can never
   *  be inherited by a sibling. Set on the post-level aggregate only. */
  cityStrength?: SharedGeoContextStrength;
  /** Present only when `cityStrength === 'strong'`. */
  citySource?: SharedCityContextSource;
  /** Same contract as `cityStrength`, for the region field. */
  regionStrength?: SharedGeoContextStrength;
};

/** How a venue relates to its host location (evidence-derived). */
export type VenueRelationshipType = 'located_at' | 'inside' | 'hosted_by' | 'popup_at';

export type SupportingEvidenceItem = {
  source: PlaceEvidenceSource;
  value: string;
  timestampSeconds: number | null;
};

/** A single eligible, normalized venue-name mention ready for a Places search. */
export type VenueMention = {
  /** Stable per-task id: m1, m2, … (assigned in group order). */
  id: string;
  /** Original display name (trimmed) — what the user sees. For a venue-in-host
   *  relationship this is the combined "Primary at Host" label. */
  displayName: string;
  /** Normalized name for matching/grouping (preserves & ' . in initials). */
  normalizedName: string;
  /** Tokens that make the name distinctive (generic cuisine/stop words removed). */
  distinctiveTokens: string[];
  /** Model category hint (e.g. "Pizza Restaurant") — ranking hint ONLY. */
  category: string | null;
  categoryConfidence?: number;
  categoryEvidenceTags?: string[];
  /** Evidence sources that referenced this name (deduped). */
  sources: PlaceEvidenceSource[];
  /** Sources whose explicit evidence text supports the venue's distinctive
   *  name tokens. Address/category-only evidence is deliberately excluded. */
  nameEvidenceSources: PlaceEvidenceSource[];
  /** Distinct evidence timestamps (seconds), ascending. */
  timestamps: number[];
  /** How many explicit evidence items referenced this name (repetition signal). */
  mentionCount: number;
  /** True when the same name appears from ≥2 different sources OR ≥2 timestamps. */
  repeated: boolean;
  /** Model confidence (0..1) — NEVER used as the verification score. */
  confidence: number;
  /** Per-mention geographic context from THIS place's explicit fields. */
  geo: MediaGeoContext;
  /** The saveable business name (set only for a venue-in-host relationship). */
  primaryVenueName?: string;
  /** The host location a `primaryVenueName` operates inside/at (context only). */
  hostVenueName?: string;
  /** Relationship kind when a host was folded in. */
  relationshipType?: VenueRelationshipType;
  /** Host evidence retained as context (not a separate searchable venue). */
  supportingEvidence?: SupportingEvidenceItem[];
  /**
   * How this mention must be resolved.
   *
   *   undefined / 'venue' — ordinary business/venue matching (the default).
   *   'geographic'        — the post offers this PLACE ITSELF as a destination
   *                         (a peer city). It may only ever match a geographic
   *                         provider entity; a business whose name merely
   *                         contains the place name can never satisfy it.
   */
  resolutionMode?: 'venue' | 'geographic';
};

/** Sanitized diagnostic for a detected venue↔host relationship. */
export type VenueRelationshipDiagnostic = {
  primaryVenueName: string;
  hostVenueName: string;
  relationshipType: VenueRelationshipType;
  /** The original evidence phrase that established the relationship. */
  phrase: string;
  /** Distinct evidence timestamps grouped into the merged mention. */
  timestamps: number[];
  /** Whether the host was ALSO featured independently (→ kept separate). */
  hostIndependentlyFeatured: boolean;
  groupingReason: string;
};

export type BuildMentionsResult = {
  mentions: VenueMention[];
  /** Aggregate geo context (most common explicit city/region/country). */
  geoContext: MediaGeoContext;
  /** Detected venue↔host relationships (merged or kept-separate). */
  relationships: VenueRelationshipDiagnostic[];
  /** Diagnostics — counts of what was dropped and why (no raw text). */
  droppedInferredOnly: number;
  droppedIneligibleName: number;
  droppedPassingMention: number;
  /** Redundant CONTAINER places — the post's destinations sit inside them. Not
   *  searchable mentions, but they DO still feed `geoContext`. */
  droppedGeographicContext: number;
  /** Geographic places the post offers as destinations in their own right.
   *  These DO become mentions, resolved through the geographic path. */
  peerGeographicDestinations: number;
};

// ---------------------------------------------------------------------------
// Name normalization + eligibility
// ---------------------------------------------------------------------------

// Generic tokens that carry NO distinctive venue signal on their own. A name
// made only of these ("pizza", "the pizza place") is not searchable as a venue.
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  // structural stop words
  'the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'to', 'for', 'this', 'that',
  'place', 'spot', 'restaurant', 'cafe', 'coffee', 'shop', 'store', 'bar',
  'grill', 'kitchen', 'eatery', 'joint', 'stand', 'truck', 'house', 'co',
  // cuisines / dish categories (a bare cuisine is never a venue)
  'pizza', 'pizzeria', 'pizzas', 'taco', 'tacos', 'taqueria', 'sushi', 'ramen',
  'burger', 'burgers', 'bbq', 'barbecue', 'sandwich', 'sandwiches', 'deli',
  'bakery', 'donut', 'donuts', 'doughnut', 'doughnuts', 'icecream', 'gelato',
  'noodle', 'noodles', 'pho', 'thai', 'chinese', 'italian', 'mexican', 'indian',
  'korean', 'japanese', 'vietnamese', 'greek', 'mediterranean', 'seafood',
  'steakhouse', 'steak', 'chicken', 'wings', 'brunch', 'breakfast', 'lunch',
  'dinner', 'dessert', 'desserts', 'bakeshop', 'creamery', 'bistro', 'diner', 'cucina',
  'food', 'foods', 'eats', 'cuisine', 'best', 'good', 'great', 'top',
  // Generic non-food place categories. A real name such as "Griffith Park"
  // retains its distinctive token; a bare "the hiking trail" does not.
  'park', 'trail', 'hiking', 'beach', 'hotel', 'resort', 'museum', 'landmark',
  'attraction', 'gym', 'fitness', 'spa', 'wellness', 'airport', 'station',
]);

// Vague deictic phrases and platform CTA text that must never become a mention.
const VAGUE_OR_CTA_RE =
  /\b(this|that|the)\s+(place|spot|pizza|restaurant|cafe|joint|one)\b|\b(subscribe|follow|share|save|like|comment|link\s*in\s*bio|swipe|tap|watch|part\s*\d+|episode)\b/i;

const PLATFORM_NOISE_RE = /\b(tik\s*tok|bytedance|instagram|reels?|youtube)\b/i;

/**
 * Normalize a venue name for matching/grouping. Preserves meaningful `&`,
 * apostrophes, and periods (initials) — only collapses whitespace and lowers
 * case. This is deliberately NON-destructive (does not strip `'`, `&`, `.`), so
 * "B&C Pizzas", "Lunita's Pizza", and "J. Gilbert's" stay distinct/searchable.
 */
export function normalizeVenueName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (keep base letters)
    .replace(/[^a-z0-9&'.\- ]+/g, ' ') // keep & ' . - as meaningful
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distinctive tokens = normalized tokens that are not generic/stop words. */
export function distinctiveTokensOf(raw: string): string[] {
  const norm = normalizeVenueName(raw);
  const out: string[] = [];
  for (const tokRaw of norm.split(/[\s\-]+/)) {
    // Keep apostrophes/ampersands attached; compare a stripped form to GENERIC.
    const bare = tokRaw.replace(/[^a-z0-9]/g, '');
    if (!bare) continue;
    // Single letters are kept (brands like "X Eats", "Q Sushi") — GENERIC
    // already contains the single-letter stop words ("a") that must be dropped.
    if (GENERIC_TOKENS.has(bare)) continue;
    out.push(tokRaw);
  }
  return out;
}

/**
 * A model-proposed name is eligible for an INDEPENDENT Places search only when
 * it is a real, distinctive venue name — not a bare cuisine, a vague phrase, an
 * opinion, or platform CTA text. The core test: after removing generic cuisine
 * and stop words, at least one distinctive token remains.
 */
export function isEligibleVenueName(raw: string): boolean {
  const name = (raw ?? '').trim();
  if (name.length < 2) return false;
  if (VAGUE_OR_CTA_RE.test(name)) return false;
  if (PLATFORM_NOISE_RE.test(name)) return false;
  // Must retain at least one distinctive (non-generic) token.
  if (distinctiveTokensOf(name).length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Geo context (explicit-only)
// ---------------------------------------------------------------------------

function placeGeo(p: PlaceCandidateEvidence): MediaGeoContext {
  return {
    city: p.city ?? null,
    region: p.region ?? null,
    country: p.country ?? null,
  };
}

/** Fold a country label for comparison ("México" ~ "Mexico", "USA" ~ "usa").
 *  Comparison only — the ORIGINAL Unicode string is what we carry forward. */
function foldCountry(value: string): string {
  // Reuses the module normalizer so accent handling has ONE definition here.
  return normalizeVenueName(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Decide whether the post establishes ONE shared country firmly enough to scope
 * an ambiguous sibling's search.
 *
 * The failure this addresses (production job 10ce36b5, an Instagram Nicaragua
 * travel reel): the model DID emit `country: "Nicaragua"`, and `aggregateGeo`
 * DID carry it — but neither the query builder nor the coordinate-bias geocode
 * ever read it. The single reused bias geocoded a bare "Granada" and landed in
 * SPAIN, which then pulled every sibling toward Spanish results.
 *
 * Deliberately conservative, because a wrong country is worse than no country:
 *
 *   - two or more places independently naming the same country       -> strong
 *   - the country stated verbatim in a place's own explicit evidence
 *     (caption / spoken / visible text)                              -> strong
 *   - a CONTEXT-ONLY place naming it (the post said "Nicaragua" as a
 *     place in its own right)                                        -> strong
 *   - exactly one place quietly carrying a country field             -> weak
 *   - two or more distinct countries anywhere                        -> conflicted
 *
 * `weak` and `conflicted` are never applied to sibling searches: a road-trip
 * post spanning Spain and Portugal must not have either country forced onto the
 * other's places, and one model field inferred from scenery must not either.
 */
export function establishSharedCountry(
  places: PlaceCandidateEvidence[],
  contextOnlyPlaces: PlaceCandidateEvidence[] = [],
): Pick<MediaGeoContext, 'country' | 'countryStrength' | 'countrySource' | 'countryCandidates'> {
  const all = [...places, ...contextOnlyPlaces];
  const byFolded = new Map<string, { display: string; asserts: number }>();
  for (const p of all) {
    const raw = (p.country ?? '').trim();
    if (!raw) continue;
    const folded = foldCountry(raw);
    if (!folded) continue;
    const seen = byFolded.get(folded);
    if (seen) seen.asserts += 1;
    else byFolded.set(folded, { display: raw, asserts: 1 });
  }

  const candidates = [...byFolded.keys()].sort();
  if (candidates.length === 0) {
    return { country: null, countryStrength: 'none', countryCandidates: [] };
  }
  if (candidates.length > 1) {
    // A multi-country post. Nothing shared can be safely applied.
    return { country: null, countryStrength: 'conflicted', countryCandidates: candidates };
  }

  const only = candidates[0]!;
  const entry = byFolded.get(only)!;

  let source: SharedGeoContextSource | null = null;
  if (entry.asserts >= 2) source = 'multiple_places_agree';
  else if (contextOnlyPlaces.some((p) => foldCountry((p.country ?? '').trim()) === only)) {
    source = 'context_only_place';
  } else if (
    all.some((p) =>
      p.explicitEvidence.some((item) => foldCountry(item.value).includes(only)),
    )
  ) {
    source = 'explicit_evidence_text';
  }

  return source
    ? { country: entry.display, countryStrength: 'strong', countrySource: source, countryCandidates: candidates }
    : { country: entry.display, countryStrength: 'weak', countryCandidates: candidates };
}

/**
 * The post's shared-country verdict for a whole evidence payload.
 *
 * The SINGLE entry point, used both by `buildVenueMentions` (which acts on it)
 * and by the run diagnostics (which record it), so the number written to
 * `share_media_runs` can never disagree with the one the resolver used.
 *
 * Mirrors the same admissibility filters mentions use — a place must carry
 * explicit evidence and must not be a passing mention — then splits context-only
 * places out so their assertions can corroborate rather than merely count.
 */
export function sharedCountryForEvidence(
  evidence: MediaPlaceEvidence,
): Pick<MediaGeoContext, 'country' | 'countryStrength' | 'countrySource' | 'countryCandidates'> {
  const usable = (evidence?.places ?? []).filter(
    (p) => p.explicitEvidence.length > 0 && p.role !== 'passing_mention',
  );
  const contextOnly = usable.filter(isGeographicContextOnlySource);
  const destinations = usable.filter((p) => !isGeographicContextOnlySource(p));
  return establishSharedCountry(destinations, contextOnly);
}

/** Tally one geographic field across places, folded for comparison. */
function tallyGeoField(
  places: PlaceCandidateEvidence[],
  key: 'city' | 'region',
): Map<string, { display: string; asserts: number }> {
  const byFolded = new Map<string, { display: string; asserts: number }>();
  for (const place of places) {
    const raw = (place[key] ?? '').trim();
    if (!raw) continue;
    const folded = foldCountry(raw);
    if (!folded) continue;
    const seen = byFolded.get(folded);
    if (seen) seen.asserts += 1;
    else byFolded.set(folded, { display: raw, asserts: 1 });
  }
  return byFolded;
}

/**
 * Decide whether the post establishes ONE shared CITY firmly enough for a
 * sibling with no city of its own to be searched inside it.
 *
 * This is the fix for a proven production bug. `Ometepe Island` carries no city,
 * so it fell back to the post's aggregate city — which was simply the most
 * common value across siblings, and in a four-stop Nicaragua itinerary that was
 * `Granada`, a PEER destination 63 km away. Ometepe was then searched as
 * "Ometepe Island Granada Nicaragua" and biased to Granada's coordinates,
 * costing it the -60 distance penalty that put it under the floor. Nothing was
 * wrong with the scoring; the geography handed to it was false.
 *
 * A country may be established loosely because it is a broad claim that is
 * usually right. A city is a narrow claim: getting it wrong does not merely
 * fail to help, it actively suppresses the correct result. So the bar is:
 *
 *   two or more places independently name the same city   -> strong
 *   a REDUNDANT CONTAINER names it (the post's other
 *   destinations sit inside it, e.g. Rio, Paris)          -> strong
 *   exactly one place quietly carries a city              -> weak
 *   two or more distinct cities anywhere                  -> conflicted
 *
 * Only `strong` populates `city`; everything else leaves it null rather than
 * letting one sibling's locality masquerade as the post's.
 *
 * PEER GEOGRAPHIC DESTINATIONS ARE EXCLUDED FROM THE VOTE ENTIRELY. Granada,
 * León and San Juan del Sur each report their own name as their city — that is
 * their identity, not a claim to contain anything. A city can contain a
 * restaurant; it cannot contain another peer city. This is the same
 * container-vs-peer distinction the geographic-destination work already draws,
 * applied to the question of what may be inherited.
 *
 * Deliberately NOT included: a city appearing in free-text explicit evidence.
 * The country rule allows that, but for a city it would promote exactly the
 * single-peer case this exists to prevent — one restaurant in Los Angeles whose
 * caption says "Los Angeles" would start scoping every sibling.
 */
export function establishSharedCity(
  places: PlaceCandidateEvidence[],
  allPlaces: PlaceCandidateEvidence[],
): Pick<MediaGeoContext, 'city' | 'cityStrength' | 'citySource'> {
  const byFolded = new Map<string, { display: string; asserts: number; fromContainer: boolean }>();
  for (const place of places) {
    const role = classifyGeographicSourcePlace(place, allPlaces);
    if (role === 'peer_geographic_destination') continue;
    const raw = (place.city ?? '').trim();
    if (!raw) continue;
    const folded = foldCountry(raw);
    if (!folded) continue;
    const isContainer = role === 'redundant_container';
    const seen = byFolded.get(folded);
    if (seen) {
      seen.asserts += 1;
      seen.fromContainer = seen.fromContainer || isContainer;
    } else {
      byFolded.set(folded, { display: raw, asserts: 1, fromContainer: isContainer });
    }
  }

  const candidates = [...byFolded.keys()].sort();
  if (candidates.length === 0) return { city: null, cityStrength: 'none' };
  if (candidates.length > 1) return { city: null, cityStrength: 'conflicted' };

  const entry = byFolded.get(candidates[0]!)!;
  if (entry.asserts >= 2 || entry.fromContainer) {
    return {
      city: entry.display,
      cityStrength: 'strong',
      citySource: entry.fromContainer ? 'redundant_container' : 'multiple_places_agree',
    };
  }
  // One quiet city field describes ITS OWN place, not the post.
  return { city: null, cityStrength: 'weak' };
}

/**
 * The same judgement for REGION, with one deliberate difference: peer
 * destinations are NOT excluded.
 *
 * A region genuinely does contain several peer cities — Santa Fe and Taos both
 * sitting in New Mexico is exactly what a shared region means, and dropping it
 * would cost the state-match signal for no safety gain. A city containing
 * another peer city is not a thing, which is why the city rule is stricter.
 *
 * Agreement is still required: two peers in different states leave the post
 * with no shared region rather than borrowing whichever came first.
 */
export function establishSharedRegion(
  places: PlaceCandidateEvidence[],
): Pick<MediaGeoContext, 'region' | 'regionStrength'> {
  const byFolded = tallyGeoField(places, 'region');
  const candidates = [...byFolded.keys()].sort();
  if (candidates.length === 0) return { region: null, regionStrength: 'none' };
  if (candidates.length > 1) return { region: null, regionStrength: 'conflicted' };
  const entry = byFolded.get(candidates[0]!)!;
  return entry.asserts >= 2
    ? { region: entry.display, regionStrength: 'strong' }
    : { region: null, regionStrength: 'weak' };
}

// ---------------------------------------------------------------------------
// Venue↔host relationship detection ("X Eats @ / at / inside Brewery X")
// ---------------------------------------------------------------------------

// Connectors that establish "primary <connector> host". Longest first so
// "located at" wins over "at". `@` is normalized to "at" beforehand. `by`/`and`
// are deliberately excluded (too generic to imply operating-inside).
const RELATIONSHIP_CONNECTORS: ReadonlyArray<[string, VenueRelationshipType]> = [
  ['located at', 'located_at'],
  ['located inside', 'inside'],
  ['located in', 'inside'],
  ['pop up at', 'popup_at'],
  ['popup at', 'popup_at'],
  ['hosted by', 'hosted_by'],
  ['hosted at', 'hosted_by'],
  ['inside of', 'inside'],
  ['inside', 'inside'],
  ['at', 'located_at'],
  ['in', 'inside'],
];

/** Phrase normalization for relationship detection: keeps venue-name characters
 *  but converts "@" to " at " so "A @ B" reads like "A at B". */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/@/g, ' at ')
    .replace(/\+/g, '&')
    .replace(/[^a-z0-9&'.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect an explicit "<primary> <connector> <host>" phrase where BOTH sides are
 *  the given extracted venue names. Returns the relationship type + the matching
 *  phrase, or null. Requiring both extracted names on either side of a connector
 *  is what keeps this from merging merely co-located / same-city venues. */
export function detectRelationshipPhrase(
  primaryNorm: string,
  hostNorm: string,
  phrases: string[],
): { type: VenueRelationshipType; phrase: string } | null {
  if (!primaryNorm || !hostNorm || primaryNorm === hostNorm) return null;
  const a = escapeRe(primaryNorm);
  const b = escapeRe(hostNorm);
  for (const [conn, type] of RELATIONSHIP_CONNECTORS) {
    const connRe = conn.replace(/ /g, '\\s+');
    // primary, ≤2 filler words, connector, ≤2 filler words, host — all in ONE phrase.
    const re = new RegExp(`\\b${a}\\b(?:\\s+\\S+){0,2}?\\s+${connRe}\\s+(?:\\S+\\s+){0,2}?${b}\\b`);
    for (const phrase of phrases) {
      if (re.test(phrase)) return { type, phrase };
    }
  }
  return null;
}

/** A host is "independently featured" (→ NOT merged) when it carries an explicit
 *  evidence phrase that is NOT merely a fragment of the relationship phrase —
 *  i.e. the video recommends the host as its own place to save. */
function hostIndependentlyFeatured(
  hostValues: string[],
  relationshipPhrase: string,
): boolean {
  return hostValues.some((v) => {
    const n = normalizePhrase(v);
    return n.length > 0 && !relationshipPhrase.includes(n);
  });
}

function relationshipPhrases(places: PlaceCandidateEvidence[]): string[] {
  const phrases: string[] = [];
  const fragmentsBySource = new Map<PlaceEvidenceSource, Array<{
    phrase: string;
    timestampSeconds: number;
    order: number;
  }>>();
  let order = 0;
  for (const place of places) {
    for (const item of place.explicitEvidence) {
      const phrase = normalizePhrase(item.value);
      if (!phrase) continue;
      phrases.push(phrase);
      if (typeof item.timestampSeconds !== 'number' || !Number.isFinite(item.timestampSeconds)) {
        continue;
      }
      const fragments = fragmentsBySource.get(item.source) ?? [];
      fragments.push({ phrase, timestampSeconds: item.timestampSeconds, order: order++ });
      fragmentsBySource.set(item.source, fragments);
    }
  }
  for (const fragments of fragmentsBySource.values()) {
    fragments.sort((a, b) => a.timestampSeconds - b.timestampSeconds || a.order - b.order);
    for (let index = 0; index < fragments.length - 1; index += 1) {
      const current = fragments[index]!;
      const next = fragments[index + 1]!;
      if (next.timestampSeconds - current.timestampSeconds <= 1) {
        phrases.push(`${current.phrase} ${next.phrase}`);
      }
    }
  }
  return phrases;
}



/**
 * Group the eligible places into mentions, merging repeated references to the
 * SAME venue (same normalized name AND same region — different regions stay
 * separate so distinct chain locations are never merged) while combining spoken
 * + visual evidence, sources, and timestamps.
 */
export function buildVenueMentions(evidence: MediaPlaceEvidence): BuildMentionsResult {
  const empty: BuildMentionsResult = {
    mentions: [],
    geoContext: { city: null, region: null, country: null },
    relationships: [],
    droppedInferredOnly: 0,
    droppedIneligibleName: 0,
    droppedPassingMention: 0,
    droppedGeographicContext: 0,
    peerGeographicDestinations: 0,
  };
  if (!evidence || evidence.insufficientEvidence) return empty;

  let droppedInferredOnly = 0;
  let droppedIneligibleName = 0;
  let droppedPassingMention = 0;

  const eligible: PlaceCandidateEvidence[] = [];
  // Places that name only their own city/region/country. They never become a
  // searchable mention (a locality must not be laundered into a business that
  // merely carries its name), but they remain CONTEXTUAL evidence and still
  // scope the geo aggregate for their siblings.
  const geographicContext: PlaceCandidateEvidence[] = [];
  // Peer geographic destinations: mentions, but resolved geographically.
  const peerGeographic = new Set<PlaceCandidateEvidence>();
  for (const p of evidence.places) {
    if (p.explicitEvidence.length === 0) {
      droppedInferredOnly += 1;
      continue;
    }
    if (p.role === 'passing_mention') {
      droppedPassingMention += 1;
      continue;
    }
    const geoRole = classifyGeographicSourcePlace(p, evidence.places);
    if (geoRole === 'redundant_container') {
      // The post's real destinations sit inside this place. Context only.
      geographicContext.push(p);
      continue;
    }
    if (geoRole === 'peer_geographic_destination') {
      // The post is recommending the place ITSELF. It becomes a mention, but a
      // GEOGRAPHIC one — resolvable only to a geographic provider entity, never
      // to a business that merely carries its name. `isEligibleVenueName` is
      // deliberately NOT applied: that rule screens business names, and a city
      // is not competing to be a business.
      peerGeographic.add(p);
      eligible.push(p);
      continue;
    }
    if (!isEligibleVenueName(p.name)) {
      droppedIneligibleName += 1;
      continue;
    }
    eligible.push(p);
  }

  // Group by (normalizedName, region). Keep first-seen order deterministic.
  type Group = {
    displayName: string;
    normalizedName: string;
    region: string | null;
    places: PlaceCandidateEvidence[];
    primaryName?: string;
    hostName?: string;
    relationshipType?: VenueRelationshipType;
    hostPlaces?: PlaceCandidateEvidence[];
  };
  const groups: Group[] = [];
  const indexByKey = new Map<string, number>();
  for (const p of eligible) {
    const normalizedName = normalizeVenueName(p.name);
    const region = (p.region ?? '').trim().toLowerCase() || null;
    const key = `${normalizedName}::${region ?? ''}`;
    const existing = indexByKey.get(key);
    if (existing != null) {
      groups[existing]!.places.push(p);
    } else {
      indexByKey.set(key, groups.length);
      groups.push({ displayName: p.name.trim(), normalizedName, region, places: [p] });
    }
  }

  // ---- Venue↔host relationship merge -----------------------------------
  // Fold a host location into its primary venue when an explicit phrase
  // ("A at/@/inside/located at B") links two extracted names AND the host is
  // not independently featured. The host is kept as CONTEXT, never a separate
  // searchable mention — so "X Eats @ Brewery X" is one slot, not two.
  const allPhrases = relationshipPhrases(eligible);
  const relationships: VenueRelationshipDiagnostic[] = [];
  const mergedHost = new Set<number>();
  for (let ai = 0; ai < groups.length; ai++) {
    if (mergedHost.has(ai) || groups[ai]!.hostName) continue;
    for (let bi = 0; bi < groups.length; bi++) {
      if (ai === bi || mergedHost.has(bi) || groups[ai]!.hostName) continue;
      const rel = detectRelationshipPhrase(groups[ai]!.normalizedName, groups[bi]!.normalizedName, allPhrases);
      if (!rel) continue;
      const hostValues = groups[bi]!.places.flatMap((p) => p.explicitEvidence.map((e) => e.value));
      const independent = hostIndependentlyFeatured(hostValues, rel.phrase);
      const groupedTs = new Set<number>();
      for (const g of [groups[ai]!, groups[bi]!]) {
        for (const p of g.places) {
          for (const e of p.explicitEvidence) {
            if (typeof e.timestampSeconds === 'number' && Number.isFinite(e.timestampSeconds)) groupedTs.add(e.timestampSeconds);
          }
        }
      }
      relationships.push({
        primaryVenueName: groups[ai]!.displayName,
        hostVenueName: groups[bi]!.displayName,
        relationshipType: rel.type,
        phrase: rel.phrase,
        timestamps: [...groupedTs].sort((x, y) => x - y),
        hostIndependentlyFeatured: independent,
        groupingReason: independent
          ? 'host_independently_featured_kept_separate'
          : 'explicit_relationship_phrase',
      });
      if (independent) continue; // keep both — the host is its own place to save
      groups[ai]!.primaryName = groups[ai]!.displayName;
      groups[ai]!.hostName = groups[bi]!.displayName;
      groups[ai]!.relationshipType = rel.type;
      groups[ai]!.hostPlaces = groups[bi]!.places;
      groups[ai]!.displayName = `${groups[ai]!.displayName} at ${groups[bi]!.displayName}`;
      mergedHost.add(bi);
    }
  }
  const liveGroups = groups.filter((_, i) => !mergedHost.has(i));

  const mentions: VenueMention[] = liveGroups.slice(0, MAX_MENTIONS).map((g, i) => {
    const sources = new Set<PlaceEvidenceSource>();
    const nameEvidenceSources = new Set<PlaceEvidenceSource>();
    const timestamps = new Set<number>();
    let mentionCount = 0;
    let bestConfidence = 0;
    let category: string | null = null;
    let categoryConfidence = 0;
    let categoryEvidenceTags: string[] = [];
    for (const p of g.places) {
      const nameTokens = distinctiveTokensOf(g.primaryName ?? p.name)
        .map((token) => token.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean);
      bestConfidence = Math.max(bestConfidence, p.confidence);
      if (p.category && (p.categoryConfidence ?? 0) >= categoryConfidence) {
        category = p.category;
        categoryConfidence = p.categoryConfidence ?? 0;
        categoryEvidenceTags = p.categoryEvidenceTags ?? [];
      }
      for (const e of p.explicitEvidence) {
        sources.add(e.source);
        const phraseTokens = new Set(
          normalizePhrase(e.value)
            .split(/[\s\-]+/)
            .map((token) => token.replace(/[^a-z0-9]/g, ''))
            .filter(Boolean),
        );
        if (nameTokens.length > 0 && nameTokens.every((token) => phraseTokens.has(token))) {
          nameEvidenceSources.add(e.source);
        }
        if (typeof e.timestampSeconds === 'number' && Number.isFinite(e.timestampSeconds)) {
          timestamps.add(e.timestampSeconds);
        }
        mentionCount += 1;
      }
    }
    // Host timestamps join the grouped set (context) but NOT the token set.
    for (const p of g.hostPlaces ?? []) {
      for (const e of p.explicitEvidence) {
        if (typeof e.timestampSeconds === 'number' && Number.isFinite(e.timestampSeconds)) timestamps.add(e.timestampSeconds);
      }
    }
    const ts = [...timestamps].sort((a, b) => a - b);
    const srcList = [...sources];
    const repeated = srcList.length >= 2 || ts.length >= 2 || mentionCount >= 2;
    const hasHost = !!g.hostName;
    const distinctiveTokens = hasHost
      ? [...new Set([...distinctiveTokensOf(g.primaryName!), ...distinctiveTokensOf(g.hostName!)])]
      : distinctiveTokensOf(g.displayName);
    const mention: VenueMention = {
      id: `m${i + 1}`,
      displayName: g.displayName,
      normalizedName: g.normalizedName,
      distinctiveTokens,
      category,
      categoryConfidence,
      categoryEvidenceTags,
      sources: srcList,
      nameEvidenceSources: [...nameEvidenceSources],
      timestamps: ts,
      mentionCount,
      repeated,
      confidence: bestConfidence,
      geo: placeGeo(g.places[0]!),
    };
    // A group is geographic when every place in it is a peer geographic
    // destination. Mixed groups stay ordinary venues — the stricter default.
    if (g.places.length > 0 && g.places.every((pl) => peerGeographic.has(pl))) {
      mention.resolutionMode = 'geographic';
    }
    if (hasHost) {
      mention.primaryVenueName = g.primaryName;
      mention.hostVenueName = g.hostName;
      mention.relationshipType = g.relationshipType;
      mention.supportingEvidence = (g.hostPlaces ?? [])
        .flatMap((p) => p.explicitEvidence.map((e) => ({ source: e.source, value: e.value.slice(0, 200), timestampSeconds: e.timestampSeconds })))
        .slice(0, 8);
    }
    return mention;
  });

  return {
    mentions,
    // Context-only places are aggregated LAST so a real venue's own geo still
    // wins a tie — they add scope, they never override a destination's fields.
    // The shared COUNTRY is assessed separately: unlike city/region it is not a
    // popularity vote but a provenance judgement, because it is the one field
    // strong enough to scope an ambiguous sibling's search.
    // City, region and country are each a PROVENANCE judgement now, never a
    // popularity vote. The vote is what let one peer destination's locality
    // become every sibling's search context; see `establishSharedCity`.
    geoContext: {
      ...establishSharedCity([...eligible, ...geographicContext], evidence.places ?? []),
      ...establishSharedRegion([...eligible, ...geographicContext]),
      ...sharedCountryForEvidence(evidence),
    },
    relationships,
    droppedInferredOnly,
    droppedIneligibleName,
    droppedPassingMention,
    droppedGeographicContext: geographicContext.length,
    peerGeographicDestinations: peerGeographic.size,
  };
}
