import type {
  DistinctPlaceSignal,
  EvidenceItem,
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  SceneEnvironmentType,
  SceneSignature,
} from '../types/evidence.js';

export type PlaceCompatibility = 'SAME_PLACE' | 'DIFFERENT_PLACE' | 'UNKNOWN';

export type GroupingReasonCode =
  | 'same_logical_place_id'
  | 'same_normalized_name'
  | 'compatible_identity_name'
  | 'overlapping_candidate_ids'
  | 'visual_anchor_overlap'
  | 'explicit_transition'
  | 'travel_segment'
  | 'different_city'
  | 'different_region'
  | 'different_country'
  | 'distinct_named_venues'
  | 'incompatible_categories'
  | 'visually_incompatible_environment'
  | 'conservative_unknown_merged';

export type MomentGroupingTelemetry = {
  raw_moment_count: number;
  logical_place_count: number;
  moments_merged: number;
  moments_split: number;
  grouping_reason_codes: GroupingReasonCode[];
  same_place_confidence_band: 'high' | 'medium' | 'none';
  distinct_place_evidence_present: boolean;
};

export type GroupingOptions = {
  /** Optional post-retrieval signal for replay/benchmarks. Production grouping
   * runs before Places, so this map is normally absent. Canonical overlap is
   * supported without making Places calls solely for grouping. */
  canonicalCandidateIdsByMoment?: Readonly<Record<string, readonly string[]>>;
};

type RawMoment = {
  key: string;
  order: number;
  places: PlaceCandidateEvidence[];
  timestamps: number[];
};

type Comparison = {
  compatibility: PlaceCompatibility;
  reasons: GroupingReasonCode[];
};

const GENERIC_IDENTITY_TOKENS = new Set([
  'a', 'an', 'the', 'at', 'in', 'of', 'and', 'place', 'spot', 'destination',
  'cenote', 'waterfall', 'beach', 'restaurant', 'cafe', 'coffee', 'shop', 'bar',
  'hotel', 'resort', 'room', 'lobby', 'pool', 'shoreline', 'cliff', 'jump',
  'swimming', 'swim', 'entrance', 'exterior', 'interior', 'food', 'meal',
  'underground', 'outdoor', 'indoor', 'view', 'angle', 'wide', 'close', 'shot',
  'park', 'trail', 'museum', 'attraction', 'landmark', 'island', 'lake',
]);

const TRANSITION_RE = /\b(next\s+stop|then\s+we\s+(?:went|go|drove|headed|traveled|travelled)\s+to|day\s*(?:2|two|3|three|4|four)|our\s+next\s+(?:place|destination)|later\s+that\s+day\s+we\s+(?:went|drove|headed))\b/i;
const TRAVEL_RE = /\b(drove|drive|flight|flew|train|road\s*trip|on\s+the\s+way\s+to|travel(?:ed|led|ing)\s+to)\b/i;

const FOOD = new Set(['restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert', 'nightlife']);
const NATURAL = new Set(['hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island', 'scenic_spot']);
const CULTURAL = new Set(['museum', 'education']);
const TRANSPORT = new Set(['transportation']);

