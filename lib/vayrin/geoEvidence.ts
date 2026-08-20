/**
 * lib/vayrin/geoEvidence.ts
 *
 * Vayrin's PURE geographic-evidence model: specificity, compatibility,
 * contradiction, and ranking. No imports, no I/O, no Deno/Node globals — so it
 * is importable from the Edge Function tree (like
 * `lib/shareAgent/recoveryHints.ts` already is), from the media worker, and
 * from ts-node unit tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nearr already classifies geography STRUCTURALLY on two sides:
 *
 *   candidate side — `isGeographicContextOnly()` reads Google's entity types.
 *   source  side   — `isGeographicContextOnlySource()` asks whether a model
 *                    place restated its own city/region/country.
 *
 * Both answer "is this thing merely an administrative container?". Neither
 * answers the question Vayrin needs, which is a question about a PAIR:
 *
 *   "Instagram tagged this post `Los Angeles, California`. The frames say
 *    `Sunken City, San Pedro`. Do these two clues fight, or does one refine
 *    the other?"
 *
 * String equality gets this wrong in the most expensive direction. "Los
 * Angeles" is not "Sunken City", so a naive comparison reports a conflict and
 * throws away the only clue that was actually useful — the specific one. The
 * whole point of the visual pass is to beat the location tag, and a coarse tag
 * must never be allowed to veto the finding it was too coarse to make.
 *
 * THE RULE
 * --------
 * Evidence is comparable only at equivalent geographic levels. Two clues
 * CONTRADICT only where they overlap: compare country against country, region
 * against region, city against city. A level that only one clue asserts is not
 * a disagreement — it is the more specific clue adding information.
 *
 *   metadata city=Los Angeles, region=California, country=US
 *   visual   place=Sunken City, city=San Pedro, region=California, country=US
 *     -> country agrees, region agrees, city differs
 *     -> BUT San Pedro is a district of Los Angeles, which this module has no
 *        gazetteer to know. An unverified city difference inside an agreeing
 *        region is `unverified`, NOT a contradiction. It routes to
 *        verification; it never vetoes.
 *
 *   metadata city=Los Angeles, region=California, country=US
 *   visual   place=Eiffel Tower, city=Paris, country=France
 *     -> country disagrees -> hard contradiction. Vetoed.
 *
 * DELIBERATE NON-GOAL: this module owns no gazetteer, no geocoder, and no
 * place-name list. Resolving "is San Pedro inside Los Angeles?" needs real
 * geographic data, and Nearr already has a system that holds it — Google
 * Places. So the honest output here is a THREE-valued verdict (compatible /
 * unverified / contradicted), and `unverified` is routed to verification rather
 * than guessed at. Encoding a city list here is how you get a module that is
 * confidently wrong in every country nobody tested.
 */

// ---------------------------------------------------------------------------
// Specificity
// ---------------------------------------------------------------------------

/**
 * How precisely a piece of evidence locates something, coarsest first.
 *
 * `place` is the terminal level and covers everything a user could actually
 * navigate to: a business, a landmark, a named natural feature, a trailhead, a
 * viewpoint. Nearr does not need to rank a restaurant against a waterfall —
 * both are "the spot" — and inventing tiers between them only creates ordering
 * decisions with no product meaning.
 */
export const SPECIFICITY_ORDER = [
  'country',
  'region',
  'city',
  'neighborhood',
  'place',
] as const;

export type Specificity = (typeof SPECIFICITY_ORDER)[number];

/** Numeric rank; higher is more specific. */
export function specificityRank(level: Specificity): number {
  return SPECIFICITY_ORDER.indexOf(level);
}

/** True when `a` locates something more precisely than `b`. */
export function isMoreSpecific(a: Specificity, b: Specificity): boolean {
  return specificityRank(a) > specificityRank(b);
}

/** Where a geographic clue came from. Mirrors the evidence sources the media
 *  pipeline already distinguishes, plus the platform location tag and the
 *  Places verification result. */
export type GeoEvidenceSource =
  | 'visual'
  | 'caption'
  | 'transcript'
  | 'metadata'
  | 'visible_text'
  | 'places_verification';

/**
 * One geographic clue.
 *
 * The administrative fields are all optional and independent: a location tag
 * that says only "Bali" carries `country`/`region` and nothing else, and a
 * visual hypothesis about a cliff may carry a `name` with no city at all. Do
 * not synthesize missing levels — an absent field means "this clue is silent
 * here", which is exactly what `compareGeography` needs to know.
 */
export type GeographicEvidence = {
  source: GeoEvidenceSource;
  /** The most precise level this clue actually asserts. */
  specificity: Specificity;
  /** Name of the specific place/neighborhood, when the clue names one. */
  name?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  /** 0..1 — how much the producer of this clue trusts it, pre-verification. */
  confidence?: number;
};

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Result of comparing two geographic clues.
 *
 *   compatible   — every level both clues assert agrees.
 *   unverified   — they differ only at a level where containment is plausible
 *                  and this module cannot check it.
 *   contradicted — they disagree at a level where containment is impossible.
 */
