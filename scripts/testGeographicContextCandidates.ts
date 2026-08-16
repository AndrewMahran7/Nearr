/**
 * scripts/testGeographicContextCandidates.ts
 *
 * The semantic candidate-validity boundary between WHERE a place is and WHAT
 * the place is.
 *
 * The failure class this prevents:
 *   weak place evidence -> Google Places query -> a generic locality result
 *   ("Los Angeles") -> survives candidate scoring -> is the only plausible
 *   candidate left -> silent auto-save of a city.
 *
 * The rule is driven ENTIRELY by Google's entity types, never by the words in
 * a candidate's display name. "California Pizza Kitchen" and "Central Park"
 * stay eligible; "California" and "Orange County" do not. The corpus below
 * pairs both directions on purpose so a name-based shortcut cannot pass.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testGeographicContextCandidates.ts
 */
import assert from 'node:assert/strict';

import {
  geographicContextTypeOf,
  isGeographicContextOnly,
} from '../supabase/functions/process-share-link/places/placeNormalization';
import { scoreCandidates } from '../supabase/functions/process-share-link/resolver/placeScoring';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { decisionForPlausibleCandidates } from '../supabase/functions/process-share-jobs/ambiguityReview';

type Fixture = {
  label: string;
  googlePlaceId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  primaryType?: string;
  types: string[];
  businessStatus?: string;
};

// ---------------------------------------------------------------------------
// Corpus. Type metadata mirrors what Places API (New) actually returns for
// these entity classes (`places.types` + `places.primaryType`, both already in
// PLACES_SEARCH_FIELD_MASK).
// ---------------------------------------------------------------------------

/** Geographic CONTEXT — administrative / geocoding entities. */
const CONTEXT_ONLY: Fixture[] = [
  {
    label: 'city',
    googlePlaceId: 'ctx-los-angeles',
    name: 'Los Angeles',
    formattedAddress: 'Los Angeles, CA, USA',
    latitude: 34.0549,
    longitude: -118.2426,
    primaryType: 'locality',
    types: ['locality', 'political'],
  },
  {
    label: 'county',
    googlePlaceId: 'ctx-orange-county',
    name: 'Orange County',
    formattedAddress: 'Orange County, CA, USA',
    latitude: 33.7175,
    longitude: -117.8311,
    primaryType: 'administrative_area_level_2',
    types: ['administrative_area_level_2', 'political'],
  },
  {
    label: 'state',
    googlePlaceId: 'ctx-california',
    name: 'California',
    formattedAddress: 'California, USA',
    latitude: 36.7783,
    longitude: -119.4179,
    primaryType: 'administrative_area_level_1',
    types: ['administrative_area_level_1', 'political'],
  },
  {
    label: 'country',
    googlePlaceId: 'ctx-united-states',
    name: 'United States',
    formattedAddress: 'United States',
    latitude: 37.0902,
    longitude: -95.7129,
    primaryType: 'country',
    types: ['country', 'political'],
  },
  {
    label: 'city (NYC)',
    googlePlaceId: 'ctx-new-york',
    name: 'New York',
    formattedAddress: 'New York, NY, USA',
    latitude: 40.7128,
    longitude: -74.006,
    primaryType: 'locality',
    types: ['locality', 'political'],
  },
  {
    label: 'neighborhood',
    googlePlaceId: 'ctx-venice-neighborhood',
    name: 'Venice',
    formattedAddress: 'Venice, Los Angeles, CA, USA',
    latitude: 33.985,
    longitude: -118.4695,
    primaryType: 'neighborhood',
    types: ['neighborhood', 'political'],
  },
  {
    label: 'postal code',
    googlePlaceId: 'ctx-90210',
    name: '90210',
    formattedAddress: 'Beverly Hills, CA 90210, USA',
    latitude: 34.0901,
    longitude: -118.4065,
    primaryType: 'postal_code',
    types: ['postal_code'],
  },
  {
    label: 'bare geocode row',
    googlePlaceId: 'ctx-geocode',
    name: '1202 S Garden St',
    formattedAddress: '1202 S Garden St, Columbia, TN 38401, USA',
    latitude: 35.6087,
    longitude: -87.0353,
    primaryType: 'street_address',
    types: ['street_address', 'geocode'],
  },
];