function fold(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityTokens(value: string): string[] {
  return fold(value).split(' ').filter((token) => token && !GENERIC_IDENTITY_TOKENS.has(token));
}

function evidenceTimestamps(place: PlaceCandidateEvidence): number[] {
  return [...new Set([
    ...(place.momentTimestamps ?? []),
    ...place.explicitEvidence.map((item) => item.timestampSeconds),
    ...place.inferredEvidence.map((item) => item.timestampSeconds),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0))]
    .sort((a, b) => a - b)
    .slice(0, 24);
}

function textFor(moment: RawMoment): string {
  return moment.places.flatMap((place) => place.explicitEvidence.map((item) => item.value)).join(' ');
}

function nonEmptyValues(moment: RawMoment, key: 'city' | 'region' | 'country'): Set<string> {
  return new Set(moment.places.map((place) => fold(place[key])).filter(Boolean));
}

function conflicts(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && b.size > 0 && ![...a].some((value) => b.has(value));
}

function administrativeRegionValues(moment: RawMoment): Set<string> {
  const countries = nonEmptyValues(moment, 'country');
  const values = nonEmptyValues(moment, 'region');
  return new Set([...values].filter((region) => {
    // Models frequently alternate between an administrative region and a
    // containing destination/area (for example "Northeast Iceland" and
    // "Vatnajokull National Park") for different views of one landmark.
    // Those labels are hierarchical context, not affirmative separation.
    // Keep true state/province-style mismatches available as a separator, and
    // let explicit different_region signals handle unusual jurisdictions.
    if (/\bnational\s+park\b/.test(region)) return false;
    if ([...countries].some((country) =>
      country && (region === country || region.endsWith(` ${country}`)))) return false;
    return true;
  }));
}

function explicitDistinctSignal(a: RawMoment, b: RawMoment, signal: DistinctPlaceSignal): boolean {
  return [...a.places, ...b.places].some((place) =>
    place.distinctPlaceSignals?.includes(signal));
}

function categoryFamily(category: string | null | undefined): string | null {
  if (!category) return null;
  if (FOOD.has(category)) return 'food';
  if (NATURAL.has(category)) return 'natural';
  if (CULTURAL.has(category)) return 'cultural';
  if (TRANSPORT.has(category)) return 'transport';
  return null;
}

function strongCategoryConflict(a: RawMoment, b: RawMoment): boolean {
  const af = new Set(a.places.map((place) => categoryFamily(place.category)).filter(Boolean));
  const bf = new Set(b.places.map((place) => categoryFamily(place.category)).filter(Boolean));
  if (af.size === 0 || bf.size === 0 || [...af].some((family) => bf.has(family))) return false;
  // Lodging amenities regularly look natural/food-like, so lodging is omitted
  // from the strong family vocabulary. The remaining cross-family changes are
  // reliable enough to separate a restaurant -> beach style itinerary.
  return true;
}

function environmentTypes(moment: RawMoment): Set<SceneEnvironmentType> {
  return new Set(moment.places
    .map((place) => place.sceneSignature?.environmentType)
    .filter((value): value is SceneEnvironmentType => !!value && value !== 'unknown' && value !== 'other'));
}

function strongEnvironmentConflict(a: RawMoment, b: RawMoment): boolean {
  const left = environmentTypes(a);
  const right = environmentTypes(b);
  if (left.size === 0 || right.size === 0 || [...left].some((value) => right.has(value))) return false;
  const incompatible = new Set([
    'food_venue|natural_water', 'food_venue|natural_land',
    'food_venue|lodging',
    'lodging|natural_water', 'lodging|natural_land', 'lodging|cultural',
    'transport|natural_water', 'transport|natural_land',
    'cultural|natural_water',
  ]);
  return [...left].some((x) => [...right].some((y) =>
    incompatible.has(`${x}|${y}`) || incompatible.has(`${y}|${x}`)));
}

function anchorTokens(moment: RawMoment): Set<string> {
  const tokens = new Set<string>();
  for (const place of moment.places) {
    for (const anchor of place.sceneSignature?.visualAnchors ?? []) {
      for (const token of identityTokens(anchor)) tokens.add(token);
    }
  }
  return tokens;
}

function visualOverlap(a: RawMoment, b: RawMoment): boolean {
  const left = anchorTokens(a);
  const right = anchorTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap >= 2 || overlap / Math.min(left.size, right.size) >= 0.5;
}

function candidateOverlap(a: RawMoment, b: RawMoment, options: GroupingOptions): boolean {
  const idsA = new Set(options.canonicalCandidateIdsByMoment?.[a.key] ?? []);
  const idsB = options.canonicalCandidateIdsByMoment?.[b.key] ?? [];
  return idsA.size > 0 && idsB.some((id) => idsA.has(id));
}

function namesFor(moment: RawMoment): string[] {
  return [...new Set(moment.places.map((place) => fold(place.name)).filter(Boolean))];
}

function specificTokenSets(moment: RawMoment): string[][] {
  return moment.places.map((place) => identityTokens(place.name)).filter((tokens) => tokens.length > 0);
}

function compatibleSpecificName(a: RawMoment, b: RawMoment): boolean {
  for (const left of specificTokenSets(a)) {
    for (const right of specificTokenSets(b)) {
      const overlap = left.filter((token) => right.includes(token)).length;
      if (overlap > 0 && overlap / Math.min(left.length, right.length) >= 0.75) return true;
    }
  }
  return false;
}

function distinctSpecificNames(a: RawMoment, b: RawMoment): boolean {
  const left = specificTokenSets(a);
  const right = specificTokenSets(b);
  const explicitSignal = [...a.places, ...b.places].some((place) =>
    place.distinctPlaceSignals?.includes('distinct_named_venue'));
  const sufficientlySpecific = left.some((tokens) => tokens.length >= 2) &&
    right.some((tokens) => tokens.length >= 2);
  return (explicitSignal || sufficientlySpecific) && !compatibleSpecificName(a, b);
}

export function comparePlaceMoments(
  a: RawMoment,
  b: RawMoment,
  options: GroupingOptions = {},
): Comparison {
  if (a.key === b.key && a.key.startsWith('logical:')) {
    return { compatibility: 'SAME_PLACE', reasons: ['same_logical_place_id'] };
  }
  // An explicit narrative boundary wins over a repeated generic name. Two
  // different waterfalls called "Waterfall" must remain two destinations
  // when the creator says "next stop".
  const nextText = textFor(b);
  if (TRANSITION_RE.test(nextText)) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['explicit_transition'] };
  }
  if (candidateOverlap(a, b, options)) {
    return { compatibility: 'SAME_PLACE', reasons: ['overlapping_candidate_ids'] };
  }
  // Exact equality is positive identity evidence only for a distinctive name.
  // Bare labels such as "Cenote" or "Restaurant" remain UNKNOWN and rely on
  // continuity/no-separation evidence instead of pretending category equality
  // proves a physical identity.
  if (namesFor(a).some((name) =>
    identityTokens(name).length > 0 && namesFor(b).includes(name))) {
    return { compatibility: 'SAME_PLACE', reasons: ['same_normalized_name'] };
  }
  if (compatibleSpecificName(a, b)) {
    return { compatibility: 'SAME_PLACE', reasons: ['compatible_identity_name'] };
  }

  if (
    TRAVEL_RE.test(nextText) &&
    b.places.some((place) => place.distinctPlaceSignals?.includes('travel_segment'))
  ) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['travel_segment'] };
  }
  if (conflicts(nonEmptyValues(a, 'country'), nonEmptyValues(b, 'country'))) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['different_country'] };
  }
  if (
    explicitDistinctSignal(a, b, 'different_region') ||
    conflicts(administrativeRegionValues(a), administrativeRegionValues(b))
  ) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['different_region'] };
  }
  if (conflicts(nonEmptyValues(a, 'city'), nonEmptyValues(b, 'city'))) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['different_city'] };
  }
  if (distinctSpecificNames(a, b)) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['distinct_named_venues'] };
  }
  if (strongCategoryConflict(a, b)) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['incompatible_categories'] };
  }
  if (strongEnvironmentConflict(a, b)) {
    return { compatibility: 'DIFFERENT_PLACE', reasons: ['visually_incompatible_environment'] };
  }
  if (visualOverlap(a, b)) {
    return { compatibility: 'SAME_PLACE', reasons: ['visual_anchor_overlap'] };
  }
  return { compatibility: 'UNKNOWN', reasons: [] };
}

