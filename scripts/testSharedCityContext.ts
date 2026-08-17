/**
 * scripts/testSharedCityContext.ts
 *
 * PINNED contract for SHARED CITY / REGION INHERITANCE.
 *
 * The production bug, proven experimentally before this fix existed:
 *
 *   Nicaragua reel — Granada, Ometepe, San Juan del Sur, León.
 *   Ometepe Island carries no city of its own, so it fell back to the post's
 *   aggregate city. That aggregate was the most COMMON city across siblings,
 *   which in a four-stop itinerary was `Granada` — a peer destination 63 km
 *   away. Ometepe was then searched as "Ometepe Island Granada Nicaragua" and
 *   biased to Granada's coordinates, taking a -60 distance penalty that put it
 *   under PLAUSIBLE_FLOOR.
 *
 *     with inherited Granada    score 0.3697   no_match
 *     without inherited Granada score 0.9697   verified_single
 *
 * No scoring rule was involved. The geography handed to scoring was false.
 *
 * The rule this file pins: a country may be shared loosely, because it is a
 * broad claim that is usually right. A city may only be shared when the
 * evidence says it genuinely contains the post's destinations — because a wrong
 * city does not merely fail to help, it suppresses the correct result.
 *
 * A peer city is never a container. Granada cannot contain León.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSharedCityContext.ts
 */

import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import { resolveVenueMentions } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
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
    explicitEvidence: [ev('caption', String(over.name ?? 'X'), 1)], inferredEvidence: [], ...over,
  };
}
function evidence(places: PlaceCandidateEvidence[]): MediaPlaceEvidence {
  return { places, multipleIntentionalPlaces: places.length > 1, insufficientEvidence: false, warnings: [] };
}
const geoOf = (places: PlaceCandidateEvidence[]) => buildVenueMentions(evidence(places)).geoContext;
const mentionNamed = (places: PlaceCandidateEvidence[], name: string) =>
  buildVenueMentions(evidence(places)).mentions.find((m) => m.displayName === name);

// ---------------------------------------------------------------------------
// 1. THE REGRESSION — a peer city must not become a sibling's city
// ---------------------------------------------------------------------------

const NICARAGUA = [
  place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
  place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Nicaragua' }),
  place({ name: 'San Juan del Sur', category: 'beach', city: 'San Juan del Sur', country: 'Nicaragua' }),
  place({ name: 'León', category: 'scenic_spot', city: 'León', country: 'Nicaragua' }),
];
{
  const geo = geoOf(NICARAGUA);
  check('nicaragua: no city is shared across peer destinations', geo.city === null);
  // `none`, not `conflicted`: peers are excluded from the vote outright, so the
  // post made no container claim at all. `conflicted` is reserved for real
  // competing claims — see the two-cities-one-region case below, which does
  // report it. The distinction matters to an audit reading these codes.
  check('nicaragua: recorded as no container claim at all', geo.cityStrength === 'none');
  check('nicaragua: Granada never becomes the post city', geo.city !== 'Granada');

  // Task A must survive intact — this fix is about city, not country.
  check('nicaragua: shared country is still Nicaragua', geo.country === 'Nicaragua');
  check('nicaragua: shared country is still STRONG', geo.countryStrength === 'strong');

  // Ometepe keeps its country and gains no city.
  const ometepe = mentionNamed(NICARAGUA, 'Ometepe Island')!;
  check('nicaragua: Ometepe has no city of its own', ometepe.geo.city === null);
  check('nicaragua: Ometepe keeps Nicaragua', ometepe.geo.country === 'Nicaragua');

  // The peers keep their own identity — this must not have cost them anything.
  for (const name of ['Granada', 'San Juan del Sur', 'León']) {
    const m = mentionNamed(NICARAGUA, name)!;
    check(`nicaragua: ${name} keeps its own city identity`, m.geo.city === name);
    check(`nicaragua: ${name} still resolves geographically`, m.resolutionMode === 'geographic');
  }
  check(
    'nicaragua: all four destinations survive',
    buildVenueMentions(evidence(NICARAGUA)).mentions.length === 4,
  );
}

