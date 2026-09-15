import {
  CONTEXT_DISTANCE_TIERS_KM,
  geographicFieldsFromLabel,
  haversineDistanceKm,
  normalizeResolutionName,
  countryCodeForContext,
  type GeoPoint,
} from './contextAwarePlacesResolution.ts';

export const GEOGRAPHY_CONSISTENCY_POLICY_VERSION =
  'recognition-geography-consistency-2026-09-14.v1';

export type GeographyConsistencyStatus = 'SUPPORTED' | 'UNKNOWN' | 'CONTRADICTORY';
export type SourceGeographyStrength = 'strong' | 'medium' | 'weak';
export type SourceGeographyScope = 'exact_place' | 'locality' | 'region' | 'country' | 'unknown';
export type SourceGeographyKind =
  | 'platform_location_tag'
  | 'explicit_address'
  | 'explicit_caption_place'
  | 'multiple_consistent_text_signals'
  | 'vague_text_hint'
  | 'creator_profile';

export type SourceGeographyEvidence = {
  version: typeof GEOGRAPHY_CONSISTENCY_POLICY_VERSION;
  kind: SourceGeographyKind;
  strength: SourceGeographyStrength;
  scope: SourceGeographyScope;
  label: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  coordinates: GeoPoint | null;
  provenance: string[];
};