export type GeoCompatibility = 'compatible' | 'unverified' | 'contradicted';

export type GeoComparisonReason =
  | 'country_agrees'
  | 'country_differs'
  | 'region_agrees'
  | 'region_differs'
  | 'city_agrees'
  | 'unverified_city_difference'
  | 'no_overlapping_levels';

export type GeoComparison = {
  verdict: GeoCompatibility;
  /** Levels both clues asserted AND agreed on. */
  agreedLevels: Specificity[];
  /** Closed-vocabulary reason codes — safe to persist as diagnostics. Never
   *  contains a place name or any model prose. */
  reasons: GeoComparisonReason[];
};

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Case/accent/punctuation-insensitive fold, matching the fold already used by
 *  `mediaEvidence.ts` so the two modules classify the same strings the same
 *  way. */
function fold(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip the noise a location tag and a model hypothesis disagree about
 *  cosmetically rather than geographically. "CA" vs "California" is out of
 *  scope (that needs data), but "Greater Los Angeles Area" vs "Los Angeles" is
 *  a formatting difference this can safely absorb. */
function foldAdmin(value: string | null | undefined): string {
  const base = fold(value);
  if (!base) return '';
  return base
    .replace(/^greater /, '')
    .replace(/ (area|county|province|prefecture|region|state|metropolitan area)$/, '')
    .trim();
}

/**
 * Compare two clues level by level.
 *
 * Only levels BOTH clues assert are compared. A level asserted by one alone is
 * information, never disagreement — that asymmetry is the entire reason a
 * specific visual hypothesis can survive a coarse location tag.
 */
export function compareGeography(
  a: GeographicEvidence,
  b: GeographicEvidence,
): GeoComparison {
  const agreedLevels: Specificity[] = [];
  const reasons: GeoComparisonReason[] = [];

  const aCountry = foldAdmin(a.country);
  const bCountry = foldAdmin(b.country);
  if (aCountry && bCountry) {
    if (aCountry === bCountry) {
      agreedLevels.push('country');
      reasons.push('country_agrees');
    } else {
      // Two different countries cannot contain one another. This is the one
      // disagreement that is safe to call a contradiction without any data.
      return { verdict: 'contradicted', agreedLevels, reasons: [...reasons, 'country_differs'] };
    }
  }

  const aRegion = foldAdmin(a.region);
  const bRegion = foldAdmin(b.region);
  if (aRegion && bRegion) {
    if (aRegion === bRegion) {
      agreedLevels.push('region');
      reasons.push('region_agrees');
    } else {
      // Regions of the same country do not nest either. Reached only when the
      // countries agreed, or when one side was silent about country.
      return { verdict: 'contradicted', agreedLevels, reasons: [...reasons, 'region_differs'] };
    }
  }

  const aCity = foldAdmin(a.city);
  const bCity = foldAdmin(b.city);
  if (aCity && bCity) {
    if (aCity === bCity) {
      agreedLevels.push('city');
      reasons.push('city_agrees');
    } else {
      // THE LOAD-BEARING CASE. Cities genuinely do nest inside one another's
      // metropolitan labels — San Pedro is a district of Los Angeles, Nusa
      // Penida is administered from Klungkung, Ipanema is a Rio neighborhood
      // that platforms tag as its own locality. Calling this a contradiction is
      // how a correct, more specific answer gets discarded in favour of the tag
      // it was supposed to improve on. Report it; let verification settle it.
      return {
        verdict: 'unverified',
        agreedLevels,
        reasons: [...reasons, 'unverified_city_difference'],
      };
    }
  }

  if (agreedLevels.length === 0) {
    // Nothing to compare. Not agreement, and emphatically not conflict: a
    // visual hypothesis naming only a cliff, against a tag naming only a
    // country, share no level at all.
    return { verdict: 'unverified', agreedLevels, reasons: ['no_overlapping_levels'] };
  }

  return { verdict: 'compatible', agreedLevels, reasons };
}

/** Convenience predicate: is this hypothesis outright ruled out by a clue? */
export function contradicts(a: GeographicEvidence, b: GeographicEvidence): boolean {
  return compareGeography(a, b).verdict === 'contradicted';
}

/**
 * Compare one hypothesis against EVERY context clue, keeping the strongest
 * objection. One contradiction anywhere vetoes; otherwise an unverified
 * difference is reported ahead of plain compatibility, because it is the part a
 * caller has to act on.
 */
export function compareAgainstContext(
  hypothesis: GeographicEvidence,
  context: GeographicEvidence[],
): GeoComparison {
  let best: GeoComparison | null = null;
  for (const clue of context) {
    const comparison = compareGeography(hypothesis, clue);
    if (comparison.verdict === 'contradicted') return comparison;
    if (!best) {
      best = comparison;
      continue;
    }
    if (best.verdict === 'compatible' && comparison.verdict === 'unverified') best = comparison;
    else if (best.verdict === comparison.verdict && comparison.agreedLevels.length > best.agreedLevels.length) {
      best = comparison;
    }
  }
  return best ?? { verdict: 'unverified', agreedLevels: [], reasons: ['no_overlapping_levels'] };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Strength tiers Vayrin reports upward. These map onto Nearr's EXISTING job
 *  outcomes in `decisionMapping.ts` — they do not introduce a second state
 *  machine. */
export type HypothesisStrength =
  | 'strong' //      specific, verified, uncontradicted -> eligible for auto-save
  | 'likely' //      specific and credible, but something is unconfirmed
  | 'lead' //        worth showing, not worth pre-selecting
  | 'coarse_only' // we only know the general area
  | 'none'; //       nothing useful

export type RankableHypothesis = {
  evidence: GeographicEvidence;
  /** Did Places (or another verifier) find a real matching record? */
  verified: boolean;
  /** How many independent visual/textual clues back this hypothesis. */
  supportingClueCount: number;
  /** Comparison against the coarse context clues (location tag, caption city). */
  contextComparison?: GeoComparison | null;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Classify one hypothesis.
 *
 * PRINCIPLE: prefer the most specific geographically COMPATIBLE hypothesis
 * supported by CREDIBLE evidence — never the most specific string. Specificity
 * is a tiebreaker among credible hypotheses, not a substitute for credibility.
 * A single blurry frame that "kind of looks like" a famous beach has high
 * specificity and no credibility, and must not outrank the city we actually
 * know.
 */
export function classifyHypothesis(h: RankableHypothesis): HypothesisStrength {
  if (h.contextComparison?.verdict === 'contradicted') return 'none';

  const level = h.evidence.specificity;
  const confidence = clamp01(h.evidence.confidence ?? 0);
  const specific = specificityRank(level) >= specificityRank('neighborhood');

  if (!specific) {
    // City/region/country only. This is NOT a failure — it is a real, useful
    // narrowing the user can act on, and the product mapping keeps it rather
    // than discarding it.
    return confidence > 0 ? 'coarse_only' : 'none';
  }

  // A specific hypothesis needs corroboration to be trusted, because the cost
  // of a confident wrong save exceeds the cost of asking.
  const corroborated = h.supportingClueCount >= 2;

  if (h.verified && corroborated && confidence >= 0.7) return 'strong';
  if (h.verified && confidence >= 0.5) return 'likely';
  if (corroborated && confidence >= 0.6) return 'likely';
  return 'lead';
}

const STRENGTH_ORDER: Record<HypothesisStrength, number> = {
  strong: 0,
  likely: 1,
  lead: 2,
  coarse_only: 3,
  none: 4,
};

/**
 * Order hypotheses best-first: strength, then specificity, then confidence.
 *
 * Strength leads deliberately. Sorting by specificity first would put an
 * uncorroborated guess about a named cliff above a verified restaurant, which
 * inverts the product rule.
 */
export function rankHypotheses<T extends RankableHypothesis>(items: T[]): T[] {
  return [...items].sort((x, y) => {
    const s = STRENGTH_ORDER[classifyHypothesis(x)] - STRENGTH_ORDER[classifyHypothesis(y)];
    if (s !== 0) return s;
    const spec = specificityRank(y.evidence.specificity) - specificityRank(x.evidence.specificity);
    if (spec !== 0) return spec;
    return clamp01(y.evidence.confidence ?? 0) - clamp01(x.evidence.confidence ?? 0);
  });
}

/**
 * Whether a specific hypothesis is allowed to OUTRANK the coarse location tag
 * it sits inside.
 *
 * This is the policy the whole feature turns on, so it is stated in one place
 * rather than spread across the pipeline. A location tag is a geographic PRIOR.
 * It gets to veto (via `contradicted`) and it gets to contextualize. It does
 * not get to be the answer when something better exists, and it never gets to
 * suppress a specific hypothesis merely by being present.
 */
export function specificEvidenceOutranksContext(
  hypothesis: RankableHypothesis,
  context: GeographicEvidence,
): boolean {
  const comparison = compareGeography(hypothesis.evidence, context);
  if (comparison.verdict === 'contradicted') return false;
  if (!isMoreSpecific(hypothesis.evidence.specificity, context.specificity)) return false;
  const strength = classifyHypothesis({ ...hypothesis, contextComparison: comparison });
  return strength === 'strong' || strength === 'likely' || strength === 'lead';
}