// A two-stop itinerary is the same bug in miniature: one peer with a city,
// one sibling without. The single assert must stay weak.
{
  const geo = geoOf([
    place({ name: 'Ometepe Island', category: 'island', country: 'Nicaragua' }),
    place({ name: 'Granada', category: 'scenic_spot', city: 'Granada', country: 'Nicaragua' }),
  ]);
  check('two-stop: a lone peer city is not inheritable', geo.city === null);
}

// ---------------------------------------------------------------------------
// 2. CONTAINER CITY — sharing is correct here and must be preserved
// ---------------------------------------------------------------------------

const PARIS_VENUES = [
  place({ name: 'Girafe', category: 'restaurant', city: 'Paris', country: 'France' }),
  place({ name: 'Louvre Museum', category: 'museum', city: 'Paris', country: 'France' }),
  place({ name: 'Eiffel Tower', category: 'attraction', city: 'Paris', country: 'France' }),
];
{
  const geo = geoOf(PARIS_VENUES);
  check('paris: an agreed city IS shared', geo.city === 'Paris');
  check('paris: recorded as strong', geo.cityStrength === 'strong');
  check('paris: source is independent agreement', geo.citySource === 'multiple_places_agree');
}

// Rio: the city is NAMED by the post and the landmarks sit inside it. Rio is a
// redundant container, so it may scope — and must still never be a destination.
const RIO = [
  place({ name: 'Rio de Janeiro', category: 'scenic_spot', city: 'Rio de Janeiro', region: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Copacabana Beach', category: 'beach', city: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Christ the Redeemer', category: 'attraction', city: 'Rio de Janeiro', country: 'Brazil' }),
  place({ name: 'Sugarloaf Mountain', category: 'attraction', city: 'Rio de Janeiro', country: 'Brazil' }),
];
{
  const built = buildVenueMentions(evidence(RIO));
  check('rio: the container city still scopes its landmarks', built.geoContext.city === 'Rio de Janeiro');
  check('rio: recorded as strong', built.geoContext.cityStrength === 'strong');
  check('rio: attributed to the container', built.geoContext.citySource === 'redundant_container');
  check('rio: the city itself is suppressed as a destination', built.droppedGeographicContext === 1);
  check(
    'rio: Rio is not offered as a peer destination',
    built.peerGeographicDestinations === 0 && !built.mentions.some((m) => m.displayName === 'Rio de Janeiro'),
  );
  check(
    'rio: the three landmarks survive',
    ['Copacabana Beach', 'Christ the Redeemer', 'Sugarloaf Mountain'].every((n) =>
      built.mentions.some((m) => m.displayName === n)),
  );
}

// Tokyo: a city container plus siblings that each report it.
{
  const geo = geoOf([
    place({ name: 'Cafe Kitsune', category: 'cafe', city: 'Tokyo', country: 'Japan' }),
    place({ name: 'Onibus Coffee', category: 'cafe', city: 'Tokyo', country: 'Japan' }),
    place({ name: 'Fuglen Asakusa', category: 'cafe', city: 'Tokyo', country: 'Japan' }),
  ]);
  check('tokyo: a single-city roundup shares its city', geo.city === 'Tokyo' && geo.cityStrength === 'strong');
}

// ---------------------------------------------------------------------------
// 3. WEAK / SINGLE-PEER — the conservative direction
// ---------------------------------------------------------------------------

{
  const geo = geoOf([
    place({ name: 'Republique', category: 'restaurant', city: 'Los Angeles', country: 'USA' }),
    place({ name: 'Sightglass', category: 'cafe', country: 'USA' }),
  ]);
  check('weak: one quiet city is not propagated', geo.city === null);
  check('weak: it is recorded as weak, not absent', geo.cityStrength === 'weak');
  check('weak: country context is unaffected', geo.country === 'USA');
}

