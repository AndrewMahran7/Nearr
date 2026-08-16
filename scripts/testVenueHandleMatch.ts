/**
 * scripts/testVenueHandleMatch.ts
 *
 * Tagged-venue-handle identity matching.
 *
 * A social handle is the same identity written in a different alphabet:
 * separators removed, casing flattened, and sometimes a founding year appended
 * — while the provider appends a BRANCH to the business name:
 *
 *   @santafeimporters1947   <->   Santa Fe Importers Seal Beach
 *
 * `hasStrongNameMatch` correctly rejects that. It is token-overlap based, and
 * the compact handle is one token matching none of the candidate's. Loosening
 * it would also equate "Santa Fe Foodies" with "Santa Fe Importers", so the
 * handle rule is separate, applies ONLY to evidence already classified as a
 * tagged venue handle, and is only reachable inside address verification —
 * where every candidate is already within ADDRESS_VERIFY_RADIUS_M of the
 * geocoded street address.
 *
 * Half of this file is negative cases on purpose: the risk of a handle-aware
 * rule is false positives, not false negatives.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testVenueHandleMatch.ts
 */
import assert from 'node:assert/strict';

import {
  hasStrongVenueHandleMatch,
  hasStrongNameMatch,
} from '../supabase/functions/process-share-link/places/placeNormalization';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
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

// ---------------------------------------------------------------------------
// 1. The mandatory positive case.
// ---------------------------------------------------------------------------
{
  const r = hasStrongVenueHandleMatch('Santa Fe Importers Seal Beach', 'santafeimporters1947');
  check('1a: Santa Fe handle matches the provider business name', r.matched, JSON.stringify(r));
  check('1b: reason names the ignored year',
    r.reasons.includes('trailing_year_suffix_ignored'), r.reasons.join(','));
  check('1c: reason names the brand-stem prefix',
    r.reasons.includes('handle_brand_stem_matches_candidate_prefix'), r.reasons.join(','));
  check('1d: reason names the ignored branch suffix',
    r.reasons.includes('candidate_branch_suffix_ignored'), r.reasons.join(','));
  // The premise of the whole task: the generic matcher must still say no, so
  // we can be sure nothing generic was loosened.
  check('1e: generic matcher still rejects this pair (unchanged)',
    !hasStrongNameMatch('Santa Fe Importers Seal Beach', 'Santafeimporters1947'),
    'generic matcher changed behavior');
  check('1f: @ prefix tolerated',
    hasStrongVenueHandleMatch('Santa Fe Importers Seal Beach', '@santafeimporters1947').matched);
  check('1g: also matches the unbranched name',
    hasStrongVenueHandleMatch('Santa Fe Importers', 'santafeimporters1947').matched);
}

// ---------------------------------------------------------------------------
// 2. Mandatory negatives — the handle rule must not become a similarity vibe.
// ---------------------------------------------------------------------------
{
  const negatives: Array<[string, string, string]> = [
    // Creator handle vs the venue it filmed.
    ['ocfoodandview', 'Santa Fe Importers Seal Beach', 'creator handle'],
    ['ocfoodandview', 'Santa Fe Importers', 'creator handle, unbranched'],
    // Shares "Santa Fe" but is a different business.
    ['santafefoodies', 'Santa Fe Importers', 'related geographic words'],
    ['santafefoodies', 'Santa Fe Importers Seal Beach', 'related words + branch'],
    // Category/locality handle that merely overlaps the branch suffix.
    ['sealbeacheats', 'Santa Fe Importers Seal Beach', 'generic category handle'],
    // Platform self-reference (also filtered upstream; belt and braces).
    ['instagram', 'Santa Fe Importers Seal Beach', 'platform noise'],
    ['tiktok', 'Santa Fe Importers Seal Beach', 'platform noise'],
    // Similar but distinct brands sharing leading tokens.
    ['santafeimporters1947', 'Santa Fe Brewing Company', 'shared leading token only'],
    ['brooklyncitypizzeria', 'Brooklyn Bagel Company', 'shared first token'],
    // A single generic leading token must never claim a brand.
    ['starbucks', 'Starbucks Reserve Roastery', 'one-token brand prefix'],
    ['santafe', 'Santa Fe Importers', 'stem too short for a partial match'],
    // Partial-word prefixes are structurally impossible.
    ['santafeimport', 'Santa Fe Importers Seal Beach', 'mid-token prefix'],
    ['santafeimporterss', 'Santa Fe Importers', 'overshoots the token boundary'],
    // Reverse containment must not match.
    ['santafeimporterssealbeachdeli', 'Santa Fe Importers', 'handle longer than name'],
  ];
  for (const [handle, candidate, label] of negatives) {
    const r = hasStrongVenueHandleMatch(candidate, handle);
    check(`2-${label}: @${handle} !~ "${candidate}"`, !r.matched, JSON.stringify(r));
  }
}