function rawMoments(places: PlaceCandidateEvidence[]): RawMoment[] {
  const groups = new Map<string, RawMoment>();
  for (let index = 0; index < places.length; index += 1) {
    const place = places[index]!;
    if (place.role === 'passing_mention' || place.explicitEvidence.length === 0) continue;
    const key = place.logicalPlaceId ? `logical:${place.logicalPlaceId}` : `moment:${index + 1}`;
    const current = groups.get(key);
    if (current) current.places.push(place);
    else groups.set(key, { key, order: index, places: [place], timestamps: [] });
  }
  const moments = [...groups.values()];
  for (const moment of moments) {
    moment.timestamps = [...new Set(moment.places.flatMap(evidenceTimestamps))].sort((a, b) => a - b).slice(0, 24);
  }
  return moments.sort((a, b) => {
    const at = a.timestamps[0];
    const bt = b.timestamps[0];
    if (at !== undefined && bt !== undefined && at !== bt) return at - bt;
    if (at !== undefined && bt === undefined) return -1;
    if (at === undefined && bt !== undefined) return 1;
    return a.order - b.order;
  });
}

function canJoin(
  cluster: RawMoment[],
  moment: RawMoment,
  options: GroupingOptions,
): { different: boolean; same: boolean; reasons: GroupingReasonCode[] } {
  let different = false;
  let same = false;
  const reasons = new Set<GroupingReasonCode>();
  for (const existing of cluster) {
    const compared = comparePlaceMoments(existing, moment, options);
    if (compared.compatibility === 'DIFFERENT_PLACE') different = true;
    if (compared.compatibility === 'SAME_PLACE') same = true;
    for (const reason of compared.reasons) reasons.add(reason);
  }
  return { different, same, reasons: [...reasons] };
}