// ---------------------------------------------------------------------------
// 4. MULTI-COUNTRY ITINERARY — nothing collapses
// ---------------------------------------------------------------------------

{
  const geo = geoOf([
    place({ name: 'Paris', category: 'scenic_spot', city: 'Paris', country: 'France' }),
    place({ name: 'London', category: 'scenic_spot', city: 'London', country: 'United Kingdom' }),
    place({ name: 'Amsterdam', category: 'scenic_spot', city: 'Amsterdam', country: 'Netherlands' }),
  ]);
  check('multi-country: no shared city', geo.city === null);
  check('multi-country: no shared country either', geo.country === null && geo.countryStrength === 'conflicted');
}

// ---------------------------------------------------------------------------
// 5. MENTION-SPECIFIC CONTEXT ALWAYS WINS
// ---------------------------------------------------------------------------

{
  const places = [
    place({ name: 'Girafe', category: 'restaurant', city: 'Paris', country: 'France' }),
    place({ name: 'Louvre Museum', category: 'museum', city: 'Paris', country: 'France' }),
    place({ name: 'Peppermill', category: 'restaurant', city: 'Las Vegas', country: 'USA' }),
  ];
  const built = buildVenueMentions(evidence(places));
  const vegas = built.mentions.find((m) => m.displayName === 'Peppermill')!;
  check('override: the mention keeps its own city', vegas.geo.city === 'Las Vegas');
  check('override: and its own country', vegas.geo.country === 'USA');
  check('override: the post has no single shared city to force', built.geoContext.city === null);
}

// ---------------------------------------------------------------------------
// 6. REGION — same agreement rule, but peers are NOT excluded
// ---------------------------------------------------------------------------

{
  const agreed = geoOf([
    place({ name: 'Santa Fe Importers', category: 'restaurant', city: 'Long Beach', region: 'California', country: 'USA' }),
    place({ name: 'Loaded Cafe', category: 'restaurant', city: 'Seal Beach', region: 'California', country: 'USA' }),
  ]);
  check('region: an agreed region IS shared', agreed.region === 'California');
  check('region: recorded as strong', agreed.regionStrength === 'strong');
  check('region: two different cities still share no city', agreed.city === null && agreed.cityStrength === 'conflicted');

  // Peer CITIES in the same state legitimately share that state — a region
  // really does contain several peer cities, which is why peers are counted
  // here and excluded from the city vote.
  const peersOneState = geoOf([
    place({ name: 'Santa Fe', category: 'scenic_spot', city: 'Santa Fe', region: 'New Mexico', country: 'USA' }),
    place({ name: 'Taos', category: 'scenic_spot', city: 'Taos', region: 'New Mexico', country: 'USA' }),
  ]);
  check('region: peer cities in one state still share the state', peersOneState.region === 'New Mexico');
  check('region: but never each other\'s city', peersOneState.city === null);

  const conflicting = geoOf([
    place({ name: 'Brooklyn City Pizzeria', category: 'restaurant', region: 'California', country: 'USA' }),
    place({ name: 'Roberta\'s', category: 'restaurant', region: 'New York', country: 'USA' }),
  ]);
  check('region: conflicting regions share nothing', conflicting.region === null && conflicting.regionStrength === 'conflicted');

  const lone = geoOf([
    place({ name: 'Republique', category: 'restaurant', region: 'California', country: 'USA' }),
    place({ name: 'Sightglass', category: 'cafe', country: 'USA' }),
  ]);
  check('region: a lone region is weak, not propagated', lone.region === null && lone.regionStrength === 'weak');
}

// ---------------------------------------------------------------------------
// 7. GENERALITY — the rule is about provenance, not about Ometepe
// ---------------------------------------------------------------------------

