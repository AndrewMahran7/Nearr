/**
 * scripts/testGeographicDestinations.ts
 *
 * PEER GEOGRAPHIC DESTINATION vs REDUNDANT GEOGRAPHIC CONTAINER.
 *
 * A geographic place can BE the destination, or it can merely describe where the
 * real destinations are. Both look structurally identical to the earlier guard
 * (`name === city`), which is why e98802f suppressed all of them:
 *
 *   Rio reel (job e5825a93) — Copacabana Beach, Christ the Redeemer and
 *   Sugarloaf all report `city: "Rio de Janeiro"`. Rio CONTAINS the
 *   destinations, so naming it again adds nothing. 3 contained siblings.
 *
 *   Nicaragua reel (job 10ce36b5) — Granada, San Juan del Sur and León each
 *   report only their OWN name as their city; Ometepe Island reports none.
 *   Nothing sits inside any of them. 0 contained siblings, so the post is
 *   offering the cities themselves as stops.
 *
 * The safety property that makes "a city may be a destination" unable to reopen
 * the closed P0: a peer city resolves on a GEOGRAPHIC path where only a
 * geographic provider entity is admissible. "7 Mares - Passeio de Lancha Rio de
 * Janeiro" is a tour_agency and is rejected there outright — it can never be
 * substituted for a city, however well its name scores.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testGeographicDestinations.ts
 */

import {
  classifyGeographicSourcePlace,
  isGeographicContextOnlySource,
  summarizeSourceGeographicContext,
  selectRenderablePlaces,
  mediaEvidenceAutoSaveEligible,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions, sharedCountryForEvidence } from '../supabase/functions/process-share-jobs/mediaMentions';
import { evaluateMediaAutoSave } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { resolveVenueMentions, scoreMentionCandidate } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceItem,
  PlaceEvidenceSource,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

function ev(source: PlaceEvidenceSource, value: string, ts: number | null = null): PlaceEvidenceItem {
  return { source, value, timestampSeconds: ts };
}
function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'X', category: null, address: null, city: null, region: null, country: null,
    coordinates: null, role: 'primary', confidence: 1,
    explicitEvidence: [ev('visible_text', String(over.name ?? 'X'), 1)], inferredEvidence: [], ...over,
  };
}
function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return { places, multipleIntentionalPlaces: places.length > 1, insufficientEvidence: false, warnings: [], ...over };
}

// ---- provider doubles -----------------------------------------------------
const loc = (id: string, name: string, addr: string, lat: number, lng: number) => ({
  googlePlaceId: id, name, types: ['locality', 'political'], primaryType: 'locality',
  formattedAddress: addr, latitude: lat, longitude: lng, businessStatus: 'OPERATIONAL',
});
const biz = (id: string, name: string, addr: string, type = 'tour_agency') => ({
  googlePlaceId: id, name, types: [type, 'point_of_interest', 'establishment'], primaryType: type,
  formattedAddress: addr, latitude: -22.918, longitude: -43.171, businessStatus: 'OPERATIONAL',
});

const GRANADA_NI = loc('ni-granada', 'Granada', 'Granada, Nicaragua', 11.93, -85.95);
const GRANADA_ES = loc('es-granada', 'Granada', 'Granada, Spain', 37.17, -3.59);
const GRANADA_HOTEL = biz('granada-hotel', 'Granada Hotel & Tours', 'Calle Real, Granada, Nicaragua', 'lodging');
const LEON_NI = loc('ni-leon', 'León', 'León, Nicaragua', 12.43, -86.87);
const LEON_ES = loc('es-leon', 'León', 'León, Spain', 42.59, -5.57);
const LEON_CAFE = biz('leon-cafe', 'Restaurante Bar León', 'C. Pan 1, Granada, Spain', 'restaurant');
const SJDS_NI = loc('ni-sjds', 'San Juan del Sur', 'San Juan del Sur, Nicaragua', 11.25, -85.87);
const OMETEPE = {
  googlePlaceId: 'ni-ometepe', name: 'Ometepe Island', types: ['tourist_attraction', 'natural_feature', 'establishment'],
  primaryType: 'tourist_attraction', formattedAddress: 'Ometepe Island, Nicaragua', latitude: 11.5, longitude: -85.58, businessStatus: 'OPERATIONAL',
};
const RIO_LOCALITY = loc('rio-loc', 'Rio de Janeiro', 'Rio de Janeiro, State of Rio de Janeiro, Brazil', -22.9, -43.17);
const SEVEN_MARES = biz('7mares', '7 Mares - Passeio de Lancha Rio de Janeiro', 'Av. Infante Dom Henrique, Rio de Janeiro - RJ, Brazil');

