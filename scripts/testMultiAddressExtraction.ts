/**
 * scripts/testMultiAddressExtraction.ts
 *
 * Standalone assertions for the multi-address detection helpers added
 * for the multi_candidate_confirmation flow. Covers:
 *   A. Single-address captions still produce exactly one address.
 *   B. Two distinct addresses in one caption are both detected.
 *   C. Same address repeated yields exactly one entry (dedupe).
 *   D. Three+ addresses are all detected (capped at max).
 *   E. Roundup-style "1. Foo 100 Main St 2. Bar 200 Oak Ave" works.
 *   F. Address fragments without a recognized street suffix are ignored.
 *   G. The legacy `extractLikelyAddress` keeps returning the FIRST hit.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMultiAddressExtraction.ts
 */

import {
  extractLikelyAddress,
  extractLikelyAddresses,
} from '../lib/shareAgent/queryCleaner';

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
// A. Single-address captions
// ---------------------------------------------------------------------------

{
  const out = extractLikelyAddresses('Try Loaded Cafe at 415 Seabright Ave, Santa Cruz, CA — best burrito in town');
  check(
    'A1: single address produces exactly one entry',
    out.length === 1,
    `got ${out.length}`,
  );
  check(
    'A2: single address raw matches',
    out[0]?.raw.toLowerCase().includes('415 seabright ave'),
    out[0]?.raw,
  );
}

// ---------------------------------------------------------------------------
// B. Two distinct addresses in one caption
// ---------------------------------------------------------------------------

{
  const caption = [
    'Best two tacos in OC right now.',
    'Las Palmas at 1834 N Tustin St, Orange, CA.',
    'Also try El Toro at 500 Main St, Huntington Beach, CA.',
  ].join(' ');
  const out = extractLikelyAddresses(caption);
  check(
    'B1: two distinct addresses → length 2',
    out.length === 2,
    `got ${out.length}: ${out.map((a) => a.raw).join(' | ')}`,
  );
  check(
    'B2: first address detected (Tustin St)',
    out[0]?.raw.toLowerCase().includes('1834 n tustin st'),
    out[0]?.raw,
  );
  check(
    'B3: second address detected (Main St)',
    out[1]?.raw.toLowerCase().includes('500 main st'),
    out[1]?.raw,
  );
  check(
    'B4: city for first address parsed',
    (out[0]?.city ?? '').toLowerCase() === 'orange',
    out[0]?.city ?? '',
  );
  check(
    'B5: city for second address parsed',
    (out[1]?.city ?? '').toLowerCase().startsWith('huntington beach'),
    out[1]?.city ?? '',
  );
}

// ---------------------------------------------------------------------------
// C. Same address repeated → dedupe
// ---------------------------------------------------------------------------

{
  const caption =
    'Visit us at 200 Pine St, Seattle, WA. We are at 200 Pine St, Seattle, WA. Yes, 200 Pine St!';
  const out = extractLikelyAddresses(caption);
  check(
    'C1: repeated identical address → exactly one entry',
    out.length === 1,
    `got ${out.length}`,
  );
}

// ---------------------------------------------------------------------------
// D. Three addresses, cap at 10
// ---------------------------------------------------------------------------

{
  const caption = [
    'Three coffee stops worth your morning:',
    'Sightglass at 270 7th St, San Francisco, CA.',
    'Ritual at 1026 Valencia St, San Francisco, CA.',
    'Blue Bottle at 66 Mint Plaza, San Francisco, CA.',
  ].join(' ');
  const out = extractLikelyAddresses(caption);
  check(
    'D1: three distinct addresses → length 3',
    out.length === 3,
    `got ${out.length}: ${out.map((a) => a.raw).join(' | ')}`,
  );
  check(
    'D2: extractLikelyAddresses respects max=2',
    extractLikelyAddresses(caption, 2).length === 2,
  );
}

// ---------------------------------------------------------------------------
// E. Numbered roundup format
// ---------------------------------------------------------------------------

{
  const caption =
    '1. Foo Burgers 100 Main St, Austin, TX 2. Bar Pizza 200 Oak Ave, Austin, TX 3. Baz Tacos 300 Elm Rd, Austin, TX';
  const out = extractLikelyAddresses(caption);
  check(
    'E1: numbered list with 3 addresses → length 3',
    out.length === 3,
    `got ${out.length}: ${out.map((a) => a.raw).join(' | ')}`,
  );
}

// ---------------------------------------------------------------------------
// F. No real addresses → empty
// ---------------------------------------------------------------------------

{
  const caption = 'Loved this brunch spot — open daily, great vibes, follow @foo for more!';
  const out = extractLikelyAddresses(caption);
  check(
    'F1: caption with no addresses → empty array',
    out.length === 0,
    `got ${out.length}`,
  );
}

// ---------------------------------------------------------------------------
// G. Legacy extractLikelyAddress unchanged behavior
// ---------------------------------------------------------------------------

{
  const caption =
    'Las Palmas at 1834 N Tustin St, Orange, CA. Also El Toro at 500 Main St, Huntington Beach, CA.';
  const single = extractLikelyAddress(caption);
  check(
    'G1: extractLikelyAddress returns the FIRST address only',
    !!single && single.raw.toLowerCase().includes('1834 n tustin st'),
    single?.raw ?? 'null',
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll multi-address extraction assertions passed.');
