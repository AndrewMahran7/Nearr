/**
 * scripts/testGeographicContextSource.ts
 *
 * PINNED regression for a production wrong-save class: LOCALITY LAUNDERING.
 *
 * Production job 1e234bae (Instagram DcBz1dhSoax, 2026-08-16). Gemini emitted a
 * place whose name was the city it was already reporting as its own city:
 *
 *     name    "Rio de Janeiro"      city    "Rio de Janeiro"
 *     region  "Rio de Janeiro"      country "Brazil"
 *     address null                  category "scenic_spot"   confidence 1.0
 *
 * The CANDIDATE-side guard worked: `isGeographicContextOnly` rejected Google's
 * `locality`/`political` entity for Rio. But the mention was still searched by
 * NAME, and Google also returned "7 Mares - Passeio de Lancha Rio de Janeiro" —
 * a tour agency whose name merely CONTAINS the city. That candidate is
 * business-like, scored 0.9267, was the single plausible candidate, and was
 * SILENTLY AUTO-SAVED as the user's place.
 *
 * The invariant this file pins:
 *
 *     a context-only SOURCE mention
 *   + a business candidate containing that context phrase
 *   -> can never silently auto-save
 *
 * Note the model has no way to say "city": `NEARR_CATEGORY_SET` has no
 * city/locality/administrative member, and here it chose `scenic_spot` — a
 * category real beaches and landmarks legitimately use. So the guard must NOT
 * read the category. It reads the place's own self-reference instead.
 *
 * The other half of this file is the overcorrection guard: businesses whose
 * names contain geography must keep resolving, and parks/beaches/landmarks must
 * not be mistaken for administrative context.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testGeographicContextSource.ts
 */

import {
  isGeographicContextOnlySource,
  hasStreetAddressText,
  selectRenderablePlaces,
  renderMediaEvidenceCaption,
  mediaEvidenceAutoSaveEligible,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import {
  resolveVenueMentions,
  scoreMentionCandidate,
} from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type {
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  PlaceEvidenceItem,
  PlaceEvidenceSource,
} from '../supabase/functions/process-share-jobs/mediaEvidence';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function ev(source: PlaceEvidenceSource, value: string, ts: number | null = null): PlaceEvidenceItem {
  return { source, value, timestampSeconds: ts };
}

function place(over: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name: 'Test Venue',
    category: null,
    address: null,
    city: null,
    region: null,
    country: null,
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [ev('visible_text', 'Test Venue')],
    inferredEvidence: [],
    ...over,
  };
}