function clusterMoments(
  moments: RawMoment[],
  options: GroupingOptions,
): { clusters: RawMoment[][]; reasons: GroupingReasonCode[]; usedUnknownMerge: boolean; distinct: boolean } {
  const clusters: RawMoment[][] = [];
  const reasons = new Set<GroupingReasonCode>();
  let usedUnknownMerge = false;
  let distinct = false;

  for (const moment of moments) {
    let joined = false;
    // Rejoin a previously seen physical place when strong identity/visual
    // continuity says it returned after another stop.
    for (const cluster of clusters) {
      const comparison = canJoin(cluster, moment, options);
      if (comparison.same && !comparison.different) {
        cluster.push(moment);
        comparison.reasons.forEach((reason) => reasons.add(reason));
        joined = true;
        break;
      }
    }
    if (joined) continue;

    const current = clusters.at(-1);
    if (!current) {
      clusters.push([moment]);
      continue;
    }
    const comparison = canJoin(current, moment, options);
    comparison.reasons.forEach((reason) => reasons.add(reason));
    if (comparison.different) {
      distinct = true;
      clusters.push([moment]);
    } else {
      current.push(moment);
      if (!comparison.same) {
        usedUnknownMerge = true;
        reasons.add('conservative_unknown_merged');
      }
    }
  }
  return { clusters, reasons: [...reasons], usedUnknownMerge, distinct };
}

function identityScore(place: PlaceCandidateEvidence): number {
  const tokens = identityTokens(place.name);
  const address = place.address?.trim() ? 40 : 0;
  const visibleName = place.explicitEvidence.some((item) =>
    (item.source === 'visible_text' || item.source === 'caption' || item.source === 'speech') &&
    tokens.length > 0 && tokens.every((token) => fold(item.value).split(' ').includes(token)));
  return address + tokens.length * 20 + (visibleName ? 15 : 0) + place.confidence * 10 - (place.hypothesisRank ?? 0);
}

