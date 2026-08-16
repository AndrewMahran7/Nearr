/**
 * scripts/testAddressVerification.ts
 *
 * Address verification: provider path + query ladder.
 *
 * Two independent defects are pinned here, both demonstrated against the live
 * Google APIs before this suite was written (read-only; no share jobs created).
 *
 *   1. PROVIDER ASYMMETRY. `verifyPlaceAtAddressServer` used to issue its own
 *      direct call to the LEGACY `maps/api/place/textsearch` endpoint, with no
 *      Places API (New) attempt and no fallback — while ordinary `searchPlaces`
 *      already ran v1-first with a legacy fallback. Address verification, the
 *      strongest evidence path in the resolver, was therefore the only part of
 *      the pipeline that hard-depended on legacy Places being enabled for the
 *      configured key. Verification now runs through `searchPlaces`, so it
 *      tolerates a key authorized for EITHER generation. Both directions are
 *      covered below.
 *
 *   2. QUERY CONSTRUCTION. The old code searched the venue name ALONE, or the
 *      address ALONE — never both. Live-verified for Brooklyn City Pizzeria:
 *        address alone -> "30012 Crown Valley Pkwy # I", [street_address,
 *                         subpremise] -> correctly rejected as an address card
 *                         -> no_business_near_address, a false negative
 *        venue+address -> "Brooklyn City Pizzeria & Market", [restaurant,
 *                         food, establishment, point_of_interest]
 *      When both evidence pieces exist they are now combined into the FIRST
 *      rung of the ladder.
 *
 * Every provider response below is a fixture shaped like the real payload —
 * no network, no key, no Supabase.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testAddressVerification.ts
 */
import assert from 'node:assert/strict';

import { verifyPlaceAtAddressServer } from '../supabase/functions/process-share-link/places/googlePlaces';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const KEY = 'test-key-not-a-secret';

// ---------------------------------------------------------------------------
// Provider stub
// ---------------------------------------------------------------------------

type V1Place = {
  id: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  types: string[];
  primaryType?: string;
};

/** Shape a fixture like a real `places:searchText` result row. */
function v1(place: V1Place) {
  return {
    id: place.id,
    displayName: { text: place.name },
    formattedAddress: place.formattedAddress,
    location: { latitude: place.lat, longitude: place.lng },
    types: place.types,
    ...(place.primaryType ? { primaryType: place.primaryType } : {}),
    businessStatus: 'OPERATIONAL',
  };
}

/** Shape a fixture like a real legacy `textsearch/json` result row. */
function legacy(place: V1Place) {
  return {
    place_id: place.id,
    name: place.name,
    formatted_address: place.formattedAddress,
    geometry: { location: { lat: place.lat, lng: place.lng } },
    types: place.types,
    business_status: 'OPERATIONAL',
  };
}

type StubPlan = {
  geocode: { formatted_address: string; lat: number; lng: number } | null;
  /** Called per text-search query; returns the response to give back. */
  onSearch: (query: string, generation: 'v1' | 'legacy') => Response;
};

/** Queries the code under test actually issued, in order. */
let issued: Array<{ query: string; generation: 'v1' | 'legacy' }> = [];

function installStub(plan: StubPlan): void {
  issued = [];
  (globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);

    if (url.includes('/maps/api/geocode/json')) {
      if (!plan.geocode) {
        return new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              formatted_address: plan.geocode.formatted_address,
              geometry: {
                location: { lat: plan.geocode.lat, lng: plan.geocode.lng },
                location_type: 'ROOFTOP',
              },
              place_id: 'geocode-place-id',
              types: ['street_address', 'premise'],
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (url.startsWith('https://places.googleapis.com/v1/places:searchText')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      issued.push({ query: body.textQuery, generation: 'v1' });
      return plan.onSearch(body.textQuery, 'v1');
    }

    if (url.includes('/maps/api/place/textsearch/json')) {
      const query = new URL(url).searchParams.get('query') ?? '';
      issued.push({ query, generation: 'legacy' });
      return plan.onSearch(query, 'legacy');
    }

    throw new Error(`unexpected fetch: ${url}`);
  };
}

const okV1 = (places: V1Place[]) =>
  new Response(JSON.stringify({ places: places.map(v1) }), { status: 200 });
const okLegacy = (places: V1Place[]) =>
  new Response(JSON.stringify({ status: places.length ? 'OK' : 'ZERO_RESULTS', results: places.map(legacy) }), {
    status: 200,
  });
const blockedV1 = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Requests to this API places.googleapis.com method google.maps.places.v1.Places.SearchText are blocked.',
        details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
      },
    }),
    { status: 403 },
  );