// ---------------------------------------------------------------------------
// 3. Numeric brands. The year rule must not become "digits are noise".
// ---------------------------------------------------------------------------
{
  // Full-coverage matches: numbers are part of the identity and are kept.
  const numericPositives: Array<[string, string]> = [
    ['studio54', 'Studio 54'],
    ['7eleven', '7-Eleven'],
    ['area15', 'Area 15'],
    ['district7', 'District 7'],
    ['85cbakery', '85C Bakery'],
  ];
  for (const [handle, candidate] of numericPositives) {
    const r = hasStrongVenueHandleMatch(candidate, handle);
    check(`3a-${handle}: matches "${candidate}" with digits intact`, r.matched, JSON.stringify(r));
    check(`3b-${handle}: matched as a full name, no year stripped`,
      r.reasons.includes('handle_spells_full_candidate_name') &&
        !r.reasons.includes('trailing_year_suffix_ignored'),
      r.reasons.join(','));
  }
  // Digits are NOT globally stripped: a numeric brand must not collapse onto
  // its bare word and swallow a different business.
  check('3c: @studio54 does not match "Studio"',
    !hasStrongVenueHandleMatch('Studio', 'studio54').matched);
  check('3d: @studio54 does not match "Studio Ghibli Museum"',
    !hasStrongVenueHandleMatch('Studio Ghibli Museum', 'studio54').matched);
  check('3e: @area15 does not match "Area 51 Diner"',
    !hasStrongVenueHandleMatch('Area 51 Diner', 'area15').matched);
  check('3f: @7eleven does not match "7 Leaves Cafe"',
    !hasStrongVenueHandleMatch('7 Leaves Cafe', '7eleven').matched);
  // Only a plausible FOUNDING YEAR is ignorable, and only trailing.
  check('3g: trailing 2-digit suffix is not treated as a year',
    !hasStrongVenueHandleMatch('Santa Fe Importers', 'santafeimporters47').matched);
  check('3h: non-year 4-digit suffix is not stripped',
    !hasStrongVenueHandleMatch('Santa Fe Importers', 'santafeimporters4321').matched);
  check('3i: 2026 (year-like) is stripped',
    hasStrongVenueHandleMatch('Santa Fe Importers', 'santafeimporters2026').matched);
  check('3j: internal digits are never stripped',
    !hasStrongVenueHandleMatch('Santa Fe Importers', 'santafe1947importers').matched);
}

// ---------------------------------------------------------------------------
// 4. Full-coverage acceptance keeps ordinary handles working.
// ---------------------------------------------------------------------------
{
  check('4a: exact compact spelling matches',
    hasStrongVenueHandleMatch('Loaded Cafe', 'loadedcafe').matched);
  check('4b: underscores/dots are separators',
    hasStrongVenueHandleMatch('Capones Cucina', 'capones_cucina').matched);
  check('4c: accents fold',
    hasStrongVenueHandleMatch('Café Habana', 'cafehabana').matched);
  check('4d: empty inputs are never a match',
    !hasStrongVenueHandleMatch('', 'x').matched && !hasStrongVenueHandleMatch('X', '').matched);
}

// ---------------------------------------------------------------------------
// 5. Provenance plumbing: extractEvidence must label a handle-derived venue.
// ---------------------------------------------------------------------------
const SANTA_FE_CAPTION =
  'This classic Italian deli has been around since 1947! @santafeimporters1947 ' +
  'with locations in Long Beach and Seal Beach\n12430 Seal Beach Blvd, Seal Beach, CA';

