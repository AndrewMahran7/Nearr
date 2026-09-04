import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CanonicalizedDestination, SolDestination } from './types.js';

type PlacesCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
};
type SearchPlaces = (query: string, key: string) => Promise<
  | { ok: true; results: PlacesCandidate[] }
  | { ok: false; reason: string }
>;

/** Runtime-load the existing production client without pulling the Deno tree into the worker build graph. */
async function existingSearchPlaces(query: string, key: string): ReturnType<SearchPlaces> {
  const sourcePath = fileURLToPath(new URL('../../../../supabase/functions/process-share-link/places/googlePlaces.ts', import.meta.url));
  const module = await import(pathToFileURL(sourcePath).href) as { searchPlaces: SearchPlaces };
  return module.searchPlaces(query, key);
}

function normalized(value: string): string[] {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((token) => token.length > 1 && !['the', 'and', 'at', 'of'].includes(token));
}

function overlap(a: string, b: string): number {
  const aa = new Set(normalized(a));
  const bb = new Set(normalized(b));
  if (aa.size === 0 || bb.size === 0) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  // Provider names are often the shorter canonical core of a descriptive
  // model identity ("Paradise Dynasty at South Coast Plaza"). Full
  // containment is therefore a strong alias match, not a weak mismatch.
  return common / Math.min(aa.size, bb.size);
}

function geographyScore(destination: SolDestination, candidate: PlacesCandidate): number {
  const haystack = `${candidate.formattedAddress ?? ''} ${candidate.shortFormattedAddress ?? ''}`.toLowerCase();
  const expected = [destination.city, destination.region, destination.country].filter((item): item is string => !!item);
  if (expected.length === 0) return 0.5;
  return expected.filter((item) => haystack.includes(item.toLowerCase())).length / expected.length;
}

function rank(destination: SolDestination, candidates: PlacesCandidate[]): Array<{ candidate: PlacesCandidate; name: number; geo: number; total: number }> {
  return candidates.map((candidate) => {
    const name = overlap(destination.name, candidate.name);
    const geo = geographyScore(destination, candidate);
    return { candidate, name, geo, total: name * 0.8 + geo * 0.2 };
  }).sort((a, b) => b.total - a.total);
}

export async function canonicalizeDestination(args: {
  destination: SolDestination;
  apiKey: string | null;
  search?: SearchPlaces;
}): Promise<CanonicalizedDestination> {
  const query = [args.destination.name, args.destination.city, args.destination.region, args.destination.country].filter(Boolean).join(', ');
  const lead = (calls: number): CanonicalizedDestination => ({ model_identity: args.destination, status: 'NAMED_LEAD', selected: null, alternatives: [], places_calls: calls, query });
  if (!args.apiKey || !query.trim()) return lead(0);
  const response = await (args.search ?? existingSearchPlaces)(query, args.apiKey);
  if (!response.ok || response.results.length === 0) return lead(1);
  const ranked = rank(args.destination, response.results);
  // One matching locality out of city/region/country is enough to establish
  // geographic compatibility (Google commonly renders CA/USA while the model
  // emits California/United States). The name must still match strongly.
  const plausible = ranked.filter((item) => item.name >= 0.45 && item.geo >= 0.3);
  if (plausible.length === 0) return lead(1);
  const top = plausible[0]!;
  const tied = plausible.filter((item) => top.total - item.total < 0.08);
  if (tied.length > 1) {
    return {
      model_identity: args.destination,
      status: 'AMBIGUOUS_CANONICAL',
      selected: null,
      alternatives: tied.slice(0, 5).map(({ candidate }) => ({ google_place_id: candidate.googlePlaceId, name: candidate.name, formatted_address: candidate.formattedAddress ?? null })),
      places_calls: 1,
      query,
    };
  }
  const candidate = top.candidate;
  const status = normalized(args.destination.name).join(' ') === normalized(candidate.name).join(' ')
    ? 'CANONICAL_EXACT'
    : 'CANONICAL_ALIAS';
  return {
    model_identity: args.destination,
    status,
    selected: {
      google_place_id: candidate.googlePlaceId,
      name: candidate.name,
      formatted_address: candidate.formattedAddress ?? null,
      latitude: candidate.latitude ?? null,
      longitude: candidate.longitude ?? null,
      provider_types: candidate.types ?? [],
    },
    alternatives: [],
    places_calls: 1,
    query,
  };
}
