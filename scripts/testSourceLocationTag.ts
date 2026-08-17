/**
 * scripts/testSourceLocationTag.ts
 *
 * PINNED contract for FIRST-PARTY INSTAGRAM LOCATION-TAG EVIDENCE.
 *
 * When a creator uses Instagram's built-in location feature, the public
 * (unauthenticated) post page Nearr already fetches carries a typed object in
 * its inline bootstrap JSON:
 *
 *   "location":{"__typename":"XDTLocationDict","pk":214579632,
 *               "lat":33.5226,"lng":-117.7157,"name":"Laguna Niguel, California"}
 *
 * and an untagged post carries `"location":null` in the same slot. Nearr used
 * to discard this entirely and pay a model to infer what the creator had
 * already stated. The HTML fixtures below are reduced from real responses
 * captured across 18 posts in Nearr's own corpus (14 tagged, 4 untagged).
 *
 * The invariant this file pins, in one line:
 *
 *     an explicit creator tag is a strong HYPOTHESIS about identity,
 *     never a licence to skip verification and never a destination
 *     just because it names a city
 *
 * Roughly half of the real tags name an exact business ("Pho Bamboo") and half
 * name the surrounding city ("Huntington Beach, California"). They arrive
 * identically, so the whole safety question is which is which — and getting it
 * wrong in the city direction is the Rio wrong-save (job 1e234bae), where a
 * business merely CONTAINING a city name was silently saved. That case is
 * pinned here directly.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSourceLocationTag.ts
 */