function dedupeEvidence(items: EvidenceItem[], limit: number): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.source}|${item.timestampSeconds ?? ''}|${fold(item.value)}`;
    if (!fold(item.value) || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function mergedSignature(places: PlaceCandidateEvidence[], anchor: PlaceCandidateEvidence): SceneSignature | undefined {
  const signatures = places.map((place) => place.sceneSignature).filter((value): value is SceneSignature => !!value);
  if (signatures.length === 0) return anchor.sceneSignature;
  const preferred = anchor.sceneSignature ?? signatures[0]!;
  return {
    environmentType: preferred.environmentType,
    setting: preferred.setting,
    visualAnchors: [...new Set(signatures.flatMap((signature) => signature.visualAnchors).map((value) => value.trim()).filter(Boolean))].slice(0, 8),
    activity: preferred.activity ?? signatures.find((signature) => signature.activity)?.activity ?? null,
    regionClue: preferred.regionClue ?? signatures.find((signature) => signature.regionClue)?.regionClue ?? null,
  };
}

function firstText(places: PlaceCandidateEvidence[], key: 'address' | 'city' | 'region' | 'country'): string | null {
  for (const place of places) {
    const value = place[key]?.trim();
    if (value) return value;
  }
  return null;
}

function mergeCluster(cluster: RawMoment[], index: number): PlaceCandidateEvidence[] {
  const allPlaces = cluster.flatMap((moment) => moment.places);
  const anchorMoment = [...cluster].sort((a, b) =>
    Math.max(...b.places.map(identityScore)) - Math.max(...a.places.map(identityScore)) || a.order - b.order)[0]!;
  const anchorPlaces = [...anchorMoment.places].sort((a, b) => identityScore(b) - identityScore(a));
  const explicitEvidence = dedupeEvidence(allPlaces.flatMap((place) => place.explicitEvidence), 24);
  const inferredEvidence = dedupeEvidence(allPlaces.flatMap((place) => place.inferredEvidence), 24);
  const momentTimestamps = [...new Set(cluster.flatMap((moment) => moment.timestamps))].sort((a, b) => a - b).slice(0, 24);
  const tags = [...new Set(allPlaces.flatMap((place) => place.categoryEvidenceTags ?? []))].slice(0, 8);
  const signals = [...new Set(allPlaces.flatMap((place) => place.distinctPlaceSignals ?? []))].slice(0, 8);

  return anchorPlaces.map((anchor, rank) => ({
    ...anchor,
    logicalPlaceId: `logical-place-${index + 1}`,
    hypothesisRank: rank,
    momentTimestamps,
    sceneSignature: mergedSignature(allPlaces, anchor),
    distinctPlaceSignals: signals,
    category: anchor.category ?? allPlaces.find((place) => place.category)?.category ?? null,
    categoryConfidence: Math.max(...allPlaces.map((place) => place.categoryConfidence ?? 0)),
    categoryEvidenceTags: tags,
    address: anchor.address?.trim() ? anchor.address : firstText(allPlaces, 'address'),
    city: anchor.city?.trim() ? anchor.city : firstText(allPlaces, 'city'),
    region: anchor.region?.trim() ? anchor.region : firstText(allPlaces, 'region'),
    country: anchor.country?.trim() ? anchor.country : firstText(allPlaces, 'country'),
    role: index === 0 && rank === 0 ? 'primary' : 'secondary',
    confidence: rank === 0 ? Math.max(...allPlaces.map((place) => place.confidence)) : anchor.confidence,
    explicitEvidence,
    inferredEvidence,
  }));
}

export function consolidatePlaceMoments(
  evidence: MediaPlaceEvidence,
  options: GroupingOptions = {},
): { evidence: MediaPlaceEvidence; telemetry: MomentGroupingTelemetry } {
  const moments = rawMoments(evidence.places);
  if (moments.length === 0) {
    return {
      evidence,
      telemetry: {
        raw_moment_count: 0,
        logical_place_count: 0,
        moments_merged: 0,
        moments_split: 0,
        grouping_reason_codes: [],
        same_place_confidence_band: 'none',
        distinct_place_evidence_present: false,
      },
    };
  }

  const grouped = clusterMoments(moments, options);
  const active = new Set(moments.flatMap((moment) => moment.places));
  const contextual = evidence.places.filter((place) => !active.has(place));
  const consolidated = grouped.clusters.flatMap((cluster, index) => mergeCluster(cluster, index));
  const momentsMerged = Math.max(0, moments.length - grouped.clusters.length);
  return {
    evidence: {
      ...evidence,
      places: [...consolidated, ...contextual].slice(0, 12),
      multipleIntentionalPlaces: grouped.clusters.length > 1,
      warnings: [...new Set([
        ...evidence.warnings,
        'same_place_moment_grouping',
        ...(momentsMerged > 0 ? ['same_place_moments_consolidated'] : []),
      ])].slice(0, 24),
    },
    telemetry: {
      raw_moment_count: moments.length,
      logical_place_count: grouped.clusters.length,
      moments_merged: momentsMerged,
      moments_split: Math.max(0, grouped.clusters.length - 1),
      grouping_reason_codes: grouped.reasons.slice(0, 16),
      same_place_confidence_band: momentsMerged === 0 ? 'none' : grouped.usedUnknownMerge ? 'medium' : 'high',
      distinct_place_evidence_present: grouped.distinct,
    },
  };
}
