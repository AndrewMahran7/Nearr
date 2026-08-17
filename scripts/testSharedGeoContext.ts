/**
 * scripts/testSharedGeoContext.ts
 *
 * Strong post-level COUNTRY context scoping ambiguous sibling destinations.
 *
 * The production failure this pins (job 10ce36b5, Instagram reel DcFkrUaN6ZV,
 * a Nicaragua travel post). Gemini DID emit `country: "Nicaragua"` and
 * `aggregateGeo` DID carry it — but neither consumer ever read it:
 *
 *   buildMentionQuery  used only city + region
 *   the bias geocode   asked for `"${city}, ${region}"`
 *
 * `aggregateGeo` had picked city "Granada", so the single reused coordinate bias
 * geocoded a bare "Granada" and landed in SPAIN. That bias was then applied to
 * every sibling, which is why the mention "Leon" came back as Restaurante Bar
 * León in Albaicín, Granada, SPAIN. One dropped field poisoned the whole post.
 *
 * The rule is deliberately conservative: a WRONG country is worse than none, so
 * weak and conflicted context are never applied, and a mention's own country
 * always outranks the post's. Half of this file is therefore negative controls.
 *
 * SCOPE: this is task A (country propagation). e98802f city suppression is
 * unchanged, so a place whose name mirrors its own city is still context — the
 * `Granada`-as-destination question is deliberately deferred to task B.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSharedGeoContext.ts
 */

import {
  buildVenueMentions,
  establishSharedCountry,
  sharedCountryForEvidence,
} from '../supabase/functions/process-share-jobs/mediaMentions';
import { resolveVenueMentions } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import { mediaEvidenceAutoSaveEligible } from '../supabase/functions/process-share-jobs/mediaEvidence';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceItem,
  PlaceEvidenceSource,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function ev(source: PlaceEvidenceSource, value: string, ts: number | null = null): PlaceEvidenceItem {
  return { source, value, timestampSeconds: ts };
}

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Test Venue', category: null, address: null, city: null, region: null,
    country: null, coordinates: null, role: 'primary', confidence: 1,
    explicitEvidence: [ev('visible_text', String(over.name ?? 'Test Venue'), 1)],
    inferredEvidence: [], ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return { places, multipleIntentionalPlaces: places.length > 1, insufficientEvidence: false, warnings: [], ...over };
}

// A provider double that answers by country, so a test can prove the resolver
// used CONTEXT rather than provider ordering: the Spanish result is always
// returned FIRST for an ambiguous name.
const SPAIN_GRANADA = {
  googlePlaceId: 'es-granada', name: 'Catedral de Granada',
  types: ['tourist_attraction', 'point_of_interest', 'establishment'], primaryType: 'tourist_attraction',
  formattedAddress: 'Pl. de las Pasiegas, s/n, Centro, 18001 Granada, Spain',
  latitude: 37.1765, longitude: -3.5979, businessStatus: 'OPERATIONAL',
};
const NICA_GRANADA = {
  googlePlaceId: 'ni-granada', name: 'Granada',
  types: ['tourist_attraction', 'point_of_interest', 'establishment'], primaryType: 'tourist_attraction',
  formattedAddress: 'Granada, Nicaragua',
  latitude: 11.9344, longitude: -85.956, businessStatus: 'OPERATIONAL',
};
const SPAIN_LEON = {
  googlePlaceId: 'es-leon', name: 'Restaurante Bar León',
  types: ['restaurant', 'point_of_interest', 'establishment'], primaryType: 'restaurant',
  formattedAddress: 'C. Pan, 1, Albaicín, 18010 Granada, Spain',
  latitude: 37.1808, longitude: -3.5952, businessStatus: 'OPERATIONAL',
};
const NICA_LEON = {
  googlePlaceId: 'ni-leon', name: 'León',
  types: ['tourist_attraction', 'point_of_interest', 'establishment'], primaryType: 'tourist_attraction',
  formattedAddress: 'León, Nicaragua', latitude: 12.4379, longitude: -86.878, businessStatus: 'OPERATIONAL',
};
const OMETEPE = {
  googlePlaceId: 'ni-ometepe', name: 'Ometepe Island',
  types: ['tourist_attraction', 'natural_feature', 'establishment'], primaryType: 'tourist_attraction',
  formattedAddress: 'Ometepe Island, Nicaragua', latitude: 11.5, longitude: -85.585, businessStatus: 'OPERATIONAL',
};
const SJDS = {
  googlePlaceId: 'ni-sjds', name: 'San Juan del Sur',
  types: ['beach', 'natural_feature', 'establishment'], primaryType: 'beach',
  formattedAddress: 'San Juan del Sur, Nicaragua', latitude: 11.2528, longitude: -85.87, businessStatus: 'OPERATIONAL',
};

