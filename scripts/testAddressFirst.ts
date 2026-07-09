/**
 * scripts/testAddressFirst.ts
 *
 * Deterministic assertions for the address-first extraction path. These cover
 * the exact social-caption address forms called out in the address-first
 * hardening task (A–H) plus venue pairing via the caption venue-hint
 * extractor. Pure + offline — no network, no Places, no Supabase.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testAddressFirst.ts
 */

import {
  extractLikelyAddress,
  extractLikelyAddresses,
} from '../lib/shareAgent/queryCleaner';
import { extractCaptionVenueHints } from '../lib/shareAgent/recoveryHints';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';

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
// A. Capone's Cucina — tagged handle immediately before literal address.
// ---------------------------------------------------------------------------
{
  const caption =
    '@capones_cucina - 19688 Beach Blvd, Huntington Beach, California 92648';
  const a = extractLikelyAddress(caption);
  check('A1: address extracted', !!a, JSON.stringify(a));
  check('A2: street includes 19688 Beach Blvd',
    !!a && a.raw.toLowerCase().includes('19688 beach blvd'), a?.raw);
  check('A3: city Huntington Beach',
    (a?.city ?? '').toLowerCase() === 'huntington beach', a?.city ?? '');
  check('A4: state CA', a?.state === 'CA', a?.state ?? '');
  check('A5: zip 92648', a?.zip === '92648', a?.zip ?? '');

  const ev = extractEvidence({
    platform: 'instagram',
    title: caption,
    description: null,
    handles: {
      posterHandle: 'ocfeed',
      taggedHandles: ['capones_cucina'],
      venueHandles: ['capones_cucina'],
      posterNameHint: 'Ocfeed',
    },
  });
  check('A6: paired venue uses handle-derived name (Capones Cucina)',
    ev.address?.venue === 'Capones Cucina', ev.address?.venue ?? 'null');
  check('A7: paired venue is NOT Beach Blvd',
    (ev.address?.venue ?? '').toLowerCase() !== 'beach blvd', ev.address?.venue ?? 'null');
}

// ---------------------------------------------------------------------------
// B. Brooklyn City Pizzeria — venue before pin + suite + full ", CA 92677".
// ---------------------------------------------------------------------------
{
  const caption =
    '🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677';
  const a = extractLikelyAddress(caption);
  check('B1: address extracted', !!a, JSON.stringify(a));
  check('B2: street includes 30012 Crown Valley Pkwy',
    !!a && a.raw.toLowerCase().includes('30012 crown valley pkwy'), a?.raw);
  check('B3: suite preserved in raw',
    !!a && /suite\s*i/i.test(a.raw), a?.raw);
  check('B4: city Laguna Niguel',
    (a?.city ?? '').toLowerCase() === 'laguna niguel', a?.city ?? '');
  check('B5: state CA', a?.state === 'CA', a?.state ?? '');
  check('B6: zip 92677', a?.zip === '92677', a?.zip ?? '');
  const venues = extractCaptionVenueHints(caption);
  check('B7: venue paired (Brooklyn City Pizzeria)',
    venues.some((v) => v.toLowerCase().includes('brooklyn city pizzeria')),
    venues.join(' | '));

  const ev = extractEvidence({
    platform: 'instagram',
    title: caption,
    description: null,
    handles: {
      posterHandle: 'ocfeed',
      taggedHandles: [],
      venueHandles: [],
      posterNameHint: 'Ocfeed',
    },
  });
  check('B8: paired venue remains Brooklyn City Pizzeria & Market',
    (ev.address?.venue ?? '').toLowerCase().includes('brooklyn city pizzeria'),
    ev.address?.venue ?? 'null');
  check('B9: paired venue is NOT Crown Valley Pkwy',
    (ev.address?.venue ?? '').toLowerCase() !== 'crown valley pkwy', ev.address?.venue ?? 'null');
}

// ---------------------------------------------------------------------------
// C. Capo Leisure — type-first street (Paseo) + full state name "California".
// ---------------------------------------------------------------------------
{
  const caption =
    '@capoleisure - 31872 Paseo Adelanto, San Juan Capistrano, California 92675';
  const a = extractLikelyAddress(caption);
  check('C1: type-first address extracted (Paseo Adelanto)',
    !!a && a.raw.toLowerCase().includes('31872 paseo adelanto'), a?.raw);
  check('C2: city San Juan Capistrano',
    (a?.city ?? '').toLowerCase() === 'san juan capistrano', a?.city ?? '');
  check('C3: full state name normalized to CA', a?.state === 'CA', a?.state ?? '');
  check('C4: zip 92675', a?.zip === '92675', a?.zip ?? '');
}

// ---------------------------------------------------------------------------
// D. 2nd Floor — pin + venue + address on one line (no comma before city).
// ---------------------------------------------------------------------------
{
  const caption = '📍 2nd Floor\n126 Main St\nHuntington Beach, CA 92648';
  const a = extractLikelyAddress(caption);
  check('D1: address extracted (126 Main St)',
    !!a && a.raw.toLowerCase().includes('126 main st'), a?.raw);
  check('D2: city Huntington Beach',
    (a?.city ?? '').toLowerCase() === 'huntington beach', a?.city ?? '');
  check('D3: state CA', a?.state === 'CA', a?.state ?? '');
  check('D4: zip 92648', a?.zip === '92648', a?.zip ?? '');

  const ev = extractEvidence({
    platform: 'instagram',
    title: caption,
    description: null,
    handles: {
      posterHandle: 'ocfeed',
      taggedHandles: [],
      venueHandles: [],
      posterNameHint: 'Ocfeed',
    },
  });
  check('D5: paired venue is 2nd Floor',
    ev.address?.venue === '2nd Floor', ev.address?.venue ?? 'null');
  check('D6: paired venue is NOT Main St',
    (ev.address?.venue ?? '').toLowerCase() !== 'main st', ev.address?.venue ?? 'null');
}