// Real-world anchors, from the live geocode responses.
const BROOKLYN = {
  input: '30012 Crown Valley Pkwy suite I, Laguna Niguel, CA',
  formatted: '30012 Crown Valley Pkwy # I, Laguna Niguel, CA 92677, USA',
  lat: 33.5262326,
  lng: -117.7102586,
  venue: 'Brooklyn City Pizzeria & Market',
};
const SEAL_BEACH = {
  input: '12430 Seal Beach Blvd, Seal Beach, CA',
  formatted: '12430 Seal Beach Blvd, Seal Beach, CA 90740, USA',
  lat: 33.7815708,
  lng: -118.0716182,
};
const BRADLEY = {
  input: '1202 S Garden St, Columbia, TN',
  formatted: '1202 S Garden St, Columbia, TN 38401, USA',
  lat: 35.6087,
  lng: -87.0353,
};

/** The address card the provider returns for a bare address — never a destination. */
const brooklynAddressCard: V1Place = {
  id: 'addr-brooklyn',
  name: '30012 Crown Valley Pkwy # I',
  formattedAddress: BROOKLYN.formatted,
  lat: BROOKLYN.lat,
  lng: BROOKLYN.lng,
  types: ['street_address', 'subpremise'],
};
const sealBeachAddressCard: V1Place = {
  id: 'addr-seal',
  name: '12430 Seal Beach Blvd',
  formattedAddress: SEAL_BEACH.formatted,
  lat: SEAL_BEACH.lat,
  lng: SEAL_BEACH.lng,
  types: ['premise', 'street_address'],
};
const brooklynPizzeria: V1Place = {
  id: 'place-brooklyn-pizzeria',
  name: 'Brooklyn City Pizzeria & Market',
  formattedAddress: '30012 Crown Valley Pkwy Ste l, Laguna Niguel, CA 92677, USA',
  lat: BROOKLYN.lat + 0.0001,
  lng: BROOKLYN.lng,
  types: ['restaurant', 'food', 'establishment', 'point_of_interest'],
  primaryType: 'restaurant',
};

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Brooklyn — venue + address is the FIRST query, and it resolves.
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: BROOKLYN.formatted, lat: BROOKLYN.lat, lng: BROOKLYN.lng },
      onSearch: (query) =>
        // Only the COMBINED query finds the business; the bare address returns
        // the address card, exactly as the live provider does.
        query.toLowerCase().includes('brooklyn city pizzeria')
          ? okV1([brooklynPizzeria])
          : okV1([brooklynAddressCard]),
    });
    const r = await verifyPlaceAtAddressServer(BROOKLYN.input, BROOKLYN.venue, KEY);
    check('1a: Brooklyn verified', r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('1b: Brooklyn resolved to the pizzeria, not the address card',
      r.status === 'verified' && r.candidate.name === BROOKLYN.venue,
      r.status === 'verified' ? r.candidate.name : '-');
    check('1c: strategy is venue_plus_address',
      (r as any).strategy === 'venue_plus_address', String((r as any).strategy));
    check('1d: FIRST query combined venue AND address',
      issued.length > 0 &&
        issued[0].query.includes(BROOKLYN.venue) &&
        issued[0].query.includes('30012 Crown Valley Pkwy'),
      issued[0]?.query ?? 'none');
    check('1e: used Places API (New)', issued[0]?.generation === 'v1', issued[0]?.generation ?? '-');
    check('1f: address-only rung skipped once the venue rung answered',
      issued.length === 1, JSON.stringify(issued.map((i) => i.query)));
  }

  // -------------------------------------------------------------------------
  // 2. Seal Beach — address alone yielding ONLY an address card is a real
  //    answer ("no business here"), NOT a provider fault. Retry classification
  //    depends on this distinction.
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => okV1([sealBeachAddressCard]),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('2a: address card is not a destination',
      r.status === 'failed' && (r as any).reason === 'no_business_near_address',
      `${r.status}/${(r as any).reason ?? ''}`);
    check('2b: NOT reported as provider_error',
      (r as any).reason !== 'provider_error', String((r as any).reason));
  }

  // -------------------------------------------------------------------------
  // 3. Address-only with a real business present → verified.
  // -------------------------------------------------------------------------
  {
    const cafe: V1Place = {
      id: 'place-seal-cafe',
      name: 'Seal Beach Coffee Co',
      formattedAddress: SEAL_BEACH.formatted,
      lat: SEAL_BEACH.lat,
      lng: SEAL_BEACH.lng,
      types: ['cafe', 'food', 'establishment', 'point_of_interest'],
      primaryType: 'cafe',
    };
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => okV1([sealBeachAddressCard, cafe]),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('3a: business at address verified', r.status === 'verified', r.status);
    check('3b: the business won, not the address card',
      r.status === 'verified' && r.candidate.name === 'Seal Beach Coffee Co',
      r.status === 'verified' ? r.candidate.name : '-');
    check('3c: strategy is address_only',
      (r as any).strategy === 'address_only', String((r as any).strategy));
  }

  // -------------------------------------------------------------------------
  // 4. Transient provider fault on every rung → provider_error + Retry-After.
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: BROOKLYN.formatted, lat: BROOKLYN.lat, lng: BROOKLYN.lng },
      onSearch: () => new Response('{}', { status: 503, headers: { 'retry-after': '30' } }),
    });
    const r = await verifyPlaceAtAddressServer(BROOKLYN.input, BROOKLYN.venue, KEY);
    check('4a: 5xx → provider_error',
      r.status === 'failed' && (r as any).reason === 'provider_error',
      `${r.status}/${(r as any).reason ?? ''}`);
    check('4b: Retry-After propagated for backoff',
      (r as any).retryAfterSeconds === 30, String((r as any).retryAfterSeconds));
    check('4c: no candidate fabricated', !(r as any).candidate, 'candidate present');
  }

  // -------------------------------------------------------------------------
  // 5. Rate limit → provider_error (never "nothing is there").
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => new Response('{}', { status: 429, headers: { 'retry-after': '12' } }),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('5a: 429 → provider_error', (r as any).reason === 'provider_error', String((r as any).reason));
    check('5b: 429 is not no_business_near_address',
      (r as any).reason !== 'no_business_near_address', String((r as any).reason));
  }

  // -------------------------------------------------------------------------
  // 6. THE REGRESSION THAT STARTED THIS. A key not authorized for Places API
  //    (New) must not break verification: searchPlaces falls back to legacy.
  //    Under the old code this path did not exist at all — verification only
  //    ever spoke legacy, so the mirror-image key broke it outright.
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: BROOKLYN.formatted, lat: BROOKLYN.lat, lng: BROOKLYN.lng },
      onSearch: (query, generation) => {
        if (generation === 'v1') return blockedV1();
        return query.toLowerCase().includes('brooklyn city pizzeria')
          ? okLegacy([brooklynPizzeria])
          : okLegacy([brooklynAddressCard]);
      },
    });
    const r = await verifyPlaceAtAddressServer(BROOKLYN.input, BROOKLYN.venue, KEY);
    check('6a: v1 blocked → legacy fallback still verifies',
      r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('6b: correct venue through the fallback',
      r.status === 'verified' && r.candidate.name === BROOKLYN.venue,
      r.status === 'verified' ? r.candidate.name : '-');
    check('6c: both generations were attempted',
      issued.some((i) => i.generation === 'v1') && issued.some((i) => i.generation === 'legacy'),
      JSON.stringify(issued.map((i) => i.generation)));
  }

  // -------------------------------------------------------------------------
  // 7. Deterministic config error on BOTH generations → provider_error, and
  //    nothing invented. Distinguishable from "no business here".
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: (_q, generation) =>
        generation === 'v1'
          ? blockedV1()
          : new Response(JSON.stringify({ status: 'REQUEST_DENIED' }), { status: 200 }),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('7a: both generations unavailable → provider_error',
      (r as any).reason === 'provider_error', String((r as any).reason));
    check('7b: no fabricated candidate', r.status === 'failed', r.status);
  }

  // -------------------------------------------------------------------------
  // 8. A fault on rung 1 must not bury a good answer on rung 2.
  // -------------------------------------------------------------------------
  {
    installStub({
      geocode: { formatted_address: BROOKLYN.formatted, lat: BROOKLYN.lat, lng: BROOKLYN.lng },
      onSearch: (query) =>
        query.toLowerCase().includes('brooklyn city pizzeria')
          ? new Response('{}', { status: 500 })
          : okV1([brooklynPizzeria]),
    });
    const r = await verifyPlaceAtAddressServer(BROOKLYN.input, BROOKLYN.venue, KEY);
    check('8a: rung-1 fault, rung-2 success → verified',
      r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('8b: fault did not become the reported outcome',
      (r as any).reason !== 'provider_error', String((r as any).reason));
  }

  // -------------------------------------------------------------------------
  // 9. Multiple entities at ONE address — do not blindly take result 0.
  //    The caption's venue name picks the specific business over the mall.
  // -------------------------------------------------------------------------
  {
    const plaza: V1Place = {
      id: 'place-plaza',
      name: 'Crown Valley Plaza',
      formattedAddress: BROOKLYN.formatted,
      lat: BROOKLYN.lat,
      lng: BROOKLYN.lng,
      types: ['shopping_mall', 'establishment', 'point_of_interest'],
      primaryType: 'shopping_mall',
    };
    installStub({
      geocode: { formatted_address: BROOKLYN.formatted, lat: BROOKLYN.lat, lng: BROOKLYN.lng },
      // Provider returns the mall FIRST, then the address card, then the venue.
      onSearch: () => okV1([plaza, brooklynAddressCard, brooklynPizzeria]),
    });
    const r = await verifyPlaceAtAddressServer(BROOKLYN.input, BROOKLYN.venue, KEY);
    check('9a: verified despite three entities at one address',
      r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('9b: picked the named venue, NOT result 0 (the mall)',
      r.status === 'verified' && r.candidate.name === BROOKLYN.venue,
      r.status === 'verified' ? r.candidate.name : '-');
  }

  // -------------------------------------------------------------------------
  // 10. Bradley Mountain — business survives, locality excluded by TYPE even
  //     though it sits at the same coordinate. Guards the geographic-context
  //     fix against being loosened to make address verification pass.
  // -------------------------------------------------------------------------
  {
    const bradley: V1Place = {
      id: 'place-bradley',
      name: 'Bradley Mountain',
      formattedAddress: BRADLEY.formatted,
      lat: BRADLEY.lat,
      lng: BRADLEY.lng,
      types: ['store', 'establishment', 'point_of_interest'],
      primaryType: 'store',
    };
    const columbia: V1Place = {
      id: 'place-columbia',
      name: 'Columbia',
      formattedAddress: 'Columbia, TN, USA',
      lat: BRADLEY.lat,
      lng: BRADLEY.lng,
      types: ['locality', 'political'],
      primaryType: 'locality',
    };
    const garden: V1Place = {
      id: 'place-garden-st',
      name: 'S Garden St',
      formattedAddress: 'S Garden St, Columbia, TN, USA',
      lat: BRADLEY.lat,
      lng: BRADLEY.lng,
      types: ['route'],
    };
    installStub({
      geocode: { formatted_address: BRADLEY.formatted, lat: BRADLEY.lat, lng: BRADLEY.lng },
      onSearch: () => okV1([columbia, garden, bradley]),
    });
    const r = await verifyPlaceAtAddressServer(BRADLEY.input, null, KEY);
    check('10a: exactly one plausible candidate survives',
      r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('10b: the business survived',
      r.status === 'verified' && r.candidate.name === 'Bradley Mountain',
      r.status === 'verified' ? r.candidate.name : '-');
    check('10c: locality and route excluded',
      r.status === 'verified' && r.candidate.googlePlaceId === 'place-bradley',
      r.status === 'verified' ? r.candidate.googlePlaceId : '-');
  }

  // -------------------------------------------------------------------------
  // 11. Businesses exist, but none is the named venue → name_mismatch, which
  //     is what triggers the resolver's bare-address retry. Must not silently
  //     become "verified" on some unrelated shop.
  // -------------------------------------------------------------------------
  {
    const unrelated: V1Place = {
      id: 'place-unrelated',
      name: 'Vons Pharmacy',
      formattedAddress: SEAL_BEACH.formatted,
      lat: SEAL_BEACH.lat,
      lng: SEAL_BEACH.lng,
      types: ['pharmacy', 'establishment', 'point_of_interest'],
      primaryType: 'pharmacy',
    };
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => okV1([unrelated]),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, 'Tuxedo Cats Coffee', KEY);
    check('11a: unrelated business → name_mismatch',
      r.status === 'failed' && (r as any).reason === 'name_mismatch',
      `${r.status}/${(r as any).reason ?? ''}`);
  }

  // -------------------------------------------------------------------------
  // 12. Two genuinely different businesses at one address, no venue hint →
  //     ambiguous. Multiplicity is preserved, never collapsed to one.
  // -------------------------------------------------------------------------
  {
    const a: V1Place = {
      id: 'place-a',
      name: 'Suite A Ramen',
      formattedAddress: SEAL_BEACH.formatted,
      lat: SEAL_BEACH.lat,
      lng: SEAL_BEACH.lng,
      types: ['restaurant', 'food', 'establishment'],
      primaryType: 'restaurant',
    };
    const b: V1Place = {
      id: 'place-b',
      name: 'Suite B Barbers',
      formattedAddress: SEAL_BEACH.formatted,
      lat: SEAL_BEACH.lat,
      lng: SEAL_BEACH.lng,
      types: ['beauty_salon', 'establishment'],
      primaryType: 'beauty_salon',
    };
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => okV1([a, b, sealBeachAddressCard]),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('12a: two businesses → ambiguous', r.status === 'ambiguous', r.status);
    check('12b: both preserved, address card dropped',
      r.status === 'ambiguous' && r.candidates.length === 2,
      r.status === 'ambiguous' ? String(r.candidates.length) : '-');
  }

  // -------------------------------------------------------------------------
  // 13. Geocode failure is its own reason — not a provider_error, not a
  //     no-business answer.
  // -------------------------------------------------------------------------
  {
    installStub({ geocode: null, onSearch: () => okV1([]) });
    const r = await verifyPlaceAtAddressServer('nowhere at all', null, KEY);
    check('13a: geocode_failed preserved',
      r.status === 'failed' && (r as any).reason === 'geocode_failed',
      `${r.status}/${(r as any).reason ?? ''}`);
  }

  // -------------------------------------------------------------------------
  // 14. A destination far from the geocoded point is not "at" the address.
  // -------------------------------------------------------------------------
  {
    const faraway: V1Place = {
      id: 'place-far',
      name: 'Some Other Cafe',
      formattedAddress: 'Elsewhere, CA, USA',
      lat: SEAL_BEACH.lat + 0.05, // ~5.5km
      lng: SEAL_BEACH.lng,
      types: ['cafe', 'food', 'establishment'],
      primaryType: 'cafe',
    };
    installStub({
      geocode: { formatted_address: SEAL_BEACH.formatted, lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng },
      onSearch: () => okV1([faraway]),
    });
    const r = await verifyPlaceAtAddressServer(SEAL_BEACH.input, null, KEY);
    check('14a: distant business rejected',
      r.status === 'failed' && (r as any).reason === 'no_business_near_address',
      `${r.status}/${(r as any).reason ?? ''}`);
  }

  assert.ok(failures === 0, `${failures} assertion(s) failed`);
  console.log('\nAll address-verification assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
