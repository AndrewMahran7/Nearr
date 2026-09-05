import type { SolAlternative, SolDestination } from '../solParity/types.js';
import type {
  PremiumCanonicalCandidate,
  PremiumCanonicalizationCall,
  PremiumCanonicalStatus,
  PremiumPlacesSearch,
} from './premiumRecognitionTypes.js';

type CanonicalizationResult = {
  status: PremiumCanonicalStatus;
  selected: PremiumCanonicalCandidate | null;
  alternatives: PremiumCanonicalCandidate[];
  calls: PremiumCanonicalizationCall[];
};

const GENERIC_ONLY = /^(?:waterfall|beach|cliff jumping|restaurant|hotel|scenic spot|park|zoo|lake|city|region)$/i;
const ADMIN_TYPES = new Set(['country', 'administrative_area_level_1', 'administrative_area_level_2', 'locality']);

function tokens(value: string): string[] {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter((token) => token.length > 1 && !['the', 'and', 'at', 'of'].includes(token));
}

function normalized(value: string): string {
  return tokens(value).join(' ');
}

function overlap(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

function physicalIdentity(type: string): boolean {
  return !['ADMIN_AREA', 'BROAD_AREA', 'CITY', 'REGION', 'COUNTRY'].includes(type);
}

function candidateCompatible(hypothesis: SolAlternative, candidate: PremiumCanonicalCandidate): boolean {
  if (overlap(hypothesis.name, candidate.name) < 0.55) return false;
  if (physicalIdentity(hypothesis.entity_type) && candidate.types.length > 0 && candidate.types.every((type) => ADMIN_TYPES.has(type))) return false;
  const expected = [hypothesis.city, hypothesis.region, hypothesis.country].filter((value): value is string => !!value);
  if (!expected.length) return true;
  const address = (candidate.formattedAddress ?? '').toLowerCase();
  return expected.some((value) => address.includes(value.toLowerCase()) || tokens(value).some((token) => address.includes(token)));
}

function rank(hypothesis: SolAlternative, candidates: PremiumCanonicalCandidate[]): PremiumCanonicalCandidate[] {
  return candidates.filter((candidate) => candidateCompatible(hypothesis, candidate)).sort((a, b) => {
    const score = (candidate: PremiumCanonicalCandidate) => overlap(hypothesis.name, candidate.name) * .85 +
      ([hypothesis.city, hypothesis.region, hypothesis.country].filter((value): value is string => !!value)
        .filter((value) => (candidate.formattedAddress ?? '').toLowerCase().includes(value.toLowerCase())).length * .05);
    return score(b) - score(a);
  });
}

export function buildSpecificPlacesQuery(hypothesis: SolAlternative): string {
  // A pipe is presentation syntax for mixed ownership, never a provider
  // identity. Keep the primary (left-hand) identity and discard the contextual
  // host rather than issuing a blended tenant/complex query.
  const identity = hypothesis.name.split('|', 1)[0]!.replace(/\s+/g, ' ').trim();
  if (!identity || GENERIC_ONLY.test(identity)) throw new Error('generic_places_query_forbidden');
  return [identity, hypothesis.city, hypothesis.region, hypothesis.country]
    .filter((value): value is string => !!value?.trim())
    .map((value) => value.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .join(', ');
}

function controlledAlias(hypothesis: SolDestination): SolAlternative | null {
  const match = /\(([^()]{3,80})\)/.exec(hypothesis.name);
  if (!match?.[1]) return null;
  return { ...hypothesis, name: match[1].trim() };
}

export const searchGooglePlacesText: PremiumPlacesSearch = async (query, apiKey, signal) => {
  let response: Response;
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 8 }),
      signal,
    });
  } catch {
    return { ok: false, reason: signal?.aborted ? 'aborted' : 'places_transport_error' };
  }
  if (!response.ok) return { ok: false, reason: `places_http_${response.status}` };
  const body = await response.json().catch(() => null) as { places?: unknown[] } | null;
  const results = (Array.isArray(body?.places) ? body!.places : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const place = raw as Record<string, unknown>;
    const displayName = place.displayName && typeof place.displayName === 'object'
      ? (place.displayName as Record<string, unknown>).text : null;
    const location = place.location && typeof place.location === 'object'
      ? place.location as Record<string, unknown> : {};
    if (typeof place.id !== 'string' || typeof displayName !== 'string') return [];
    return [{
      googlePlaceId: place.id,
      name: displayName,
      formattedAddress: typeof place.formattedAddress === 'string' ? place.formattedAddress : null,
      latitude: typeof location.latitude === 'number' ? location.latitude : null,
      longitude: typeof location.longitude === 'number' ? location.longitude : null,
      types: Array.isArray(place.types) ? place.types.filter((value): value is string => typeof value === 'string').slice(0, 20) : [],
    }];
  });
  return { ok: true, results };
};