/** Real DESTINATIONS — several deliberately carry geographic names. */
const DESTINATIONS: Fixture[] = [
  {
    label: 'restaurant named after a state',
    googlePlaceId: 'dest-cpk',
    name: 'California Pizza Kitchen',
    formattedAddress: '605 N Harbor Blvd, Fullerton, CA 92832, USA',
    latitude: 33.8747,
    longitude: -117.9245,
    primaryType: 'restaurant',
    types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
  },
  {
    label: 'cafe named after a city',
    googlePlaceId: 'dest-ny-bagel',
    name: 'New York Bagel Cafe',
    formattedAddress: '1420 Bristol St N, Newport Beach, CA 92660, USA',
    latitude: 33.6605,
    longitude: -117.8752,
    primaryType: 'cafe',
    types: ['cafe', 'bakery', 'restaurant', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
  },
  {
    label: 'grill named after a city',
    googlePlaceId: 'dest-miami-grill',
    name: 'Miami Grill',
    formattedAddress: '1234 Biscayne Blvd, Miami, FL 33132, USA',
    latitude: 25.7907,
    longitude: -80.1901,
    primaryType: 'restaurant',
    types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
  },
  {
    label: 'restaurant named after a county',
    googlePlaceId: 'dest-oc-mining',
    name: 'Orange County Mining Co.',
    formattedAddress: '10402 S Loop Dr, Orange, CA 92869, USA',
    latitude: 33.7869,
    longitude: -117.7861,
    primaryType: 'restaurant',
    types: ['restaurant', 'bar', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
  },
  {
    label: 'city park',
    googlePlaceId: 'dest-central-park',
    name: 'Central Park',
    formattedAddress: 'New York, NY, USA',
    latitude: 40.7829,
    longitude: -73.9654,
    primaryType: 'park',
    types: ['park', 'tourist_attraction', 'point_of_interest', 'establishment'],
  },
  {
    label: 'national park',
    googlePlaceId: 'dest-yosemite',
    name: 'Yosemite National Park',
    formattedAddress: 'California, USA',
    latitude: 37.8651,
    longitude: -119.5383,
    primaryType: 'national_park',
    types: ['national_park', 'park', 'tourist_attraction', 'establishment', 'point_of_interest'],
  },
  {
    label: 'state park',
    googlePlaceId: 'dest-crystal-cove',
    name: 'Crystal Cove State Park',
    formattedAddress: '8471 N Coast Hwy, Laguna Beach, CA 92651, USA',
    latitude: 33.5714,
    longitude: -117.8288,
    primaryType: 'state_park',
    types: ['state_park', 'park', 'tourist_attraction', 'point_of_interest', 'establishment'],
  },
  {
    label: 'beach',
    googlePlaceId: 'dest-venice-beach',
    name: 'Venice Beach',
    formattedAddress: 'Venice Beach, Venice, CA 90291, USA',
    latitude: 33.985,
    longitude: -118.4695,
    primaryType: 'beach',
    types: ['beach', 'natural_feature', 'tourist_attraction', 'point_of_interest', 'establishment'],
  },
  {
    label: 'observatory',
    googlePlaceId: 'dest-griffith',
    name: 'Griffith Observatory',
    formattedAddress: '2800 E Observatory Rd, Los Angeles, CA 90027, USA',
    latitude: 34.1184,
    longitude: -118.3004,
    primaryType: 'observation_deck',
    types: ['observation_deck', 'tourist_attraction', 'museum', 'point_of_interest', 'establishment'],
  },
  {
    label: 'natural feature (Blue Cave — real observed types)',
    googlePlaceId: 'dest-blue-cave-me',
    name: 'Blue Cave',
    formattedAddress: 'Lustica Peninsula, Montenegro',
    latitude: 42.3944,
    longitude: 18.5678,
    types: ['natural_feature', 'tourist_attraction'],
  },
];

// ---------------------------------------------------------------------------
// 1 + 2. The classifier itself (Parts 15/16/19)
// ---------------------------------------------------------------------------
for (const fx of CONTEXT_ONLY) {
  assert.equal(
    isGeographicContextOnly(fx),
    true,
    `${fx.name} (${fx.label}) must be geographic context only`,
  );
  assert.ok(geographicContextTypeOf(fx), `${fx.name} must name the disqualifying type`);
}
for (const fx of DESTINATIONS) {
  assert.equal(
    isGeographicContextOnly(fx),
    false,
    `${fx.name} (${fx.label}) must remain a saveable destination`,
  );
  assert.equal(geographicContextTypeOf(fx), null);
}

// The decisive proof that this is TYPE semantics, not name matching: the same
// display name flips outcome purely on its Google types.
{
  const asCity = { name: 'Venice', types: ['neighborhood', 'political'] };
  const asBeach = { name: 'Venice', types: ['beach', 'natural_feature'] };
  assert.equal(isGeographicContextOnly(asCity), true);
  assert.equal(isGeographicContextOnly(asBeach), false);

  // And a candidate with NO geographic word in its name is still rejected when
  // its type is administrative.
  assert.equal(
    isGeographicContextOnly({ name: 'Springfield', types: ['locality', 'political'] }),
    true,
    'rejection does not depend on recognising a city name',
  );
}

// Unknown / absent metadata must never reject: we only act on positive
// evidence that a result is administrative.
{
  assert.equal(isGeographicContextOnly({ name: 'Somewhere' }), false);
  assert.equal(isGeographicContextOnly({ types: [] }), false);
  assert.equal(isGeographicContextOnly(null), false);
  assert.equal(isGeographicContextOnly(undefined), false);
  // A legacy-Places row with types but no primaryType still classifies.
  assert.equal(isGeographicContextOnly({ types: ['locality', 'political'] }), true);
  // primaryType alone is enough when `types` was trimmed.
  assert.equal(isGeographicContextOnly({ primaryType: 'country' }), true);
}

// ---------------------------------------------------------------------------
// 3. Eligibility, not scoring: the resolver hard-vetoes geographic candidates
// ---------------------------------------------------------------------------
const baseEvidence: any = {
  platform: 'tiktok',
  rawTitle: null,
  rawDescription: null,
  captionText: '',
  address: null,
  addresses: [],
  cityState: null,
  venueNameHints: [],
  handles: { poster: null, tagged: [] },
  isRoundup: false,
  taggedLocation: null,
  keys: ['caption_venue_hint'],
};

{
  const la = CONTEXT_ONLY[0];
  const scored = scoreCandidates([la as any], baseEvidence, 'Los Angeles', null);
  assert.equal(scored.length, 1);
  assert.equal(
    scored[0].rejected,
    true,
    'a locality is INELIGIBLE, not merely low-scoring — a penalty still lets it win by default',
  );
  assert.equal(scored[0].rejectionReason, 'geographic_context_only');
  assert.ok(scored[0].reasons.some((r) => r.startsWith('geographic_context_rejected:locality')));
  // The resolver drops rejected candidates entirely.
  assert.equal(scored.filter((s) => !s.rejected).length, 0);
}

// Case B — venue + city: the city is removed, the venue survives.
{
  const tuxedoCat = {
    googlePlaceId: 'dest-tuxedo-cat',
    name: "Tuxedo Cat's Coffee",
    formattedAddress: '1015 Nogalitos St, San Antonio, TX 78204, USA',
    latitude: 29.4,
    longitude: -98.51,
    primaryType: 'cafe',
    types: ['cafe', 'coffee_shop', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
  };
  const sanAntonio = {
    googlePlaceId: 'ctx-san-antonio',
    name: 'San Antonio',
    formattedAddress: 'San Antonio, TX, USA',
    latitude: 29.4241,
    longitude: -98.4936,
    primaryType: 'locality',
    types: ['locality', 'political'],
  };
  const evidence = { ...baseEvidence, cityState: { city: 'San Antonio', state: 'TX' } };
  const survivors = scoreCandidates(
    [tuxedoCat, sanAntonio] as any,
    evidence,
    "Tuxedo Cat's Coffee",
    null,
  ).filter((s) => !s.rejected);
  assert.equal(survivors.length, 1, 'exactly one saveable candidate remains');
  assert.equal(survivors[0].candidate.googlePlaceId, 'dest-tuxedo-cat');
}

// Case C — legitimate destination ambiguity must NOT be collapsed.
{
  const croatia = {
    ...DESTINATIONS[9],
    googlePlaceId: 'dest-blue-cave-hr',
    formattedAddress: 'Biševo, Croatia',
    latitude: 42.9833,
    longitude: 16.0167,
  };
  const survivors = scoreCandidates(
    [DESTINATIONS[9], croatia] as any,
    baseEvidence,
    'Blue Cave',
    null,
  ).filter((s) => !s.rejected);
  assert.equal(survivors.length, 2, 'two real destinations stay ambiguous -> picker');
}

// Case D/E — geographic NAMES survive the scorer untouched.
for (const fx of DESTINATIONS) {
  const survivors = scoreCandidates([fx as any], baseEvidence, fx.name, null).filter(
    (s) => !s.rejected,
  );
  assert.equal(survivors.length, 1, `${fx.name} must survive scoring`);
}

// ---------------------------------------------------------------------------
// 4. The auto-save gate: the layer where the silent save actually happened
// ---------------------------------------------------------------------------

/** Candidates as the gate receives them (post-resolver ResolvedCandidate shape). */
function gate(candidates: unknown[], evidence: Record<string, unknown> = {}) {
  return evaluateMetadataAutoSave({
    result: { decision: 'candidate_confirmation', candidates },
    evidence,
  });
}

// Case A — city-only evidence: zero saveable candidates, never an auto-save.
{
  const decision = gate([CONTEXT_ONLY[0]]);
  assert.equal(decision.plausibleCandidateCount, 0, '"Los Angeles" is not a plausible save');
  assert.equal(decision.eligible, false, 'a city must never silently auto-save');
  assert.ok(decision.candidateRejectionReasons.includes('provider_entity_not_saveable'));
  // Observability: the rejection explains itself by TYPE (Part 18).
  assert.equal(
    decision.rejectedCandidates[0].detail,
    'candidate_rejected_geographic_context:locality',
  );
  // Part 17 — the correct outcome is manual fallback, not a fabricated place.
  assert.deepEqual(decisionForPlausibleCandidates(decision.plausibleCandidateCount, false), {
    decision: 'manual_fallback',
    mode: 'manual',
    autoSave: false,
  });
}

// Every context-only entity is refused at the gate.
for (const fx of CONTEXT_ONLY) {
  const decision = gate([fx]);
  assert.equal(decision.eligible, false, `${fx.name} (${fx.label}) must not auto-save`);
  assert.equal(decision.selectedProviderId, null, `${fx.name} must never be selected`);
}

// Case B — venue + city at the gate: exactly one plausible candidate -> auto-save.
{
  const tuxedoCat = {
    googlePlaceId: 'dest-tuxedo-cat',
    name: "Tuxedo Cat's Coffee",
    formattedAddress: '1015 Nogalitos St, San Antonio, TX 78204, USA',
    latitude: 29.4,
    longitude: -98.51,
    primaryType: 'cafe',
    types: ['cafe', 'coffee_shop', 'food', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
    confidenceScore: 0.72,
    reasons: ['business_type', 'strong_name_match', 'state_match'],
  };
  const sanAntonio = {
    googlePlaceId: 'ctx-san-antonio',
    name: 'San Antonio',
    formattedAddress: 'San Antonio, TX, USA',
    latitude: 29.4241,
    longitude: -98.4936,
    primaryType: 'locality',
    types: ['locality', 'political'],
    confidenceScore: 0.2,
    reasons: [],
  };
  const decision = gate([tuxedoCat, sanAntonio]);
  assert.equal(decision.plausibleCandidateCount, 1, 'the city is context, not a second option');
  assert.equal(decision.selectedProviderId, 'dest-tuxedo-cat');
  assert.equal(decision.eligible, true, 'the exactly-one-candidate rule still auto-saves');
  assert.deepEqual(decisionForPlausibleCandidates(1, false), {
    decision: 'auto_save',
    mode: 'auto',
    autoSave: true,
  });
}

// Case D — a business whose name contains a state still auto-saves.
{
  const decision = gate([{ ...DESTINATIONS[0], confidenceScore: 0.7, reasons: ['business_type'] }]);
  assert.equal(decision.eligible, true, 'California Pizza Kitchen must auto-save');
  assert.equal(decision.selectedProviderId, 'dest-cpk');
}

// Case E — a real park still auto-saves.
{
  const decision = gate([{ ...DESTINATIONS[4], confidenceScore: 0.7, reasons: ['business_type'] }]);
  assert.equal(decision.eligible, true, 'Central Park must auto-save');
}

// Case C at the gate — two real destinations stay a picker, never auto-save.
{
  const croatia = { ...DESTINATIONS[9], googlePlaceId: 'dest-blue-cave-hr' };
  const decision = gate([DESTINATIONS[9], croatia]);
  assert.equal(decision.plausibleCandidateCount, 2);
  assert.equal(decision.eligible, false);
  assert.deepEqual(decisionForPlausibleCandidates(2, false), {
    decision: 'candidate_picker',
    mode: 'picker',
    autoSave: false,
  });
}

// Part 11 — address-driven: the business at the address survives, the city does not.
{
  const bradleyMountain = {
    googlePlaceId: 'dest-bradley-mountain',
    name: 'Bradley Mountain Wright Shop',
    formattedAddress: '1202 S Garden St, Columbia, TN 38401, USA',
    latitude: 35.6087,
    longitude: -87.0353,
    primaryType: 'store',
    types: ['store', 'point_of_interest', 'establishment'],
    businessStatus: 'OPERATIONAL',
    confidenceScore: 0.8,
    reasons: ['business_type', 'address_verified'],
  };
  const columbia = {
    googlePlaceId: 'ctx-columbia-tn',
    name: 'Columbia',
    formattedAddress: 'Columbia, TN, USA',
    latitude: 35.6151,
    longitude: -87.0353,
    primaryType: 'locality',
    types: ['locality', 'political'],
  };
  const decision = gate([bradleyMountain, columbia], {
    address: { raw: '1202 S Garden St' },
    addresses: [{ raw: '1202 S Garden St' }],
  });
  assert.equal(decision.plausibleCandidateCount, 1);
  assert.equal(decision.selectedProviderId, 'dest-bradley-mountain');
  assert.equal(decision.eligible, true, 'address-driven resolution is not weakened');
}

// Part 12 — roundup: the city never becomes candidate #6, and the real venues
// are all preserved.
{
  const venues = ['Joe’s Pizza', 'Lucali', 'Di Fara', 'Prince St. Pizza', 'Rubirosa'].map(
    (name, i) => ({
      googlePlaceId: `dest-nyc-${i}`,
      name,
      formattedAddress: `${100 + i} Somewhere St, New York, NY, USA`,
      latitude: 40.72 + i * 0.01,
      longitude: -74.0 + i * 0.01,
      primaryType: 'restaurant',
      types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
      businessStatus: 'OPERATIONAL',
    }),
  );
  const decision = gate([...venues, CONTEXT_ONLY[4]]);
  assert.equal(decision.rawCandidateCount, 6);
  assert.equal(decision.plausibleCandidateCount, 5, 'New York is excluded, the 5 venues remain');
  assert.ok(!decision.plausibleProviderIds.includes('ctx-new-york'));
  assert.equal(decision.eligible, false, '5 candidates is a picker, never an auto-save');
}

// ---------------------------------------------------------------------------
// 5. Existing production wins must not regress
// ---------------------------------------------------------------------------
{
  // The exact Santa Fe screenshot shape from testMetadataAutoSaveGate: no
  // `types` at all. Missing metadata must not start rejecting real saves.
  const santaFe = {
    googlePlaceId: 'ChIJxRuQrqwv3YARWdKYfs8FIBY',
    name: 'Santa Fe Importers Seal Beach',
    formattedAddress: '12430 Seal Beach Blvd B, Seal Beach, CA 90740, USA',
    latitude: 33.78155760000001,
    longitude: -118.0715926,
    businessStatus: 'OPERATIONAL',
    confidenceScore: 0.6063273449765341,
    reasons: ['business_type', 'meaningful_name_match', 'state_match'],
  };
  const decision = gate([santaFe], {
    isRoundup: false,
    address: { raw: '12430 Seal Beach Blvd B' },
    addresses: [{ raw: '12430 Seal Beach Blvd B' }, { raw: '1401 Santa Fe Ave' }],
  });
  assert.equal(decision.eligible, true, 'a candidate with no types is untouched by this rule');
  assert.deepEqual(decision.reasonCodes, ['single_plausible_candidate']);
}

// A resolver-labelled geographic rejection persisted from an earlier attempt
// is still honoured even if `types` were trimmed on the way in.
{
  const decision = gate([
    {
      googlePlaceId: 'ctx-persisted',
      name: 'Los Angeles',
      formattedAddress: 'Los Angeles, CA, USA',
      latitude: 34.05,
      longitude: -118.24,
      reasons: ['geographic_context_rejected:locality'],
    },
  ]);
  assert.equal(decision.eligible, false);
  assert.ok(decision.candidateRejectionReasons.includes('provider_entity_not_saveable'));
}

console.log('PASS geographic context never becomes the saved destination');