/** Records every query and geocode the resolver issues. */
function tracingDeps(byQuery: (q: string) => any[]) {
  const queries: string[] = [];
  const geocodes: string[] = [];
  return {
    queries,
    geocodes,
    deps: {
      search: async (query: string) => {
        queries.push(query);
        return { ok: true as const, results: byQuery(query) };
      },
      geocode: async (text: string) => {
        geocodes.push(text);
        // Country-aware, mirroring a real geocoder. The critical behaviour is
        // the LAST branch: an unqualified city name resolves to the globally
        // prominent Spanish city, which is exactly what production did.
        if (/nicaragua/i.test(text)) return { lat: 11.9344, lng: -85.956, region: undefined };
        if (/\b(usa|united states)\b/i.test(text)) return { lat: 33.5225, lng: -117.7075, region: 'CA' };
        if (/bra[sz]il/i.test(text)) return { lat: -22.9068, lng: -43.1729, region: undefined };
        if (/costa rica/i.test(text)) return { lat: 10.4678, lng: -84.6427, region: undefined };
        if (/portugal/i.test(text)) return { lat: 41.1579, lng: -8.6291, region: undefined };
        return { lat: 37.1765, lng: -3.5979, region: undefined };
      },
    },
  };
}

async function resolve(ev_: MediaPlaceEvidence, answer: (q: string) => any[]) {
  const built = buildVenueMentions(ev_);
  const t = tracingDeps(answer);
  const result = await resolveVenueMentions({
    mentions: built.mentions,
    geoContext: built.geoContext,
    env: { googlePlacesKey: 'test-key' } as never,
    platform: 'instagram',
    deps: t.deps as never,
  });
  return { built, result, queries: t.queries, geocodes: t.geocodes };
}

// ---------------------------------------------------------------------------
// 1. Establishing strong shared country.
// ---------------------------------------------------------------------------

check(
  'strong: two places independently naming the same country',
  establishSharedCountry([place({ name: 'A', country: 'Nicaragua' }), place({ name: 'B', country: 'Nicaragua' })]).countryStrength === 'strong',
);
check(
  'strong: source is multiple_places_agree',
  establishSharedCountry([place({ name: 'A', country: 'Nicaragua' }), place({ name: 'B', country: 'Nicaragua' })]).countrySource === 'multiple_places_agree',
);
check(
  'strong: a destination plus a context-only place naming the same country',
  establishSharedCountry(
    [place({ name: 'Ometepe Island', country: 'Nicaragua' })],
    [place({ name: 'Nicaragua', country: 'Nicaragua' })],
  ).countryStrength === 'strong',
);
check(
  'strong: a context-only place ALONE corroborates (the post named the country as a place)',
  establishSharedCountry(
    [place({ name: 'Ometepe Island' })],
    [place({ name: 'Nicaragua', country: 'Nicaragua' })],
  ).countrySource === 'context_only_place',
);
check(
  'strong: the country stated verbatim in explicit evidence corroborates',
  establishSharedCountry([
    place({ name: 'Ometepe Island', country: 'Nicaragua', explicitEvidence: [ev('caption', '7 days in Nicaragua!')] }),
  ]).countrySource === 'explicit_evidence_text',
);
check(
  'weak: exactly one place quietly carrying a country field',
  establishSharedCountry([place({ name: 'Ometepe Island', country: 'Nicaragua' })]).countryStrength === 'weak',
);
check('none: no country anywhere', establishSharedCountry([place({ name: 'A' })]).countryStrength === 'none');
check(
  'unicode: accents fold for COMPARISON but the original is carried forward',
  establishSharedCountry([place({ name: 'A', country: 'México' }), place({ name: 'B', country: 'Mexico' })]).country === 'México',
);

