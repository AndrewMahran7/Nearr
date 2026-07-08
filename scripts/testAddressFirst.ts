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
// A. Brooklyn City Pizzeria — venue before pin + suite + full ", CA 92677".
// ---------------------------------------------------------------------------
{
  const caption =
    '🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677';
  const a = extractLikelyAddress(caption);
  check('A1: address extracted', !!a, JSON.stringify(a));
  check('A2: street includes 30012 Crown Valley Pkwy',
    !!a && a.raw.toLowerCase().includes('30012 crown valley pkwy'), a?.raw);
  check('A3: suite preserved in raw',
    !!a && /suite\s*i/i.test(a.raw), a?.raw);
  check('A4: city Laguna Niguel',
    (a?.city ?? '').toLowerCase() === 'laguna niguel', a?.city ?? '');
  check('A5: state CA', a?.state === 'CA', a?.state ?? '');
  check('A6: zip 92677', a?.zip === '92677', a?.zip ?? '');
  const venues = extractCaptionVenueHints(caption);
  check('A7: venue paired (Brooklyn City Pizzeria)',
    venues.some((v) => v.toLowerCase().includes('brooklyn city pizzeria')),
    venues.join(' | '));
}

// ---------------------------------------------------------------------------
// B. Capo Leisure — type-first street (Paseo) + full state name "California".
// ---------------------------------------------------------------------------
{
  const caption =
    '@capoleisure - 31872 Paseo Adelanto, San Juan Capistrano, California 92675';
  const a = extractLikelyAddress(caption);
  check('B1: type-first address extracted (Paseo Adelanto)',
    !!a && a.raw.toLowerCase().includes('31872 paseo adelanto'), a?.raw);
  check('B2: city San Juan Capistrano',
    (a?.city ?? '').toLowerCase() === 'san juan capistrano', a?.city ?? '');
  check('B3: full state name normalized to CA', a?.state === 'CA', a?.state ?? '');
  check('B4: zip 92675', a?.zip === '92675', a?.zip ?? '');
}

// ---------------------------------------------------------------------------
// C. 2nd Floor — pin + venue + address on one line (no comma before city).
// ---------------------------------------------------------------------------
{
  const caption = '📍 2nd Floor 126 Main St Huntington Beach, CA 92648';
  const a = extractLikelyAddress(caption);
  check('C1: address extracted (126 Main St)',
    !!a && a.raw.toLowerCase().includes('126 main st'), a?.raw);
  check('C2: city Huntington Beach',
    (a?.city ?? '').toLowerCase() === 'huntington beach', a?.city ?? '');
  check('C3: state CA', a?.state === 'CA', a?.state ?? '');
  check('C4: zip 92648', a?.zip === '92648', a?.zip ?? '');
}

// ---------------------------------------------------------------------------
// D. Tacos Don Goyo — multi-address with city BEFORE each address.
// ---------------------------------------------------------------------------
{
  const caption = [
    '@tacosdongoyo',
    '📍 Downey, 8502 Telegraph Rd.',
    '📍 Brea, 379 W Central Ave. Ste A',
    '📍 City of Industry, 17200 Railroad St',
  ].join('\n');
  const out = extractLikelyAddresses(caption);
  check('D1: three addresses extracted', out.length === 3,
    `got ${out.length}: ${out.map((x) => x.raw).join(' | ')}`);
  check('D2: Telegraph Rd present',
    out.some((x) => x.raw.toLowerCase().includes('8502 telegraph rd')),
    out.map((x) => x.raw).join(' | '));
  check('D3: W Central Ave + suite present',
    out.some((x) => /379 w central ave/i.test(x.raw) && /ste\s*a/i.test(x.raw)),
    out.map((x) => x.raw).join(' | '));
  check('D4: Railroad St present',
    out.some((x) => x.raw.toLowerCase().includes('17200 railroad st')),
    out.map((x) => x.raw).join(' | '));
  const cities = out.map((x) => (x.city ?? '').toLowerCase());
  check('D5: city Downey preserved', cities.includes('downey'), cities.join(' | '));
  check('D6: city Brea preserved', cities.includes('brea'), cities.join(' | '));
  check('D7: city City of Industry preserved',
    cities.includes('city of industry'), cities.join(' | '));
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