function evidence(places: PlaceCandidateEvidence[], over: Partial<MediaPlaceEvidence> = {}): MediaPlaceEvidence {
  return {
    places,
    multipleIntentionalPlaces: places.length > 1,
    insufficientEvidence: false,
    warnings: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. The production place, reproduced field-for-field.
// ---------------------------------------------------------------------------

const rioCity = place({
  name: 'Rio de Janeiro',
  category: 'scenic_spot',
  city: 'Rio de Janeiro',
  region: 'Rio de Janeiro',
  country: 'Brazil',
  address: null,
  confidence: 1.0,
  explicitEvidence: [ev('visible_text', 'Rio de Janeiro', 1), ev('caption', 'Rio de Janeiro, Brazil', 0)],
});

check('production Rio place is source geographic context', isGeographicContextOnlySource(rioCity));
check(
  'its scenic_spot category does not rescue it',
  isGeographicContextOnlySource({ ...rioCity, category: 'attraction' }) &&
    isGeographicContextOnlySource({ ...rioCity, category: 'beach' }),
);
check('confidence 1.0 does not rescue it', isGeographicContextOnlySource({ ...rioCity, confidence: 1 }));

// ---------------------------------------------------------------------------
// 2. Locality laundering — the wrong-save invariant.
// ---------------------------------------------------------------------------

const laundering: Array<[string, PlaceCandidateEvidence]> = [
  ['Rio de Janeiro [city]', rioCity],
  ['Los Angeles [city]', place({ name: 'Los Angeles', city: 'Los Angeles', region: 'California', country: 'USA' })],
  ['New York [city]', place({ name: 'New York', city: 'New York', region: 'New York', country: 'USA' })],
  ['Paris [city]', place({ name: 'Paris', city: 'Paris', country: 'France' })],
  ['Orange County [admin region]', place({ name: 'Orange County', region: 'Orange County', country: 'USA' })],
  ['Brazil [country]', place({ name: 'Brazil', country: 'Brazil' })],
  ['compound "Los Angeles, California"', place({ name: 'Los Angeles, California', city: 'Los Angeles', region: 'California' })],
  ['accent/case insensitive', place({ name: 'SÃO PAULO', city: 'São Paulo' })],
];

for (const [label, p] of laundering) {
  check(`laundering blocked: ${label}`, isGeographicContextOnlySource(p));
  const mentions = buildVenueMentions(evidence([p]));
  check(
    `laundering blocked: ${label} produces no searchable mention`,
    mentions.mentions.length === 0,
    JSON.stringify(mentions.mentions.map((m) => m.displayName)),
  );
  check(
    `laundering blocked: ${label} renders no destination`,
    selectRenderablePlaces(evidence([p])).length === 0,
  );
  check(
    `laundering blocked: ${label} can never silently auto-save`,
    mediaEvidenceAutoSaveEligible(evidence([p])) === false,
  );
}

// ---------------------------------------------------------------------------
// 3. Businesses whose NAMES contain geography must keep resolving (Part 5).
//    The source type is the boundary, never the words in the string.
// ---------------------------------------------------------------------------

const geographicBrands: Array<[string, PlaceCandidateEvidence]> = [
  ['California Pizza Kitchen', place({ name: 'California Pizza Kitchen', category: 'restaurant', city: 'Los Angeles', region: 'California', country: 'USA' })],
  ['Brooklyn City Pizzeria & Market', place({
    name: 'Brooklyn City Pizzeria & Market',
    category: 'restaurant',
    address: '30012 Crown Valley Pkwy suite I',
    city: 'Laguna Niguel',
    region: 'CA',
    country: 'USA',
  })],
  ['New York Pizza', place({ name: 'New York Pizza', category: 'restaurant', city: 'Sacramento', region: 'CA' })],
  ['Paris Baguette', place({ name: 'Paris Baguette', category: 'bakery', city: 'Paris', country: 'France' })],
  ['Rio Hotel', place({ name: 'Rio Hotel', category: 'hotel', city: 'Las Vegas', region: 'NV' })],
  ['Los Angeles Cafe [restaurant]', place({ name: 'Los Angeles Cafe', category: 'restaurant', city: 'Los Angeles', region: 'California' })],
  ['Orange County Mining Co [restaurant]', place({ name: 'Orange County Mining Co', category: 'restaurant', city: 'Orange', region: 'California' })],
  ['Santa Fe Importers', place({ name: 'Santa Fe Importers', category: 'restaurant', city: 'Long Beach', region: 'CA' })],
];

for (const [label, p] of geographicBrands) {
  check(`geographic brand survives: ${label}`, !isGeographicContextOnlySource(p));
  check(
    `geographic brand survives: ${label} is still a searchable mention`,
    buildVenueMentions(evidence([p])).mentions.length === 1,
  );
  check(
    `geographic brand survives: ${label} still renders`,
    selectRenderablePlaces(evidence([p])).length === 1,
  );
}

// ---------------------------------------------------------------------------
// 4. Parks, beaches, landmarks and attractions are NOT administrative context
//    (Part 6). Non-business must never be conflated with geographic context.
// ---------------------------------------------------------------------------

const destinations: Array<[string, PlaceCandidateEvidence]> = [
  ['Copacabana Beach', place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' })],
  ['Christ the Redeemer', place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' })],
  ['Sugarloaf Mountain Cable Car', place({ name: 'Sugarloaf Mountain Cable Car', category: 'attraction', city: 'Rio de Janeiro', country: 'Brazil' })],
  ['Ipanema Beach', place({ name: 'Ipanema Beach', category: 'beach', city: 'Rio de Janeiro', country: 'Brazil' })],
  ['Maya Bay', place({ name: 'Maya Bay', category: 'beach', city: 'Krabi', country: 'Thailand' })],
  ['Chapada das Mesas National Park', place({ name: 'Chapada das Mesas National Park', category: 'park', region: 'Maranhão', country: 'Brazil' })],
  ['Bradley Mountain', place({ name: 'Bradley Mountain', category: 'hiking_trail', city: 'Escondido', region: 'CA' })],
];

for (const [label, p] of destinations) {
  check(`destination survives: ${label}`, !isGeographicContextOnlySource(p));
  check(
    `destination survives: ${label} is still a searchable mention`,
    buildVenueMentions(evidence([p])).mentions.length === 1,
  );
}

// ---------------------------------------------------------------------------
// 5. Evidence precedence: an explicit STREET ADDRESS outranks the
//    self-referential name (Part 22/23). A weak model label must not suppress
//    stronger first-party evidence.
// ---------------------------------------------------------------------------

check(
  'street address in the address field overrides self-reference',
  !isGeographicContextOnlySource(place({ name: 'Brooklyn', city: 'Brooklyn', address: '123 Bedford Ave' })),
);
check(
  'street address spoken/shown in explicit evidence overrides self-reference',
  !isGeographicContextOnlySource(
    place({ name: 'Brooklyn', city: 'Brooklyn', explicitEvidence: [ev('speech', 'find us at 123 Bedford Ave')] }),
  ),
);
check(
  'a non-street "address" does NOT override (city text is not an address)',
  isGeographicContextOnlySource(place({ name: 'Rio de Janeiro', city: 'Rio de Janeiro', address: 'Rio de Janeiro, Brazil' })),
);
check('hasStreetAddressText: positive', hasStreetAddressText('30012 Crown Valley Pkwy'));
check('hasStreetAddressText: negative', !hasStreetAddressText('Rio de Janeiro, Brazil'));
check('hasStreetAddressText: null-safe', !hasStreetAddressText(null) && !hasStreetAddressText(undefined));

// ---------------------------------------------------------------------------
// 6. Missing / uncertain source geography: stay conservative (Part 21).
//    Without the place's own admin fields we have no structured evidence, so
//    behavior is unchanged. (The bare-"Granada" class is the separate
//    international-context task, deliberately not solved here.)
// ---------------------------------------------------------------------------

check(
  'a city name with no admin fields of its own is NOT suppressed (unchanged behavior)',
  !isGeographicContextOnlySource(place({ name: 'Granada', city: null, region: null, country: null })),
);
check(
  'a city name whose fields name a DIFFERENT place is not self-referential',
  !isGeographicContextOnlySource(place({ name: 'Granada', city: 'Managua', country: 'Nicaragua' })),
);
check('an empty name is not classified', !isGeographicContextOnlySource(place({ name: '   ', city: 'Rio de Janeiro' })));

// ---------------------------------------------------------------------------
// 7. THE PRODUCTION MULTI-PLACE JOB. Valid siblings must survive — this is
//    exactly what 38a2048 (evidence fault isolation) was built to protect, and
//    the locality fix must not undo it by nuking the response.
// ---------------------------------------------------------------------------

const rioReel = evidence(
  [
    rioCity,
    place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil', explicitEvidence: [ev('visible_text', 'Christ the Redeemer', 3)] }),
    place({ name: 'Sugarloaf Mountain Cable Car', category: 'attraction', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil', explicitEvidence: [ev('visible_text', 'Sugarloaf Mountain Cable Car', 6)] }),
    place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil', explicitEvidence: [ev('visible_text', 'Copacabana Beach', 9)] }),
    place({ name: 'Ipanema Beach', category: 'beach', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil', explicitEvidence: [ev('visible_text', 'Ipanema Beach', 12)] }),
  ],
  { multipleIntentionalPlaces: true },
);

const rioMentions = buildVenueMentions(rioReel);
const rioNames = rioMentions.mentions.map((m) => m.displayName);

check(
  'Rio reel: the city produces no searchable mention',
  !rioNames.includes('Rio de Janeiro'),
  rioNames.join(' | '),
);
check(
  'Rio reel: all four real destinations survive',
  rioNames.length === 4 &&
    ['Christ the Redeemer', 'Sugarloaf Mountain Cable Car', 'Copacabana Beach', 'Ipanema Beach'].every((n) => rioNames.includes(n)),
  rioNames.join(' | '),
);
check('Rio reel: the city is counted as dropped context', rioMentions.droppedGeographicContext === 1);
check(
  'Rio reel: the city still scopes its siblings (geo context preserved)',
  rioMentions.geoContext.city === 'Rio de Janeiro' &&
    rioMentions.geoContext.region === 'Rio de Janeiro' &&
    rioMentions.geoContext.country === 'Brazil',
  JSON.stringify(rioMentions.geoContext),
);
check(
  'Rio reel: the city is not counted as an ineligible NAME (it is context, not junk)',
  rioMentions.droppedIneligibleName === 0,
);

const rioRendered = renderMediaEvidenceCaption(rioReel);
check('Rio reel: the rendered caption does not lead with the city', rioRendered.title === 'Christ the Redeemer', rioRendered.title);
check('Rio reel: four places render', rioRendered.renderedPlaces === 4);
check(
  'Rio reel: the city never appears as its own rendered line',
  !rioRendered.description.split('\n').some((line) => line.startsWith('Rio de Janeiro,')),
  rioRendered.description,
);
check('Rio reel: multi-place content is never silently auto-saved', mediaEvidenceAutoSaveEligible(rioReel) === false);

// ---------------------------------------------------------------------------
// 8. A post whose ONLY place is a locality yields nothing saveable (Part 8) —
//    it may still become a manual/needs_help outcome upstream, never a save.
// ---------------------------------------------------------------------------

const cityOnly = evidence([rioCity]);
check('city-only post: no mentions', buildVenueMentions(cityOnly).mentions.length === 0);
check('city-only post: nothing renders', renderMediaEvidenceCaption(cityOnly).renderedPlaces === 0);
check('city-only post: not auto-save eligible', mediaEvidenceAutoSaveEligible(cityOnly) === false);
check(
  'city-only post: geo context is still available to the caller',
  buildVenueMentions(cityOnly).geoContext.city === 'Rio de Janeiro',
);

// ---------------------------------------------------------------------------
// 9. Mixed: one locality + one real venue with a street address. The venue must
//    still be able to auto-save; the locality must not.
// ---------------------------------------------------------------------------

const mixed = evidence(
  [
    place({
      name: 'Santa Fe Importers',
      category: 'restaurant',
      address: '1401 E 4th St',
      city: 'Long Beach',
      region: 'CA',
      country: 'USA',
      confidence: 0.95,
      explicitEvidence: [ev('visible_text', 'Santa Fe Importers 1401 E 4th St', 2)],
    }),
    place({ name: 'Long Beach', city: 'Long Beach', region: 'CA', country: 'USA', role: 'secondary' }),
  ],
  { multipleIntentionalPlaces: false },
);
const mixedMentions = buildVenueMentions(mixed);
check('mixed: only the real venue is searchable', mixedMentions.mentions.length === 1 && mixedMentions.mentions[0]!.displayName === 'Santa Fe Importers');
check('mixed: the locality is dropped as context', mixedMentions.droppedGeographicContext === 1);
check('mixed: the real venue still renders as primary', renderMediaEvidenceCaption(mixed).title === 'Santa Fe Importers');
check('mixed: the real venue remains auto-save eligible', mediaEvidenceAutoSaveEligible(mixed) === true);

// ---------------------------------------------------------------------------
// 10. End-to-end through the REAL orchestrator, with the exact provider results
//     production saw. Answers directly: can 7 Mares still enter the candidate
//     set for the city mention? It cannot, because no search is ever issued.
// ---------------------------------------------------------------------------

async function orchestratorRegression(): Promise<void> {
  // The two candidates Google actually returned for "Rio de Janeiro …".
  const rioLocality = {
    googlePlaceId: 'ChIJW6AIkVXemwARTtIvZ2xC3FA',
    name: 'Rio de Janeiro',
    types: ['locality', 'political'],
    primaryType: 'locality',
    formattedAddress: 'Rio de Janeiro, State of Rio de Janeiro, Brazil',
    latitude: -22.9068467,
    longitude: -43.1728965,
    businessStatus: 'OPERATIONAL',
  };
  const sevenMares = {
    googlePlaceId: 'ChIJbZPE_jSBmQARLoV4vUtnA7s',
    name: '7 Mares - Passeio de Lancha Rio de Janeiro',
    types: ['tour_agency', 'travel_agency', 'point_of_interest', 'service', 'establishment'],
    primaryType: 'tour_agency',
    formattedAddress: 'Av. Infante Dom Henrique, s/nº - Glória, Rio de Janeiro - RJ, 20021-140, Brazil',
    latitude: -22.9180368,
    longitude: -43.171012999999995,
    businessStatus: 'OPERATIONAL',
  };

  const queries: string[] = [];
  const deps = {
    search: async (query: string) => {
      queries.push(query);
      return { ok: true as const, results: [rioLocality, sevenMares] };
    },
    geocode: async () => ({ lat: -22.9068467, lng: -43.1728965, region: 'RJ' }),
  };

  const built = buildVenueMentions(rioReel);
  const result = await resolveVenueMentions({
    mentions: built.mentions,
    geoContext: built.geoContext,
    env: { googlePlacesKey: 'test-key' } as never,
    platform: 'instagram',
    deps: deps as never,
  });

  check(
    'orchestrator: no query is ever issued for the city',
    !queries.some((q) => /^rio de janeiro rio de janeiro/i.test(q)),
    queries.join(' | '),
  );
  check(
    'orchestrator: no mention result carries the city as its display name',
    !result.mentionResults.some((m: { displayName: string }) => m.displayName === 'Rio de Janeiro'),
  );
  check(
    'orchestrator: 7 Mares never becomes a candidate of a city mention',
    !result.mentionResults.some(
      (m: { displayName: string; candidates: Array<{ googlePlaceId: string }> }) =>
        m.displayName === 'Rio de Janeiro' &&
        m.candidates.some((c) => c.googlePlaceId === sevenMares.googlePlaceId),
    ),
  );
  check('orchestrator: the four real destinations are still searched', result.mentionResults.length === 4);

  // And the candidate-side guard is untouched: the locality entity is still
  // rejected on its own terms wherever it is scored.
  const scoredLocality = scoreMentionCandidate(rioLocality as never, built.mentions[0]! as never, {
    expectedState: null,
    bias: null,
    platform: 'instagram',
  });
  check(
    'candidate-side geographic guard is unchanged and still rejects the locality',
    scoredLocality.rejected && scoredLocality.rejectionReason === 'geographic_context_only',
  );
}

orchestratorRegression()
  .catch((err) => {
    failures += 1;
    console.log(`FAIL orchestrator regression threw - ${(err as Error)?.message}`);
  })
  .then(() => {
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