function santaFeEvidence() {
  const handles = extractHandles({
    platform: 'instagram',
    title: 'Video by ocfoodandview',
    description: SANTA_FE_CAPTION,
    html: null,
    knownPosterHandle: 'ocfoodandview',
  });
  return extractEvidence({
    platform: 'instagram',
    title: null,
    description: SANTA_FE_CAPTION,
    handles,
    taggedLocation: null,
  });
}
{
  const ev = santaFeEvidence();
  check('5a: venue_handle_tagged present', ev.keys.includes('venue_handle_tagged'), ev.keys.join(','));
  check('5b: address extracted',
    !!ev.address && /12430 seal beach blvd/i.test(ev.address.raw), ev.address?.raw ?? 'none');
  check('5c: paired venue is handle-derived',
    ev.address?.venueSource === 'tagged_venue_handle', String(ev.address?.venueSource));
  check('5d: hint recorded as handle-derived',
    ev.venueNameHintsFromHandle.length > 0, ev.venueNameHintsFromHandle.join(','));
  check('5e: creator never becomes the venue',
    !/ocfoodandview/i.test(ev.address?.venue ?? ''), ev.address?.venue ?? 'null');
}
{
  // Brooklyn: human-readable caption prose must stay caption_text so it keeps
  // using the ordinary matcher.
  // Verbatim from the existing address-first fixture (scripts/testAddressFirst.ts).
  const caption =
    '🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677';
  const ev = extractEvidence({
    platform: 'instagram',
    title: null,
    description: caption,
    handles: { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null },
    taggedLocation: null,
  });
  check('5f: Brooklyn venue is caption prose, not handle-derived',
    ev.address?.venueSource !== 'tagged_venue_handle', String(ev.address?.venueSource));
  check('5g: Brooklyn venue paired',
    /brooklyn city pizzeria/i.test(ev.address?.venue ?? ''), ev.address?.venue ?? 'null');
}