export async function canonicalizePremiumHypothesis(args: {
  hypothesis: SolDestination;
  apiKey: string | null;
  search?: PremiumPlacesSearch;
  signal?: AbortSignal;
  maxCalls?: 1 | 2;
}): Promise<CanonicalizationResult> {
  const calls: PremiumCanonicalizationCall[] = [];
  if (!args.apiKey) return { status: 'NAMED_LEAD', selected: null, alternatives: [], calls };
  const search = args.search ?? searchGooglePlacesText;
  const attempts: Array<{ hypothesis: SolAlternative; reason: PremiumCanonicalizationCall['reason'] }> = [
    { hypothesis: args.hypothesis, reason: 'PRIMARY_SPECIFIC_IDENTITY' },
  ];
  const alias = controlledAlias(args.hypothesis);
  if ((args.maxCalls ?? 2) === 2 && alias) attempts.push({ hypothesis: alias, reason: 'CONTROLLED_ALIAS_RETRY' });

  for (const attempt of attempts.slice(0, args.maxCalls ?? 2)) {
    const query = buildSpecificPlacesQuery(attempt.hypothesis);
    const response = await search(query, args.apiKey, args.signal);
    const ranked = response.ok ? rank(attempt.hypothesis, response.results) : [];
    const resultIds = response.ok ? response.results.slice(0, 8).map((result) => result.googlePlaceId) : [];
    const resultNames = response.ok ? response.results.slice(0, 8).map((result) => result.name.slice(0, 200)) : [];
    const selectedCandidate = ranked[0] ?? null;
    const status = selectedCandidate
      ? normalized(attempt.hypothesis.name) === normalized(selectedCandidate.name) ? 'CANONICAL_EXACT' : 'CANONICAL_ALIAS'
      : null;
    calls.push({
      query,
      attemptNumber: calls.length + 1,
      reason: attempt.reason,
      resultCount: response.ok ? response.results.length : 0,
      resultIds,
      resultNames,
      matched: ranked.length > 0,
      selectedGooglePlaceId: selectedCandidate?.googlePlaceId ?? null,
      selectedName: selectedCandidate?.name ?? null,
      outcome: status ?? (response.ok ? 'NO_MATCH' : 'PROVIDER_FAILURE'),
      rejectionReason: selectedCandidate ? null : response.ok ? 'no_compatible_match' : response.reason,
    });
    if (!ranked.length) continue;
    const selected = ranked[0]!;
    const tied = ranked.filter((candidate) => Math.abs(overlap(attempt.hypothesis.name, selected.name) - overlap(attempt.hypothesis.name, candidate.name)) < .05);
    if (tied.length > 1) return { status: 'AMBIGUOUS_CANONICAL', selected: null, alternatives: tied.slice(0, 3), calls };
    return {
      status: normalized(attempt.hypothesis.name) === normalized(selected.name) ? 'CANONICAL_EXACT' : 'CANONICAL_ALIAS',
      selected,
      alternatives: [],
      calls,
    };
  }
  return { status: 'NAMED_LEAD', selected: null, alternatives: [], calls };
}
