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

/** A single eligible, normalized venue-name mention ready for a Places search. */
export type VenueMention = {
  /** Stable per-task id: m1, m2, … (assigned in group order). */
  id: string;
  /** Original display name (trimmed) — what the user sees. */
  displayName: string;
  /** Normalized name for matching/grouping (preserves & ' . in initials). */
  normalizedName: string;
  /** Tokens that make the name distinctive (generic cuisine/stop words removed). */
  distinctiveTokens: string[];
  /** Model category hint (e.g. "Pizza Restaurant") — ranking hint ONLY. */
  category: string | null;
  /** Evidence sources that referenced this name (deduped). */
  sources: PlaceEvidenceSource[];
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
};

export type BuildMentionsResult = {
  mentions: VenueMention[];
  /** Aggregate geo context (most common explicit city/region/country). */
  geoContext: MediaGeoContext;
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
// Build mentions
// ---------------------------------------------------------------------------

function hasExplicit(p: PlaceCandidateEvidence): boolean {
  return p.explicitEvidence.length > 0;
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
    if (!hasExplicit(p)) {
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

  const mentions: VenueMention[] = groups.slice(0, MAX_MENTIONS).map((g, i) => {
    const sources = new Set<PlaceEvidenceSource>();
    const timestamps = new Set<number>();
    let mentionCount = 0;
    let bestConfidence = 0;
    let category: string | null = null;
    for (const p of g.places) {
      bestConfidence = Math.max(bestConfidence, p.confidence);
      if (!category && p.category) category = p.category;
      for (const e of p.explicitEvidence) {
        sources.add(e.source);
        if (typeof e.timestampSeconds === 'number' && Number.isFinite(e.timestampSeconds)) {
          timestamps.add(e.timestampSeconds);
        }
        mentionCount += 1;
      }
    }
    const ts = [...timestamps].sort((a, b) => a - b);
    const srcList = [...sources];
    const repeated = srcList.length >= 2 || ts.length >= 2 || mentionCount >= 2;
    return {
      id: `m${i + 1}`,
      displayName: g.displayName,
      normalizedName: g.normalizedName,
      distinctiveTokens: distinctiveTokensOf(g.displayName),
      category,
      sources: srcList,
      timestamps: ts,
      mentionCount,
      repeated,
      confidence: bestConfidence,
      geo: placeGeo(g.places[0]!),
    };
  });

  return {
    mentions,
    geoContext: aggregateGeo(eligible),
    droppedInferredOnly,
    droppedIneligibleName,
    droppedPassingMention,
  };
}