async function main(): Promise<void> {
// ---------------------------------------------------------------------------
// 2. Conflict — a multi-country post coerces nothing (Part 8 / Part 13).
// ---------------------------------------------------------------------------

const spainPortugal = evidence([
  place({ name: 'Alhambra', category: 'attraction', country: 'Spain' }),
  place({ name: 'Alhambra Ticket Office', category: 'attraction', country: 'Spain' }),
  place({ name: 'Livraria Lello', category: 'shopping', country: 'Portugal' }),
  place({ name: 'Ponte Dom Luis I', category: 'attraction', country: 'Portugal' }),
]);
const spVerdict = sharedCountryForEvidence(spainPortugal);
check('conflict: a Spain+Portugal post is conflicted', spVerdict.countryStrength === 'conflicted');
check('conflict: no shared country is offered', spVerdict.country === null);
check('conflict: both countries recorded', (spVerdict.countryCandidates ?? []).length === 2);

const spPortResolved = await resolve(spainPortugal, (q) =>
  /lello|luis/i.test(q) ? [{ ...SPAIN_GRANADA, googlePlaceId: 'pt-x', name: 'Livraria Lello', formattedAddress: 'R. das Carmelitas 144, Porto, Portugal' }] : [SPAIN_GRANADA],
);
check(
  'conflict: no query is coerced into a single country',
  !spPortResolved.queries.some((q) => /Alhambra.*Portugal|Lello.*Spain/i.test(q)),
  spPortResolved.queries.join(' | '),
);
check(
  'conflict: each mention still carries only its OWN country',
  spPortResolved.queries.filter((q) => /Spain/i.test(q)).every((q) => /Alhambra/i.test(q)),
  spPortResolved.queries.join(' | '),
);

// ---------------------------------------------------------------------------
// 3. Weak context must never force a country (Part 12 / Part 25).
// ---------------------------------------------------------------------------

const weak = evidence([
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
  place({ name: 'Sunset Viewpoint', category: 'scenic_spot' }),
]);
check('weak: verdict is weak, not strong', sharedCountryForEvidence(weak).countryStrength === 'weak');
const weakResolved = await resolve(weak, () => [SPAIN_GRANADA]);
check(
  'weak: a sibling with no country of its own is NOT scoped',
  !weakResolved.queries.some((q) => /Sunset Viewpoint.*Nicaragua/i.test(q)),
  weakResolved.queries.join(' | '),
);
check(
  'weak: the place that DID assert the country still uses its own',
  weakResolved.queries.some((q) => /Ometepe Island.*Nicaragua/i.test(q)),
  weakResolved.queries.join(' | '),
);

// ---------------------------------------------------------------------------
// 4. Explicit contradiction — mention-specific evidence wins (Part 14).
// ---------------------------------------------------------------------------

const contradiction = evidence([
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
  place({ name: 'Volcan Concepcion', category: 'scenic_spot', country: 'Nicaragua' }),
  place({ name: 'Alhambra', category: 'attraction', country: 'Spain' }),
]);
const contraVerdict = sharedCountryForEvidence(contradiction);
check('contradiction: the post is conflicted, not Nicaragua', contraVerdict.countryStrength === 'conflicted');
const contraResolved = await resolve(contradiction, () => [SPAIN_GRANADA]);
check(
  'contradiction: the Spanish mention keeps Spain',
  contraResolved.queries.some((q) => /Alhambra.*Spain/i.test(q)),
  contraResolved.queries.join(' | '),
);
check(
  'contradiction: the Spanish mention is never given Nicaragua',
  !contraResolved.queries.some((q) => /Alhambra.*Nicaragua/i.test(q)),
  contraResolved.queries.join(' | '),
);

// A hotel in a neighbouring country is not dragged across the border.
const crossBorder = evidence([
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
  place({ name: 'Volcan Masaya', category: 'scenic_spot', country: 'Nicaragua' }),
  place({ name: 'Nayara Springs', category: 'hotel', country: 'Costa Rica' }),
]);
const crossResolved = await resolve(crossBorder, () => [OMETEPE]);
check(
  'cross-border: the Costa Rican hotel keeps Costa Rica',
  crossResolved.queries.some((q) => /Nayara Springs.*Costa Rica/i.test(q)) &&
    !crossResolved.queries.some((q) => /Nayara Springs.*Nicaragua/i.test(q)),
  crossResolved.queries.join(' | '),
);

// ---------------------------------------------------------------------------
// 5. THE PRODUCTION REEL (job 10ce36b5). Under task A, e98802f still suppresses
//    the three city mentions, so Ometepe Island is the observable destination.
//    What must change is that Spain no longer captures it.
// ---------------------------------------------------------------------------

const nicaraguaReel = evidence(
  [
    place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Ometepe Island', 1)] }),
    place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Granada', 2)] }),
    place({ name: 'San Juan del Sur', category: 'beach', city: 'San Juan del Sur', country: 'Nicaragua', explicitEvidence: [ev('caption', 'San Juan del Sur', 3)] }),
    place({ name: 'Leon', category: 'scenic_spot', city: 'Leon', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Leon', 4)] }),
  ],
  { multipleIntentionalPlaces: true },
);

const nicaVerdict = sharedCountryForEvidence(nicaraguaReel);
check('reel: Nicaragua is established as STRONG', nicaVerdict.countryStrength === 'strong', JSON.stringify(nicaVerdict));
check('reel: exactly one country candidate', (nicaVerdict.countryCandidates ?? []).length === 1);
check('reel: the country survives even though the cities are suppressed', nicaVerdict.country === 'Nicaragua');

const nicaResolved = await resolve(nicaraguaReel, (q) => {
  if (/ometepe/i.test(q)) return [OMETEPE];
  if (/granada/i.test(q)) return [SPAIN_GRANADA, NICA_GRANADA];
  if (/le[oó]n/i.test(q)) return [SPAIN_LEON, NICA_LEON];
  if (/san juan/i.test(q)) return [SJDS];
  return [];
});

check(
  'reel: THE BIAS GEOCODE NO LONGER ASKS FOR A BARE "Granada"',
  !nicaResolved.geocodes.some((g) => /^granada,?\s*$/i.test(g.trim())),
  nicaResolved.geocodes.join(' | '),
);
check(
  'reel: the bias geocode now names the country',
  nicaResolved.geocodes.every((g) => /Nicaragua/i.test(g)),
  nicaResolved.geocodes.join(' | '),
);
check(
  'reel: Ometepe is searched inside Nicaragua',
  nicaResolved.queries.some((q) => /Ometepe Island.*Nicaragua/i.test(q)),
  nicaResolved.queries.join(' | '),
);
check(
  'reel: Ometepe resolves to the Nicaraguan island',
  nicaResolved.result.mentionResults.some(
    (m: any) => m.displayName === 'Ometepe Island' && m.candidates.some((c: any) => c.googlePlaceId === 'ni-ometepe'),
  ),
);
check(
  'reel: task B admits the three cities as PEER geographic destinations',
  nicaResolved.built.mentions.length === 4 && nicaResolved.built.peerGeographicDestinations === 3,
  nicaResolved.built.mentions.map((m) => m.displayName).join(' | '),
);
check('reel: no Spanish candidate is reachable at all', !JSON.stringify(nicaResolved.result.mentionResults).includes('Spain'));

// ---------------------------------------------------------------------------
// 6. Ambiguous siblings, with the provider returning Spain FIRST. This proves
//    context beats provider ordering. (Peer-city mentions arrive in task B; here
//    the same proof is made with non-city destination names.)
// ---------------------------------------------------------------------------

const ambiguousSiblings = evidence(
  [
    place({ name: 'Catedral de Granada', category: 'attraction', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Catedral de Granada, Nicaragua', 1)] }),
    place({ name: 'Iglesia La Recoleccion', category: 'attraction', country: 'Nicaragua', explicitEvidence: [ev('caption', 'Iglesia La Recoleccion', 2)] }),
  ],
  { multipleIntentionalPlaces: true },
);
const ambResolved = await resolve(ambiguousSiblings, (q) =>
  /catedral/i.test(q) ? [SPAIN_GRANADA, NICA_GRANADA] : [NICA_LEON],
);
check(
  'ambiguity: the query is scoped to Nicaragua despite Spain ranking first',
  ambResolved.queries.some((q) => /Catedral de Granada.*Nicaragua/i.test(q)),
  ambResolved.queries.join(' | '),
);
check(
  'ambiguity: the geocode bias is Nicaraguan, not Spanish',
  ambResolved.geocodes.every((g) => /Nicaragua/i.test(g)) || ambResolved.geocodes.length === 0,
  ambResolved.geocodes.join(' | '),
);

// ---------------------------------------------------------------------------
// 7. Regressions — the fix must not disturb domestic or landmark resolution.
// ---------------------------------------------------------------------------

const brooklyn = evidence([
  place({
    name: 'Brooklyn City Pizzeria & Market', category: 'restaurant',
    address: '30012 Crown Valley Pkwy suite I', city: 'Laguna Niguel', region: 'CA', country: 'USA',
    explicitEvidence: [ev('visible_text', 'Brooklyn City Pizzeria & Market 30012 Crown Valley Pkwy', 2)],
  }),
]);
const bkResolved = await resolve(brooklyn, () => [{
  googlePlaceId: 'bk', name: 'Brooklyn City Pizzeria & Market',
  types: ['restaurant', 'establishment'], primaryType: 'restaurant',
  formattedAddress: '30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677, USA',
  latitude: 33.52, longitude: -117.68, businessStatus: 'OPERATIONAL',
}]);
check('regression: Brooklyn City Pizzeria still resolves', bkResolved.result.mentionResults[0]!.outcome === 'verified_single');
check(
  'regression: a US venue keeps its own country in the query',
  bkResolved.queries.some((q) => /Brooklyn City Pizzeria.*USA/i.test(q)),
  bkResolved.queries.join(' | '),
);

const rioReel = evidence(
  [
    place({ name: 'Rio de Janeiro', category: 'scenic_spot', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
    place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
    place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  ],
  { multipleIntentionalPlaces: true },
);
const rioResolved = await resolve(rioReel, (q) => (/redeemer|copacabana/i.test(q) ? [OMETEPE] : []));
check('regression: Rio city is still context, never a mention', !rioResolved.built.mentions.some((m) => m.displayName === 'Rio de Janeiro'));
check('regression: both Rio landmarks still resolve', rioResolved.built.mentions.length === 2);
check(
  'regression: Rio landmarks are scoped to Brazil',
  rioResolved.queries.every((q) => /Brazil/i.test(q)),
  rioResolved.queries.join(' | '),
);

// Businesses whose names contain geography stay businesses.
for (const [name, country] of [['Nicaragua Restaurant', 'USA'], ['Granada Hotel', 'USA'], ['León Cafe', 'USA']] as Array<[string, string]>) {
  const biz = evidence([place({ name, category: 'restaurant', city: 'Los Angeles', region: 'CA', country })]);
  const r = await resolve(biz, () => [SPAIN_GRANADA]);
  check(`regression: "${name}" is still a searchable business`, r.built.mentions.length === 1, JSON.stringify(r.built.mentions.map((m) => m.displayName)));
}

// ---------------------------------------------------------------------------
// 8. WRONG-SAVE STANDARD (Part 37). Country context changes the QUERY, never a
//    gate. The media auto-save gate reads address / category / city+region
//    grounding and never reads country, so scoping a search can raise a mention
//    from no_match to a CONFIRMATION but can never turn one into a silent save.
// ---------------------------------------------------------------------------

// Unicode survives into the query rather than being folded away.
const unicode = evidence([
  place({ name: 'São Conrado', category: 'beach', country: 'Brasil', explicitEvidence: [ev('caption', 'São Conrado, Brasil', 1)] }),
  place({ name: 'Praia do Pepê', category: 'beach', country: 'Brasil' }),
]);
const uniResolved = await resolve(unicode, () => [OMETEPE]);
check(
  'unicode: accented names and countries reach the provider unfolded',
  uniResolved.queries.some((q) => q.includes('São Conrado') && q.includes('Brasil')),
  uniResolved.queries.join(' | '),
);

// ---------------------------------------------------------------------------
// 8. WRONG-SAVE STANDARD (Part 37). Country context changes the QUERY, never a
//    gate. `mediaEvidenceAutoSaveEligible` reads address / category / city+region
//    grounding and never reads country, so scoping a search can raise a mention
//    from no_match to a CONFIRMATION but can never turn one into a silent save.
// ---------------------------------------------------------------------------

check(
  'wrong-save: the Nicaragua reel is not auto-save eligible, before or after',
  mediaEvidenceAutoSaveEligible(nicaraguaReel) === false,
);
check(
  'wrong-save: a country-only place can never satisfy the auto-save gate',
  mediaEvidenceAutoSaveEligible(
    evidence([place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua', confidence: 1 })]),
  ) === false,
);
check(
  'wrong-save: multi-country travel content is never silently saved',
  mediaEvidenceAutoSaveEligible(unicode) === false && mediaEvidenceAutoSaveEligible(spainPortugal) === false,
);
check(
  'wrong-save: a genuine street-address venue is still eligible (gate not tightened)',
  mediaEvidenceAutoSaveEligible(brooklyn) === true,
);

}

main()
  .catch((err) => {
    failures += 1;
    console.log(`FAIL suite threw - ${(err as Error)?.message}`);
  })
  .then(() => {
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