// ---------------------------------------------------------------------------
// 6. End-to-end through the real verifier with a stubbed provider.
// ---------------------------------------------------------------------------
const SEAL_BEACH = {
  formatted: '12430 Seal Beach Blvd, Seal Beach, CA 90740, USA',
  lat: 33.7815708,
  lng: -118.0716182,
};
function installProvider(places: any[]): { queries: string[] } {
  const queries: string[] = [];
  (globalThis as any).fetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url.includes('/maps/api/geocode/json')) {
      return new Response(JSON.stringify({
        status: 'OK',
        results: [{
          formatted_address: SEAL_BEACH.formatted,
          geometry: { location: { lat: SEAL_BEACH.lat, lng: SEAL_BEACH.lng }, location_type: 'ROOFTOP' },
          place_id: 'g', types: ['premise'],
        }],
      }), { status: 200 });
    }
    if (url.startsWith('https://places.googleapis.com/v1/places:searchText')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      queries.push(body.textQuery);
      return new Response(JSON.stringify({ places }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { queries };
}
/** The real tenants at 12430 Seal Beach Blvd (multi-tenant center). */
const TENANTS = [
  { id: 'ChIJxRuQrqwv3YARWdKYfs8FIBY', name: 'Santa Fe Importers Seal Beach', type: 'restaurant' },
  { id: 'kebab', name: 'The Kebab Shop', type: 'restaurant' },
  { id: 'eggbred', name: 'Eggbred', type: 'restaurant' },
].map((t) => ({
  id: t.id,
  displayName: { text: t.name },
  formattedAddress: SEAL_BEACH.formatted,
  location: { latitude: SEAL_BEACH.lat, longitude: SEAL_BEACH.lng },
  types: [t.type, 'food', 'establishment', 'point_of_interest'],
  primaryType: t.type,
  businessStatus: 'OPERATIONAL',
}));

async function main(): Promise<void> {
  // 6a. Handle-derived name + address → verified via venue_plus_address.
  {
    const { queries } = installProvider(TENANTS);
    const ev = santaFeEvidence();
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      ev.address!.venue!,
      'k',
      ev.address!.venueSource!,
    );
    check('6a: verified', r.status === 'verified', `${r.status}/${(r as any).reason ?? ''}`);
    check('6b: strategy is venue_plus_address',
      (r as any).strategy === 'venue_plus_address', String((r as any).strategy));
    check('6c: picked Santa Fe Importers out of three tenants',
      r.status === 'verified' && r.candidate.googlePlaceId === 'ChIJxRuQrqwv3YARWdKYfs8FIBY',
      r.status === 'verified' ? r.candidate.name : '-');
    check('6d: only one provider query needed (no bare retry)',
      queries.length === 1, JSON.stringify(queries));
  }
  // 6e. SAME evidence, but labelled caption prose → still name_mismatch.
  //     Proves the win comes from provenance, not from a weakened matcher.
  {
    installProvider(TENANTS);
    const ev = santaFeEvidence();
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      ev.address!.venue!,
      'k',
      'caption_text',
    );
    check('6e: without handle provenance it is still a name mismatch',
      r.status === 'failed' && (r as any).reason === 'name_mismatch',
      `${r.status}/${(r as any).reason ?? ''}`);
  }
  // 6f. Creator handle must not verify against a tenant.
  {
    installProvider(TENANTS);
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      'Ocfoodandview',
      'k',
      'tagged_venue_handle',
    );
    check('6f: creator handle does not verify',
      r.status === 'failed' && (r as any).reason === 'name_mismatch',
      `${r.status}/${(r as any).reason ?? ''}`);
  }
  // 6g. ADDRESS-ONLY at a multi-tenant address still refuses to guess.
  {
    installProvider(TENANTS);
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      null,
      'k',
    );
    check('6g: address-only stays ambiguous, never a silent pick',
      r.status === 'ambiguous', `${r.status}/${(r as any).reason ?? ''}`);
    check('6h: all three tenants preserved',
      r.status === 'ambiguous' && r.candidates.length === 3,
      r.status === 'ambiguous' ? String(r.candidates.length) : '-');
  }
  // 6i. A handle that matches NOTHING at the address does not fabricate.
  {
    installProvider(TENANTS);
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      'Sealbeacheats',
      'k',
      'tagged_venue_handle',
    );
    check('6i: unrelated handle → name_mismatch, no candidate invented',
      r.status === 'failed' && (r as any).reason === 'name_mismatch',
      `${r.status}/${(r as any).reason ?? ''}`);
  }
  // 6j. Brooklyn keeps working through the ORDINARY matcher.
  {
    const brooklyn = [{
      id: 'ChIJmTMMbfBUUCERzikg7fC87Aw',
      displayName: { text: 'Brooklyn City Pizzeria & Market' },
      formattedAddress: '30012 Crown Valley Pkwy Ste l, Laguna Niguel, CA 92677, USA',
      location: { latitude: SEAL_BEACH.lat, longitude: SEAL_BEACH.lng },
      types: ['restaurant', 'food', 'establishment'],
      primaryType: 'restaurant',
      businessStatus: 'OPERATIONAL',
    }];
    installProvider(brooklyn);
    const r = await verifyPlaceAtAddressServer(
      '30012 Crown Valley Pkwy suite I, Laguna Niguel, CA',
      'Brooklyn City Pizzeria & Market',
      'k',
      'caption_text',
    );
    check('6j: Brooklyn verified via ordinary name matching',
      r.status === 'verified' && (r as any).strategy === 'venue_plus_address',
      `${r.status}/${(r as any).strategy}`);
    check('6k: Brooklyn candidate unchanged',
      r.status === 'verified' && r.candidate.googlePlaceId === 'ChIJmTMMbfBUUCERzikg7fC87Aw',
      r.status === 'verified' ? r.candidate.googlePlaceId : '-');
  }
  // 6l. Conflict: handle indicates one business, a DIFFERENT tenant also
  //     handle-matches → ambiguous, never a silent pick.
  {
    const twoBrands = [
      ...TENANTS,
      {
        id: 'sfi-deli',
        displayName: { text: 'Santa Fe Importers Deli Counter' },
        formattedAddress: SEAL_BEACH.formatted,
        location: { latitude: SEAL_BEACH.lat, longitude: SEAL_BEACH.lng },
        types: ['restaurant', 'food', 'establishment'],
        primaryType: 'restaurant',
        businessStatus: 'OPERATIONAL',
      },
    ];
    installProvider(twoBrands);
    const r = await verifyPlaceAtAddressServer(
      '12430 Seal Beach Blvd, Seal Beach, CA',
      'Santafeimporters1947',
      'k',
      'tagged_venue_handle',
    );
    check('6l: two handle-compatible tenants → ambiguous, not auto-picked',
      r.status === 'ambiguous', `${r.status}/${(r as any).reason ?? ''}`);
  }

  // -------------------------------------------------------------------------
  // 7. Multi-place: several venue handles stay several.
  // -------------------------------------------------------------------------
  {
    const caption = '5 spots: @venueaaa @venuebbb @venueccc';
    const handles = extractHandles({
      platform: 'instagram',
      title: null,
      description: caption,
      html: null,
      knownPosterHandle: 'atlbucketlist',
    });
    check('7a: three venue handles retained',
      handles.venueHandles.length === 3, handles.venueHandles.join(','));
    check('7b: creator excluded',
      !handles.venueHandles.includes('atlbucketlist'), handles.venueHandles.join(','));
  }

  assert.ok(failures === 0, `${failures} assertion(s) failed`);
  console.log('\nAll venue-handle-match assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