{
  // Island + cities, different country, no Nicaragua vocabulary involved.
  const greece = geoOf([
    place({ name: 'Navagio Beach', category: 'beach', country: 'Greece' }),
    place({ name: 'Athens', category: 'scenic_spot', city: 'Athens', country: 'Greece' }),
    place({ name: 'Thessaloniki', category: 'scenic_spot', city: 'Thessaloniki', country: 'Greece' }),
  ]);
  check('general: a beach does not inherit a peer city', greece.city === null);
  check('general: the shared country still holds', greece.country === 'Greece' && greece.countryStrength === 'strong');

  // Landmarks with no city of their own, inside an agreed container.
  const bangkok = geoOf([
    place({ name: 'Bangkok', category: 'scenic_spot', city: 'Bangkok', country: 'Thailand' }),
    place({ name: 'Wat Arun', category: 'attraction', city: 'Bangkok', country: 'Thailand' }),
    place({ name: 'Chatuchak Market', category: 'attraction', country: 'Thailand' }),
  ]);
  check('general: an agreed container still scopes a city-less landmark', bangkok.city === 'Bangkok');
  check('general: recorded as container-sourced', bangkok.citySource === 'redundant_container');
}

// ---------------------------------------------------------------------------
// 8. Empty / degenerate input never throws
// ---------------------------------------------------------------------------

{
  let threw = false;
  try {
    geoOf([]);
    geoOf([place({ name: 'Solo', category: 'restaurant' })]);
    geoOf([place({ name: 'Blank', city: '   ', region: '  ', country: '  ' })]);
  } catch { threw = true; }
  check('degenerate: empty and blank geo never throw', !threw);
  check('degenerate: blank strings are not treated as a city', geoOf([place({ name: 'Blank', city: '   ' })]).city === null);
}

// ---------------------------------------------------------------------------
// 9. THE ACTUAL CONSUMERS — query text and coordinate bias
//
// The two places the contaminated city was spent. Asserted through the real
// resolver with a mocked provider, so this pins the end the user feels rather
// than only the context object.
// ---------------------------------------------------------------------------

async function assertConsumers(): Promise<void> {
  async function queriesFor(places: PlaceCandidateEvidence[]) {
    const built = buildVenueMentions(evidence(places));
    const queries: string[] = [];
    let geocoded: string | null = null;
    await resolveVenueMentions({
      mentions: built.mentions,
      geoContext: built.geoContext,
      env: { googlePlacesKey: 'k' } as never,
      platform: 'instagram',
      deps: {
        search: async (q: string) => { queries.push(q); return { ok: true as const, results: [] }; },
        geocode: async (t: string) => { geocoded = t; return { lat: 11.93, lng: -85.95 }; },
      } as never,
    });
    return { queries, geocoded };
  }

  const nica = await queriesFor(NICARAGUA);
  const ometepeQuery = nica.queries.find((q) => /ometepe/i.test(q))!;
  check('consumer: Ometepe is no longer searched inside Granada', !/granada/i.test(ometepeQuery), ometepeQuery);
  check('consumer: Ometepe keeps its country scope', /nicaragua/i.test(ometepeQuery), ometepeQuery);
  check(
    'consumer: no coordinate bias is geocoded from a peer city',
    nica.geocoded === null,
    String(nica.geocoded),
  );
  check(
    'consumer: each peer city is still searched as itself',
    ['granada', 'le', 'san juan'].every((frag) =>
      nica.queries.some((q) => q.toLowerCase().includes(frag))),
    nica.queries.join(' | '),
  );
  // A wrong bias is worse than none — but a RIGHT one must still be taken.
  const paris = await queriesFor(PARIS_VENUES);
  check(
    'consumer: an agreed container city still scopes its siblings',
    paris.queries.every((q) => /paris/i.test(q)),
    paris.queries.join(' | '),
  );
  check('consumer: and still supplies a coordinate bias', typeof paris.geocoded === 'string');
}

assertConsumers()
  .catch((err) => { failures += 1; console.log(`FAIL consumer assertions threw - ${(err as Error).message}`); })
  .then(() => {
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
