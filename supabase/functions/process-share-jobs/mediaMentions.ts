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
//   • Distinct chain locations are kept separate (grouping never merges two
//     mentions whose region differs).
//
// No I/O, no Deno globals — unit-tested from Node (scripts/testMediaMentions.ts).

import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceSource,
} from './mediaEvidence.ts';

/** Bounds so a malformed / oversized payload can never fan out unbounded work. */
export const MAX_MENTIONS = 10;

/** Bounded geographic context derived from explicit evidence only. */
export type MediaGeoContext = {
  city: string | null;
  region: string | null;
  country: string | null;
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
  'dinner', 'dessert', 'desserts', 'bakeshop', 'creamery', 'bistro', 'diner',
  'food', 'foods', 'eats', 'cuisine', 'best', 'good', 'great', 'top',
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

/** Most common explicit city/region/country across the given places. */
function aggregateGeo(places: PlaceCandidateEvidence[]): MediaGeoContext {
  const pick = (key: 'city' | 'region' | 'country'): string | null => {
    const counts = new Map<string, number>();
    for (const p of places) {
      const v = (p[key] ?? '').trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [v, n] of counts) {
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    return best;
  };
  return { city: pick('city'), region: pick('region'), country: pick('country') };
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
  };
  if (!evidence || evidence.insufficientEvidence) return empty;

  let droppedInferredOnly = 0;
  let droppedIneligibleName = 0;
  let droppedPassingMention = 0;

  const eligible: PlaceCandidateEvidence[] = [];
  for (const p of evidence.places) {
    if (p.explicitEvidence.length === 0) {
      droppedInferredOnly += 1;
      continue;
    }
    if (p.role === 'passing_mention') {
      droppedPassingMention += 1;
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
  const allPhrases = eligible
    .flatMap((p) => p.explicitEvidence.map((e) => normalizePhrase(e.value)))
    .filter(Boolean);
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
    for (const p of g.places) {
      const nameTokens = distinctiveTokensOf(g.primaryName ?? p.name)
        .map((token) => token.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean);
      bestConfidence = Math.max(bestConfidence, p.confidence);
      if (!category && p.category) category = p.category;
      for (const e of p.explicitEvidence) {
        sources.add(e.source);
        const phrase = normalizePhrase(e.value).replace(/[^a-z0-9 ]/g, ' ');
        const phraseTokens = new Set(phrase.split(/\s+/).filter(Boolean));
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
      sources: srcList,
      nameEvidenceSources: [...nameEvidenceSources],
      timestamps: ts,
      mentionCount,
      repeated,
      confidence: bestConfidence,
      geo: placeGeo(g.places[0]!),
    };
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
    geoContext: aggregateGeo(eligible),
    relationships,
    droppedInferredOnly,
    droppedIneligibleName,
    droppedPassingMention,
  };
}