function tracing(answer: (q: string) => any[]) {
  const queries: string[] = [];
  return {
    queries,
    deps: {
      search: async (q: string) => { queries.push(q); return { ok: true as const, results: answer(q) }; },
      geocode: async (t: string) => (/nicaragua/i.test(t) ? { lat: 11.93, lng: -85.95 } : /bra[sz]il/i.test(t) ? { lat: -22.9, lng: -43.17 } : /france/i.test(t) ? { lat: 48.85, lng: 2.35 } : /usa/i.test(t) ? { lat: 33.52, lng: -117.7 } : { lat: 37.17, lng: -3.59 }),
    },
  };
}
async function resolve(e: MediaPlaceEvidence, answer: (q: string) => any[]) {
  const built = buildVenueMentions(e);
  const t = tracing(answer);
  const result = await resolveVenueMentions({
    mentions: built.mentions, geoContext: built.geoContext,
    env: { googlePlacesKey: 'k' } as never, platform: 'instagram', deps: t.deps as never,
  });
  return { built, result, queries: t.queries };
}
const modeOf = (built: any, name: string) => built.mentions.find((m: any) => m.displayName === name)?.resolutionMode;

async function main(): Promise<void> {

// ---------------------------------------------------------------------------
// 1. RIO — redundant container. The P0 must stay closed. (Parts 16, 19, 28)
// ---------------------------------------------------------------------------
const rio = evidence([
  place({ name: 'Rio de Janeiro', category: 'scenic_spot', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Sugarloaf Mountain Cable Car', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
], { multipleIntentionalPlaces: true });

check('rio: the city is classified a redundant container', classifyGeographicSourcePlace(rio.places[0]!, rio.places) === 'redundant_container');
check('rio: the landmarks are not geographic context at all', rio.places.slice(1).every((p) => !isGeographicContextOnlySource(p)));
const rioR = await resolve(rio, (q) => (/rio de janeiro/i.test(q) && !/copacabana|redeemer|sugarloaf/i.test(q) ? [RIO_LOCALITY, SEVEN_MARES] : [OMETEPE]));
check('rio: no mention is created for the city', !rioR.built.mentions.some((m) => m.displayName === 'Rio de Janeiro'));
check('rio: the three landmarks all become destinations', rioR.built.mentions.length === 3, rioR.built.mentions.map((m) => m.displayName).join(' | '));
check('rio: ZERO destination queries for the city', !rioR.queries.some((q) => /^rio de janeiro/i.test(q.trim())), rioR.queries.join(' | '));
check('rio: 7 Mares never enters any candidate set', !JSON.stringify(rioR.result.mentionResults).includes('7 Mares'));
check('rio: container counted, no peers admitted', rioR.built.droppedGeographicContext === 1 && rioR.built.peerGeographicDestinations === 0);

// THE ATTACK (Part 28): even if Rio WERE a peer city destination, 7 Mares must
// be inadmissible. Proven directly against the scorer.
const rioAsPeer = { displayName: 'Rio de Janeiro', distinctiveTokens: ['rio', 'de', 'janeiro'], geo: { city: null, region: null, country: 'Brazil' }, resolutionMode: 'geographic' } as any;
const scored7 = scoreMentionCandidate(SEVEN_MARES as never, rioAsPeer, { expectedState: null, bias: null, platform: 'instagram', expectedCountry: 'Brazil' });
const scoredLoc = scoreMentionCandidate(RIO_LOCALITY as never, rioAsPeer, { expectedState: null, bias: null, platform: 'instagram', expectedCountry: 'Brazil' });
check('attack: 7 Mares is REJECTED by the geographic path', scored7.rejected && scored7.rejectionReason === 'not_a_geographic_entity');
check('attack: the Rio locality is ACCEPTED by the geographic path', !scoredLoc.rejected);
check('attack: in ordinary venue mode the locality is still rejected (guard intact)',
  scoreMentionCandidate(RIO_LOCALITY as never, { ...rioAsPeer, resolutionMode: undefined }, { expectedState: null, bias: null, platform: 'instagram' }).rejectionReason === 'geographic_context_only');

// ---------------------------------------------------------------------------
// 2. NICARAGUA — peer cities. (Parts 12, 13, 14, 15, 17)
// ---------------------------------------------------------------------------
const nica = evidence([
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Ometepe Island', 1)] }),
  place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Granada', 2)] }),
  place({ name: 'San Juan del Sur', category: 'beach', city: 'San Juan del Sur', country: 'Nicaragua', explicitEvidence: [ev('caption', 'San Juan del Sur', 3)] }),
  place({ name: 'León', category: 'scenic_spot', city: 'León', country: 'Nicaragua', explicitEvidence: [ev('caption', 'León', 4)] }),
], { multipleIntentionalPlaces: true });

check('nicaragua: shared country is STRONG', sharedCountryForEvidence(nica).countryStrength === 'strong');
for (const n of ['Granada', 'San Juan del Sur', 'León']) {
  const p = nica.places.find((x) => x.name === n)!;
  check(`nicaragua: ${n} is a peer geographic destination`, classifyGeographicSourcePlace(p, nica.places) === 'peer_geographic_destination');
}
check('nicaragua: Ometepe is not geographic context at all', classifyGeographicSourcePlace(nica.places[0]!, nica.places) === null);

const nicaR = await resolve(nica, (q) => {
  if (/ometepe/i.test(q)) return [OMETEPE];
  if (/granada/i.test(q)) return [GRANADA_HOTEL, GRANADA_ES, GRANADA_NI]; // business + Spain FIRST
  if (/le[oó]n/i.test(q)) return [LEON_CAFE, LEON_ES, LEON_NI];
  if (/san juan/i.test(q)) return [SJDS_NI];
  return [];
});
const names = nicaR.built.mentions.map((m) => m.displayName);
check('nicaragua: all four intended destinations become mentions', names.length === 4 && ['Ometepe Island', 'Granada', 'San Juan del Sur', 'León'].every((n) => names.includes(n)), names.join(' | '));
check('nicaragua: the three cities resolve GEOGRAPHICALLY', ['Granada', 'San Juan del Sur', 'León'].every((n) => modeOf(nicaR.built, n) === 'geographic'));
check('nicaragua: Ometepe uses the named-natural-feature path', modeOf(nicaR.built, 'Ometepe Island') === 'natural_feature');
check('nicaragua: peer count recorded, no container suppressed', nicaR.built.peerGeographicDestinations === 3 && nicaR.built.droppedGeographicContext === 0);
check('nicaragua: every city query is scoped to Nicaragua', nicaR.queries.filter((q) => /granada|le[oó]n|san juan/i.test(q)).every((q) => /Nicaragua/i.test(q)), nicaR.queries.join(' | '));

for (const [mention, wantedId, forbidden] of [
  ['Granada', 'ni-granada', ['es-granada', 'granada-hotel']],
  ['León', 'ni-leon', ['es-leon', 'leon-cafe']],
  ['San Juan del Sur', 'ni-sjds', []],
] as Array<[string, string, string[]]>) {
  const r = nicaR.result.mentionResults.find((m: any) => m.displayName === mention)!;
  const ids = (r?.candidates ?? []).map((c: any) => c.googlePlaceId);
  check(`nicaragua: ${mention} resolves to the Nicaraguan geographic entity`, ids.includes(wantedId), JSON.stringify(ids));
  for (const bad of forbidden) check(`nicaragua: ${mention} never accepts ${bad}`, !ids.includes(bad), JSON.stringify(ids));
}
const ome = nicaR.result.mentionResults.find((m: any) => m.displayName === 'Ometepe Island')!;
check('nicaragua: Ometepe still resolves to the island', (ome?.candidates ?? []).some((c: any) => c.googlePlaceId === 'ni-ometepe'));
check('nicaragua: no wrong silent save is possible for this reel', mediaEvidenceAutoSaveEligible(nica) === false);

// THE SAFETY NET (Part 18 / Part 28). Even a single-city post that clears the
// media evidence gate cannot silently save, because the auto-save gate rejects
// a locality candidate as `provider_entity_not_saveable`. A peer city therefore
// always routes to CONFIRMATION. This is asserted, not assumed.
{
  const localityCandidate = { googlePlaceId: 'ni-granada', name: 'Granada', types: ['locality', 'political'], primaryType: 'locality', formattedAddress: 'Granada, Nicaragua', latitude: 11.93, longitude: -85.95, businessStatus: 'OPERATIONAL' };
  const gateResult = {
    mentionId: 'm1', displayName: 'Granada', outcome: 'verified_single', query: 'Granada Nicaragua',
    candidates: [localityCandidate],
    scoring: [{ googlePlaceId: 'ni-granada', name: 'Granada', rawScore: 80, normalizedScore: 0.97, reasons: ['geographic_entity', 'compact_name_match'], rejected: false, rejectionReason: null }],
  } as any;
  const gate = evaluateMediaAutoSave({ mention: { id: 'm1', displayName: 'Granada', distinctiveTokens: ['granada'], resolutionMode: 'geographic' } as any, result: gateResult, allResults: [gateResult] });
  check('safety-net: a city destination is NEVER auto-save eligible', gate.eligible === false);
  check('safety-net: the gate names the reason', gate.candidateRejectionReasons.includes('provider_entity_not_saveable'));
}

// ---------------------------------------------------------------------------
// 3. Generalization. (Parts 6, 21, 22, 23)
// ---------------------------------------------------------------------------
const cityHop = evidence([
  place({ name: 'Paris', category: 'scenic_spot', city: 'Paris', country: 'France' }),
  place({ name: 'London', category: 'scenic_spot', city: 'London', country: 'United Kingdom' }),
  place({ name: 'Amsterdam', category: 'scenic_spot', city: 'Amsterdam', country: 'Netherlands' }),
], { multipleIntentionalPlaces: true });
const hopR = await resolve(cityHop, () => [loc('x', 'Paris', 'Paris, France', 48.85, 2.35)]);
check('city-hop: all three cities are peers', hopR.built.mentions.length === 3 && hopR.built.peerGeographicDestinations === 3);
check('city-hop: all resolve geographically', ['Paris', 'London', 'Amsterdam'].every((n) => modeOf(hopR.built, n) === 'geographic'));
check('city-hop: a multi-country post applies no shared country', sharedCountryForEvidence(cityHop).countryStrength === 'conflicted');

const parisLandmarks = evidence([
  place({ name: 'Paris', category: 'scenic_spot', city: 'Paris', country: 'France' }),
  place({ name: 'Eiffel Tower', category: 'attraction', city: 'Paris', country: 'France' }),
  place({ name: 'Louvre Museum', category: 'museum', city: 'Paris', country: 'France' }),
  place({ name: 'Arc de Triomphe', category: 'attraction', city: 'Paris', country: 'France' }),
], { multipleIntentionalPlaces: true });
const plR = await resolve(parisLandmarks, () => [OMETEPE]);
check('paris+landmarks: Paris is a redundant container (Rio pattern generalizes)', classifyGeographicSourcePlace(parisLandmarks.places[0]!, parisLandmarks.places) === 'redundant_container');
check('paris+landmarks: only the three landmarks become destinations', plR.built.mentions.length === 3 && !plR.built.mentions.some((m) => m.displayName === 'Paris'));

// Part 23 edge case, documented: each city contains its own landmark, so both
// are containers. Conservative — the landmarks are kept, the cities are context.
const mixed = evidence([
  place({ name: 'Paris', category: 'scenic_spot', city: 'Paris', country: 'France' }),
  place({ name: 'Eiffel Tower', category: 'attraction', city: 'Paris', country: 'France' }),
  place({ name: 'London', category: 'scenic_spot', city: 'London', country: 'United Kingdom' }),
  place({ name: 'Big Ben', category: 'attraction', city: 'London', country: 'United Kingdom' }),
], { multipleIntentionalPlaces: true });
const mixedR = await resolve(mixed, () => [OMETEPE]);
check('mixed: both cities are containers of their own landmark', classifyGeographicSourcePlace(mixed.places[0]!, mixed.places) === 'redundant_container' && classifyGeographicSourcePlace(mixed.places[2]!, mixed.places) === 'redundant_container');
check('mixed: the two landmarks survive as destinations', mixedR.built.mentions.length === 2);

const singleCity = evidence([place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Granada, Nicaragua', 1)] })]);
const scR = await resolve(singleCity, () => [GRANADA_HOTEL, GRANADA_ES, GRANADA_NI]);
check('single-city: a city-only post yields one geographic destination', scR.built.mentions.length === 1 && modeOf(scR.built, 'Granada') === 'geographic');
check('single-city: it resolves to the locality, not the hotel', (scR.result.mentionResults[0]?.candidates ?? []).some((c: any) => c.googlePlaceId === 'ni-granada'));
check('single-city: the hotel is excluded', !(scR.result.mentionResults[0]?.candidates ?? []).some((c: any) => c.googlePlaceId === 'granada-hotel'));

// ---------------------------------------------------------------------------
// 4. Precedence + businesses + natural destinations. (Parts 11, 20, 15, 30)
// ---------------------------------------------------------------------------
const contradiction = evidence([
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
  place({ name: 'Volcan Masaya', category: 'scenic_spot', country: 'Nicaragua' }),
  place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Spain', explicitEvidence: [ev('caption', 'Granada, Spain', 1)] }),
], { multipleIntentionalPlaces: true });
const contraR = await resolve(contradiction, (q) => (/granada/i.test(q) ? [GRANADA_NI, GRANADA_ES] : [OMETEPE]));
check('contradiction: the post is conflicted, so no shared country is forced', sharedCountryForEvidence(contradiction).countryStrength === 'conflicted');
check('contradiction: "Granada, Spain" is queried with Spain', contraR.queries.some((q) => /Granada.*Spain/i.test(q)), contraR.queries.join(' | '));
const cg = (contraR.result.mentionResults.find((m: any) => m.displayName === 'Granada')?.candidates ?? []).map((c: any) => c.googlePlaceId);
check('contradiction: it resolves to Granada, Spain — not Nicaragua', cg.includes('es-granada') && !cg.includes('ni-granada'), JSON.stringify(cg));

for (const [name, cat, city, country] of [
  ['Paris Baguette', 'bakery', 'Seoul', 'South Korea'],
  ['Los Angeles Cafe', 'restaurant', 'Los Angeles', 'USA'],
  ['Brooklyn City Pizzeria & Market', 'restaurant', 'Laguna Niguel', 'USA'],
  ['Orange County Mining Co', 'restaurant', 'Orange', 'USA'],
  ['Rio Hotel', 'hotel', 'Las Vegas', 'USA'],
] as Array<[string, any, string, string]>) {
  const b = evidence([place({ name, category: cat, city, region: 'X', country })]);
  const r = await resolve(b, () => [biz('b', name, `1 Main St, ${city}, ${country}`, 'restaurant')]);
  check(`business: "${name}" stays an ordinary venue mention`, r.built.mentions.length === 1 && modeOf(r.built, name) === undefined);
}

const natural = evidence([
  place({ name: 'Maya Bay', category: 'beach', country: 'Thailand' }),
  place({ name: 'Phi Phi Islands', category: 'island', country: 'Thailand' }),
  place({ name: 'Chapada das Mesas National Park', category: 'park', country: 'Brazil' }),
  place({ name: 'Navagio Beach', category: 'beach', country: 'Greece' }),
], { multipleIntentionalPlaces: true });
const natR = await resolve(natural, () => [OMETEPE]);
check('natural: beaches/islands/parks use the physical-destination path, never the city path', natR.built.mentions.length === 4 && natR.built.mentions.every((m) => m.resolutionMode === 'natural_feature'));

// Unicode is preserved into the query, not folded away.
const uni = evidence([
  place({ name: 'León', category: 'scenic_spot', city: 'León', country: 'Nicaragua', explicitEvidence: [ev('caption', 'León, Nicaragua', 1)] }),
  place({ name: 'São Conrado', category: 'beach', country: 'Brasil' }),
], { multipleIntentionalPlaces: true });
const uniR = await resolve(uni, () => [LEON_NI]);
check('unicode: accented city and country reach the provider unfolded', uniR.queries.some((q) => q.includes('León')) && uniR.queries.some((q) => q.includes('São Conrado')), uniR.queries.join(' | '));

// ---------------------------------------------------------------------------
// 5. Observability. (Parts 26, 27)
// ---------------------------------------------------------------------------
const rioSummary = summarizeSourceGeographicContext(rio);
check('diagnostics: Rio reports one container and no peers', rioSummary.dropped === 1 && rioSummary.peerDestinations === 0);
check('diagnostics: the Rio label names the role', rioSummary.labels[0]!.endsWith(':redundant_container'), rioSummary.labels.join(','));
const nicaSummary = summarizeSourceGeographicContext(nica);
check('diagnostics: Nicaragua reports three peers and no container', nicaSummary.peerDestinations === 3 && nicaSummary.dropped === 0);
check('diagnostics: every Nicaragua label names the peer role', nicaSummary.labels.every((l) => l.endsWith(':peer_geographic_destination')), nicaSummary.labels.join(','));
check('diagnostics: labels carry no place names or countries', !JSON.stringify(nicaSummary.labels).match(/Granada|Nicaragua|León/i));
check('diagnostics: renderable destinations exclude the container but keep peers', selectRenderablePlaces(rio).length === 3 && selectRenderablePlaces(nica).length === 4);

}

main()
  .catch((err) => { failures += 1; console.log(`FAIL suite threw - ${(err as Error)?.message}`); })
  .then(() => { console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`); process.exit(failures === 0 ? 0 : 1); });