export type CandidateGeography = {
  googlePlaceId?: string | null;
  name?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type GeographyConsistencyDecision = {
  policyVersion: typeof GEOGRAPHY_CONSISTENCY_POLICY_VERSION;
  status: GeographyConsistencyStatus;
  contradiction: boolean;
  distanceKm: number | null;
  distanceLimitKm: number | null;
  countryMatch: boolean | null;
  regionMatch: boolean | null;
  sourceStrength: SourceGeographyStrength | null;
  sourceKind: SourceGeographyKind | null;
  reason: string;
};

export type GeographyAutoSaveDecision = GeographyConsistencyDecision & {
  autoSaveEligible: boolean;
  overrideApplied: boolean;
  resolutionReason:
    | 'geography_supported'
    | 'geography_unknown'
    | 'geography_conflict'
    | 'geography_conflict_decisive_override';
};

type TaggedLocationLike = {
  confidence?: 'high' | 'medium' | 'low' | null;
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  provenance?: string | null;
  sourceLocationId?: string | null;
};

function bounded(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function point(latitude: unknown, longitude: unknown): GeoPoint | null {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
    ? { lat: latitude, lng: longitude }
    : null;
}

function sameGeoText(left: string | null, right: string | null): boolean | null {
  const a = normalizeResolutionName(left);
  const b = normalizeResolutionName(right);
  if (!a || !b) return null;
  return a === b || a.includes(b) || b.includes(a);
}

function distanceLimit(scope: SourceGeographyScope): number | null {
  if (scope === 'exact_place' || scope === 'locality') return CONTEXT_DISTANCE_TIERS_KM[1];
  if (scope === 'region' || scope === 'unknown') return CONTEXT_DISTANCE_TIERS_KM[2];
  return null;
}

export function sourceGeographyFromTaggedLocation(args: {
  taggedLocation: TaggedLocationLike | null | undefined;
  granularity?: 'exact_place' | 'geographic_context' | 'unknown' | null;
  resolvedCandidate?: CandidateGeography | null;
}): SourceGeographyEvidence | null {
  const tag = args.taggedLocation;
  if (!tag) return null;
  const label = bounded(tag.placeName ?? tag.address, 500);
  const candidateAddress = bounded(args.resolvedCandidate?.formattedAddress, 500);
  const fields = geographicFieldsFromLabel(candidateAddress ?? label);
  const coordinates = point(tag.latitude, tag.longitude) ??
    point(args.resolvedCandidate?.latitude, args.resolvedCandidate?.longitude);
  if (!label && !candidateAddress && !coordinates) return null;
  const verified = args.granularity === 'exact_place' || args.granularity === 'geographic_context';
  return {
    version: GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
    kind: 'platform_location_tag',
    strength: tag.confidence === 'high' && verified
      ? 'strong'
      : tag.confidence === 'low' ? 'weak' : 'medium',
    scope: args.granularity === 'exact_place'
      ? 'exact_place'
      : args.granularity === 'geographic_context' ? 'region' : 'unknown',
    label: candidateAddress ?? label,
    locality: fields.locality,
    region: fields.region,
    country: fields.country,
    coordinates,
    provenance: [tag.provenance, tag.sourceLocationId ? 'platform_location_id' : null, verified ? 'provider_verified' : null]
      .filter((value): value is string => !!value)
      .slice(0, 4),
  };
}

/**
 * Extract only explicit locative references to a recognized country. This is
 * intentionally narrower than general NER: a country adjective or unrelated
 * capitalized word is not enough. Platform tags still win at the call site.
 */
export function sourceGeographyFromCaptionText(
  captionText: string | null | undefined,
): SourceGeographyEvidence | null {
  const text = bounded(captionText, 4_000);
  if (!text) return null;
  const words = [...text.matchAll(/[\p{L}][\p{L}'.-]*/gu)];
  for (let start = 0; start < words.length; start += 1) {
    for (let size = Math.min(4, words.length - start); size >= 1; size -= 1) {
      const selected = words.slice(start, start + size);
      const label = selected.map((entry) => entry[0]).join(' ');
      if (!countryCodeForContext(label)) continue;
      const offset = selected[0]!.index ?? 0;
      const prefix = text.slice(Math.max(0, offset - 36), offset);
      if (!/(?:^|\b)(?:in|to|from|visit(?:ed|ing)?|arriv(?:e|ed|ing)\s+in|made\s+it\s+to)\s*$/iu.test(prefix)) {
        continue;
      }
      return {
        version: GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
        kind: 'explicit_caption_place',
        strength: 'strong',
        scope: 'country',
        label,
        locality: null,
        region: null,
        country: label,
        coordinates: null,
        provenance: ['caption_locative_country', 'country_dictionary_match'],
      };
    }
  }
  return null;
}

export function parseSourceGeography(raw: unknown): SourceGeographyEvidence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const strength = value.strength;
  const scope = value.scope;
  const kind = value.kind;
  if (!['strong', 'medium', 'weak'].includes(String(strength)) ||
      !['exact_place', 'locality', 'region', 'country', 'unknown'].includes(String(scope)) ||
      !['platform_location_tag', 'explicit_address', 'explicit_caption_place',
        'multiple_consistent_text_signals', 'vague_text_hint', 'creator_profile'].includes(String(kind))) {
    return null;
  }
  const coordinatesRaw = value.coordinates && typeof value.coordinates === 'object'
    ? value.coordinates as Record<string, unknown>
    : null;
  return {
    version: GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
    kind: kind as SourceGeographyKind,
    strength: strength as SourceGeographyStrength,
    scope: scope as SourceGeographyScope,
    label: bounded(value.label, 500),
    locality: bounded(value.locality),
    region: bounded(value.region),
    country: bounded(value.country),
    coordinates: point(coordinatesRaw?.lat, coordinatesRaw?.lng),
    provenance: Array.isArray(value.provenance)
      ? value.provenance.map((item) => bounded(item, 80)).filter((item): item is string => !!item).slice(0, 8)
      : [],
  };
}

export function sourceGeographyFromExtractionPayload(raw: unknown): SourceGeographyEvidence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parseSourceGeography((raw as Record<string, unknown>).sourceGeography);
}

export function sourceGeographyLabel(source: SourceGeographyEvidence | null | undefined): string | null {
  if (!source) return null;
  return source.label ?? ([source.locality, source.region, source.country].filter(Boolean).join(', ') || null);
}

export function evaluateGeographyConsistency(args: {
  source: SourceGeographyEvidence | null | undefined;
  candidate: CandidateGeography | null | undefined;
}): GeographyConsistencyDecision {
  const source = args.source ?? null;
  const candidate = args.candidate ?? null;
  const base: Pick<GeographyConsistencyDecision,
    'policyVersion' | 'distanceKm' | 'distanceLimitKm' | 'countryMatch' | 'regionMatch' |
    'sourceStrength' | 'sourceKind'> = {
    policyVersion: GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
    distanceKm: null,
    distanceLimitKm: null,
    countryMatch: null,
    regionMatch: null,
    sourceStrength: source?.strength ?? null,
    sourceKind: source?.kind ?? null,
  };
  if (!source || !candidate || source.strength === 'weak') {
    return { ...base, status: 'UNKNOWN', contradiction: false, reason: source ? 'source_geography_too_weak' : 'source_geography_missing' };
  }
  const candidateFields = geographicFieldsFromLabel(candidate.formattedAddress);
  const countryMatch = sameGeoText(source.country, candidateFields.country);
  const regionMatch = sameGeoText(source.region, candidateFields.region) ??
    sameGeoText(source.locality, candidate.formattedAddress ?? null);
  const candidateCoordinates = point(candidate.latitude, candidate.longitude);
  const limit = distanceLimit(source.scope);
  const distance = source.coordinates && candidateCoordinates
    ? Math.round(haversineDistanceKm(source.coordinates, candidateCoordinates) * 10) / 10
    : null;
  const evaluated = { ...base, countryMatch, regionMatch, distanceKm: distance, distanceLimitKm: limit };

  if (countryMatch === false && source.strength === 'strong') {
    return { ...evaluated, status: 'CONTRADICTORY', contradiction: true, reason: 'strong_source_country_conflict' };
  }
  if (source.strength === 'strong' && limit != null && distance != null && distance > limit) {
    return { ...evaluated, status: 'CONTRADICTORY', contradiction: true, reason: 'strong_source_distance_conflict' };
  }
  if (countryMatch === true || regionMatch === true || (limit != null && distance != null && distance <= limit)) {
    return { ...evaluated, status: 'SUPPORTED', contradiction: false, reason: 'candidate_geography_supported' };
  }
  return { ...evaluated, status: 'UNKNOWN', contradiction: false, reason: 'candidate_geography_not_comparable' };
}

export function evaluateGeographyAutoSave(args: {
  source: SourceGeographyEvidence | null | undefined;
  candidate: CandidateGeography | null | undefined;
  decisiveIndependentEvidence?: boolean;
}): GeographyAutoSaveDecision {
  const consistency = evaluateGeographyConsistency(args);
  if (consistency.status !== 'CONTRADICTORY') {
    return {
      ...consistency,
      autoSaveEligible: true,
      overrideApplied: false,
      resolutionReason: consistency.status === 'SUPPORTED' ? 'geography_supported' : 'geography_unknown',
    };
  }
  if (args.decisiveIndependentEvidence === true) {
    return {
      ...consistency,
      autoSaveEligible: true,
      overrideApplied: true,
      resolutionReason: 'geography_conflict_decisive_override',
    };
  }
  return {
    ...consistency,
    autoSaveEligible: false,
    overrideApplied: false,
    resolutionReason: 'geography_conflict',
  };
}