import {
  extractTaggedLocation,
  extractInstagramTaggedLocation,
} from '../supabase/functions/process-share-link/evidence/taggedLocation';
import {
  classifyTaggedLocation,
  taggedLocationBias,
} from '../supabase/functions/process-share-link/resolver/resolveSharedPlace';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import type { PlacesCandidate } from '../supabase/functions/process-share-link/places/googlePlaces';
import type { ExtractedHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A page whose media object carries the given location JSON literal. Mirrors
 *  the real shape: the tag sits beside other media fields, and an unrelated
 *  `"location":null` appears elsewhere on every page, tagged or not. */
function pageWith(locationLiteral: string): string {
  return [
    '<!DOCTYPE html><html><head><meta property="og:site_name" content="Instagram"/></head>',
    '<body><script>requireLazy(["JSONScriptTag"],function(){__d("bootstrap",[],',
    '{"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"result":{"data":',
    '{"xdt_share_sheet":{"link":"https://www.instagram.com/p/TEST/","location":null,"sharer":null}}}}}]]]},',
    '{"__bbox":{"result":{"data":{"xig_polaris_media":{"if_not_gated_logged_out":{',
    '"__isXIGPolarisMedia":"XIGPolarisVideoMedia","pk":"3196820704925117151","code":"TEST",',
    '"taken_at":1695310788,"media_type":2,"product_type":"clips","coauthor_producers":[],',
    `"location":${locationLiteral},`,
    '"clips_metadata":{"music_info":null},"like_count":45,"comment_count":10}}}}}}',
    ');});</script></body></html>',
  ].join('');
}

const TAGGED_BUSINESS = pageWith(
  '{"__typename":"XDTLocationDict","pk":968589540,"lat":33.995964313898,"lng":-117.90684767826,"name":"Pho Bamboo","profile_pic_url":null}',
);
const TAGGED_CITY = pageWith(
  '{"__typename":"XDTLocationDict","pk":214579632,"lat":33.5226,"lng":-117.7157,"name":"Laguna Niguel, California","profile_pic_url":null}',
);
const UNTAGGED = pageWith('null');

// ---------------------------------------------------------------------------
// 1. Acquisition — tagged vs untagged, from data already fetched
// ---------------------------------------------------------------------------

const business = extractInstagramTaggedLocation(TAGGED_BUSINESS);
check('business tag is recovered', !!business);
check('business tag keeps its name', business?.placeName === 'Pho Bamboo');
check(
  'business tag keeps its coordinates',
  business?.latitude === 33.995964313898 && business?.longitude === -117.90684767826,
);
check('business tag keeps Instagram location id', business?.sourceLocationId === '968589540');

const city = extractInstagramTaggedLocation(TAGGED_CITY);
check('city tag is recovered', city?.placeName === 'Laguna Niguel, California');

// The negative control. `"location":null` must not be mistaken for a tag, and
// the unrelated `"location":null` on every page must not become one either.
check('untagged post yields no tag', extractInstagramTaggedLocation(UNTAGGED) === null);
check('page with no location key at all yields no tag', extractInstagramTaggedLocation('<html></html>') === null);

// ---------------------------------------------------------------------------
// 2. Provenance survives as something more specific than "text"
// ---------------------------------------------------------------------------

check('provenance names the exact first-party feature', business?.provenance === 'instagram_location_tag');
check('source type stays tagged_location', business?.sourceType === 'tagged_location');
check('source platform stays instagram', business?.sourcePlatform === 'instagram');
check('raw page HTML is never carried on the signal', business?.rawMetadata == null);

// ---------------------------------------------------------------------------
// 3. Platform scoping — Instagram only; TikTok/YouTube unchanged
// ---------------------------------------------------------------------------

for (const platform of ['tiktok', 'youtube', 'facebook', 'snapchat', 'genericWeb'] as const) {
  check(
    `${platform} is untouched by this change`,
    extractTaggedLocation({
      platform,
      html: TAGGED_BUSINESS,
      resolvedUrl: 'https://example.com/x',
      title: null,
      description: null,
    }) === null,
  );
}
check(
  'instagram routes through the new extractor',
  extractTaggedLocation({
    platform: 'instagram',
    html: TAGGED_BUSINESS,
    resolvedUrl: 'https://www.instagram.com/p/TEST/',
    title: null,
    description: null,
  })?.placeName === 'Pho Bamboo',
);

// ---------------------------------------------------------------------------
// 4. Malformed tags fail closed — per field, never for the whole share
// ---------------------------------------------------------------------------

const malformed: Array<[string, string]> = [
  ['empty name', '{"__typename":"XDTLocationDict","pk":1,"lat":33.5,"lng":-117.7,"name":""}'],
  ['whitespace name', '{"__typename":"XDTLocationDict","pk":1,"lat":33.5,"lng":-117.7,"name":"   "}'],
  ['name of the wrong type', '{"__typename":"XDTLocationDict","pk":1,"lat":33.5,"lng":-117.7,"name":42}'],
  ['no name and no coordinates', '{"__typename":"XDTLocationDict","pk":1}'],
  ['null island', '{"__typename":"XDTLocationDict","pk":1,"lat":0,"lng":0}'],
  ['wrong typename', '{"__typename":"XDTSomethingElse","pk":1,"name":"Pho Bamboo"}'],
  ['not an object', '"XDTLocationDict"'],
];
for (const [label, literal] of malformed) {
  let threw = false;
  let result: unknown = 'unset';
  try {
    result = extractInstagramTaggedLocation(pageWith(literal));
  } catch {
    threw = true;
  }
  check(`malformed tag never throws: ${label}`, !threw);
  check(`malformed tag yields no signal: ${label}`, result === null);
}

// Markup that never closes the object costs a bounded scan and yields nothing,
// rather than running away or half-parsing.
check(
  'an unbalanced payload yields no signal',
  extractInstagramTaggedLocation(
    '<script>{"__typename":"XDTLocationDict","pk":1,"name":"Pho Bamboo"</script>',
  ) === null,
);
check(
  'a bare marker with no object yields no signal',
  extractInstagramTaggedLocation('<script>XDTLocationDict</script>') === null,
);

// A BROKEN COORDINATE PAIR must cost only the coordinates. The name is still
// the creator's explicit statement and is the more useful half.
const badCoords: Array<[string, string]> = [
  ['out of range latitude', '{"__typename":"XDTLocationDict","pk":1,"lat":91,"lng":-117.7,"name":"Pho Bamboo"}'],
  ['out of range longitude', '{"__typename":"XDTLocationDict","pk":1,"lat":33.5,"lng":181,"name":"Pho Bamboo"}'],
  ['string coordinates', '{"__typename":"XDTLocationDict","pk":1,"lat":"33.5","lng":"-117.7","name":"Pho Bamboo"}'],
  ['null coordinates', '{"__typename":"XDTLocationDict","pk":1,"lat":null,"lng":null,"name":"Pho Bamboo"}'],
  ['null island with a name', '{"__typename":"XDTLocationDict","pk":1,"lat":0,"lng":0,"name":"Pho Bamboo"}'],
];
for (const [label, literal] of badCoords) {
  const sig = extractInstagramTaggedLocation(pageWith(literal));
  check(`bad coordinates keep the name: ${label}`, sig?.placeName === 'Pho Bamboo');
  check(`bad coordinates are dropped: ${label}`, taggedLocationBias(sig) === null);
}

// A NaN literal cannot appear in JSON at all; the parse fails and the whole
// signal is dropped rather than producing a NaN bias.
check(
  'NaN coordinates cannot survive parsing',
  extractInstagramTaggedLocation(
    pageWith('{"__typename":"XDTLocationDict","pk":1,"lat":NaN,"lng":NaN,"name":"Pho Bamboo"}'),
  ) === null,
);

// ---------------------------------------------------------------------------
// 5. Granularity — the whole safety question
// ---------------------------------------------------------------------------

function candidate(name: string, types: string[], primaryType?: string): PlacesCandidate {
  return {
    googlePlaceId: `place_${name.replace(/\W+/g, '_').toLowerCase()}`,
    name,
    types,
    primaryType,
  } as PlacesCandidate;
}

const locality = (name: string) => candidate(name, ['locality', 'political']);
const country = (name: string) => candidate(name, ['country', 'political']);
const restaurant = (name: string) => candidate(name, ['restaurant', 'food'], 'restaurant');

// PART: exact business tag.
check(
  'a tagged business is an exact place',
  classifyTaggedLocation([restaurant('Girafe'), restaurant('Girafe Trattoria')], 'Girafe') === 'exact_place',
);

// PART: city/locality tag is context, not a destination.
check(
  'a tagged city is geographic context',
  classifyTaggedLocation([locality('Paris'), restaurant('Girafe')], 'Paris, France') === 'geographic_context',
);
check(
  'a tagged city with the admin suffix still matches its locality',
  classifyTaggedLocation([locality('Huntington Beach')], 'Huntington Beach, California') === 'geographic_context',
);

// PART: broad country tag.
check(
  'a tagged country is geographic context',
  classifyTaggedLocation([country('Nicaragua')], 'Nicaragua') === 'geographic_context',
);

// PART: THE RIO REGRESSION. This is the exact production shape that once
// silently saved a tour agency. A name-overlap test classifies the agency as
// "the tag" and calls it an exact place; identity matching must not.
const RIO_RESULTS = [
  locality('Rio de Janeiro'),
  candidate('7 Mares - Passeio de Lancha Rio de Janeiro', ['travel_agency'], 'travel_agency'),
];
check(
  'rio: a city tag stays geographic context even beside a business carrying its name',
  classifyTaggedLocation(RIO_RESULTS, 'Rio de Janeiro') === 'geographic_context',
);
check(
  'rio: 7 Mares can never make the tag look like an exact place',
  classifyTaggedLocation(RIO_RESULTS, 'Rio de Janeiro') !== 'exact_place',
);

// The overcorrection guard. A business whose NAME contains geography is still a
// business, and a tag naming it is still an exact place.
check(
  'a geographic-sounding business name is still an exact place',
  classifyTaggedLocation([restaurant('California Pizza Kitchen')], 'California Pizza Kitchen') === 'exact_place',
);
check(
  'a natural destination is not administrative',
  classifyTaggedLocation([candidate('Copacabana Beach', ['beach'], 'beach')], 'Copacabana Beach') === 'exact_place',
);
check(
  'an island destination is not administrative',
  classifyTaggedLocation([candidate('Ometepe Island', ['island'], 'island')], 'Ometepe Island') === 'exact_place',
);
check(
  'a mall destination is not administrative',
  classifyTaggedLocation([candidate('South Coast Plaza', ['shopping_mall'], 'shopping_mall')], 'South Coast Plaza') ===
    'exact_place',
);

// Nothing spoke for the tag -> unknown, and ordinary scoring decides.
check(
  'an unmatched tag is unknown, not silently geographic',
  classifyTaggedLocation([restaurant('Somewhere Else')], 'Pho Bamboo') === 'unknown',
);
check('an empty tag name is unknown', classifyTaggedLocation([locality('Paris')], '') === 'unknown');
check('no provider results is unknown', classifyTaggedLocation([], 'Paris, France') === 'unknown');

// ---------------------------------------------------------------------------
// 6. Coordinates as provider bias
// ---------------------------------------------------------------------------

check('valid coordinates become a bias', taggedLocationBias(business)?.lat === 33.995964313898);
check('a tagless evidence field yields no bias', taggedLocationBias(null) === null);

// ---------------------------------------------------------------------------
// 7. Absent tag behaves exactly as before
// ---------------------------------------------------------------------------

const handles: ExtractedHandles = {
  posterHandle: 'mr.les.munchies',
  taggedHandles: [],
  venueHandles: [],
  posterNameHint: null,
} as ExtractedHandles;

const caption = {
  title: 'Andrewtrung Le on Instagram',
  description: 'Brooklyn City Pizzeria & Market 30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677',
};

const withoutTag = extractEvidence({ platform: 'instagram', ...caption, handles, taggedLocation: null });
const withTag = extractEvidence({ platform: 'instagram', ...caption, handles, taggedLocation: city });

check('absent tag adds no evidence key', !withoutTag.keys.includes('tagged_location'));
check('present tag adds exactly one evidence key', withTag.keys.filter((k) => k === 'tagged_location').length === 1);
check(
  'the tag never rewrites what the caption established',
  JSON.stringify({ ...withTag, taggedLocation: null, keys: withoutTag.keys }) === JSON.stringify(withoutTag),
);
check('the caption address still wins its own extraction', withTag.address?.raw === withoutTag.address?.raw);
check('a caption address is still found beside a city tag', !!withTag.address);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