// ---------------------------------------------------------------------------
// E. Tacos Don Goyo — multi-address with city BEFORE each address.
// ---------------------------------------------------------------------------
{
  const caption = [
    '@tacosdongoyo',
    '📍 Downey, 8502 Telegraph Rd.',
    '📍 Brea, 379 W Central Ave. Ste A',
    '📍 City of Industry, 17200 Railroad St',
  ].join('\n');
  const out = extractLikelyAddresses(caption);
  check('E1: three addresses extracted', out.length === 3,
    `got ${out.length}: ${out.map((x) => x.raw).join(' | ')}`);
  check('E2: Telegraph Rd present',
    out.some((x) => x.raw.toLowerCase().includes('8502 telegraph rd')),
    out.map((x) => x.raw).join(' | '));
  check('E3: W Central Ave + suite present',
    out.some((x) => /379 w central ave/i.test(x.raw) && /ste\s*a/i.test(x.raw)),
    out.map((x) => x.raw).join(' | '));
  check('E4: Railroad St present',
    out.some((x) => x.raw.toLowerCase().includes('17200 railroad st')),
    out.map((x) => x.raw).join(' | '));
  const cities = out.map((x) => (x.city ?? '').toLowerCase());
  check('E5: city Downey preserved', cities.includes('downey'), cities.join(' | '));
  check('E6: city Brea preserved', cities.includes('brea'), cities.join(' | '));
  check('E7: city City of Industry preserved',
    cities.includes('city of industry'), cities.join(' | '));

  const ev = extractEvidence({
    platform: 'instagram',
    title: caption,
    description: null,
    handles: {
      posterHandle: 'tacosdongoyo',
      taggedHandles: ['tacosdongoyo'],
      venueHandles: [],
      posterNameHint: 'Tacosdongoyo',
    },
  });
  check('E8: pairing does not become Telegraph Rd',
    !ev.addresses.some((x) => (x.venue ?? '').toLowerCase() === 'telegraph rd'),
    ev.addresses.map((x) => `${x.raw}=>${x.venue ?? '(null)'}`).join(' | '));
  check('E9: pairing does not become Central Ave',
    !ev.addresses.some((x) => (x.venue ?? '').toLowerCase() === 'central ave'),
    ev.addresses.map((x) => `${x.raw}=>${x.venue ?? '(null)'}`).join(' | '));
  check('E10: pairing does not become Railroad St',
    !ev.addresses.some((x) => (x.venue ?? '').toLowerCase() === 'railroad st'),
    ev.addresses.map((x) => `${x.raw}=>${x.venue ?? '(null)'}`).join(' | '));
}

// ---------------------------------------------------------------------------
// E. Suite-only line — "379 W Central Ave. Ste A".
// ---------------------------------------------------------------------------
{
  const a = extractLikelyAddress('379 W Central Ave. Ste A');
  check('E1: extracted', !!a, JSON.stringify(a));
  check('E2: street + suite preserved',
    !!a && /379 w central ave/i.test(a.raw) && /ste\s*a/i.test(a.raw), a?.raw);
}

// ---------------------------------------------------------------------------
// F. Address without ZIP — "126 Main St Huntington Beach, CA".
// ---------------------------------------------------------------------------
{
  const a = extractLikelyAddress('126 Main St Huntington Beach, CA');
  check('F1: extracted without zip', !!a, JSON.stringify(a));
  check('F2: city Huntington Beach',
    (a?.city ?? '').toLowerCase() === 'huntington beach', a?.city ?? '');
  check('F3: state CA', a?.state === 'CA', a?.state ?? '');
  check('F4: zip null', !a?.zip, a?.zip ?? 'null');
}

// ---------------------------------------------------------------------------
// G. False positive — ratings / prices are NOT addresses.
// ---------------------------------------------------------------------------
{
  const out = extractLikelyAddresses('Pizza: 8.7, service: 9/10, $20 for two');
  check('G1: no address from ratings/prices', out.length === 0,
    out.map((x) => x.raw).join(' | '));
}

// ---------------------------------------------------------------------------
// H. False positive — "Top 5 restaurants in OC" is a count, not an address.
// ---------------------------------------------------------------------------
{
  const out = extractLikelyAddresses('Top 5 restaurants in OC');
  check('H1: no address from list count', out.length === 0,
    out.map((x) => x.raw).join(' | '));
}

// ---------------------------------------------------------------------------
// I. Extra false-positive guards (phone / date / plain counts).
// ---------------------------------------------------------------------------
{
  check('I1: phone number not an address',
    extractLikelyAddresses('Call us 714 555 1212 for reservations').length === 0);
  check('I2: bare number + noun not an address',
    extractLikelyAddresses('We had 3 tacos and 2 beers').length === 0);
  check('I3: lowercase "via" prose not an address',
    extractLikelyAddresses('order 5 via fedex overnight').length === 0);
}

console.log(
  failures === 0
    ? '\nAll address-first assertions passed.'
    : `\n${failures} assertion(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
