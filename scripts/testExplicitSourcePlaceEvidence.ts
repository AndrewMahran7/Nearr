/**
 * scripts/testExplicitSourcePlaceEvidence.ts
 *
 * PINNED regression for a recognition class that should have been the EASIEST
 * one we handle: the creator already typed the place name in the caption.
 *
 * Production report (Instagram /p/DbYVuJjM9u2/, a 3-day Twin Falls, Idaho
 * itinerary): Nearr repeatedly returned unrelated LAKES IN IRVINE, CALIFORNIA.
 * Instagram had supplied the whole 2.4k-character caption, and that caption
 * named ten real places with a `📍` in front of each one. Two independent
 * defects threw all of it away:
 *
 *  1. NAME BOUNDARY. The `📍 <Name>` capture treated `:` as ordinary name text.
 *     Instagram travel captions are overwhelmingly written as
 *     "📍 <Venue>: <what to do there>", so every capture ran into the prose.
 *     Short run-ons became malformed provider queries ("Dierkes Lake: Perfect
 *     for swimming"); longer ones blew the 6-word name gate and were dropped
 *     outright. "Shoshone Falls", "Pillar Falls", "Mermaid Cove" — all gone.
 *
 *  2. CITY ROLE. The caption closes with "a great flight from Orange County
 *     (OC) to Twin Falls, Idaho". `extractCityStateContext` took the first
 *     known city literal anywhere in prose, so the DEPARTURE airport became the
 *     post's geographic anchor and biased every Places search to southern
 *     California. Irvine is in Orange County. That is the whole bug: the city
 *     was right as a string and wrong as a ROLE.
 *
 * Net effect, reproduced live before the fix:
 *
 *     query "Dierkes Lake: Perfect for swimming Orange County"
 *     -> Blue Lake Swimming Pool, Irvine CA / North Lake Park, Irvine CA / …
 *
 * The principle being pinned: if the creator already told Nearr what the place
 * is, Nearr must not outsmart the creator with a worse guess — while still
 * refusing to trust every proper noun in a caption.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testExplicitSourcePlaceEvidence.ts
 */

import {
  extractCaptionVenueHints,
  extractCityStateContext,
  looksLikeRoundupPost,
} from '../lib/shareAgent/recoveryHints';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { normalizeShareUrl } from '../lib/shareAgent/tiktokUrl';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const NO_HANDLES = {
  posterHandle: '',
  posterNameHint: null,
  venueHandles: [] as string[],
  taggedHandles: [] as string[],
};

/** Build evidence the way the Instagram path does: og:title + og:description. */
function evidenceFor(caption: string, handles = NO_HANDLES) {
  return extractEvidence({
    platform: 'instagram',
    title: null,
    description: caption,
    handles: handles as never,
    taggedLocation: null,
  });
}

const hintsOf = (caption: string) => evidenceFor(caption).venueNameHints;
const hasHint = (caption: string, name: string) =>
  hintsOf(caption).some((h) => h.toLowerCase() === name.toLowerCase());

// ---------------------------------------------------------------------------
// A. Exact venue/place in caption survives extraction.
// ---------------------------------------------------------------------------
{
  const caption = '📍 Shoshone Falls: Known as the "Niagara of the West," this waterfall is a must-see.';
  check(
    'A: pinned venue survives as a clean name, not a sentence',
    hasHint(caption, 'Shoshone Falls'),
    JSON.stringify(hintsOf(caption)),
  );
  check(
    'A: the description after the colon is not part of the venue name',
    !hintsOf(caption).some((h) => /known as|niagara|must-see/i.test(h)),
    JSON.stringify(hintsOf(caption)),
  );
}

// The pre-fix failure mode, pinned in both directions.
{
  const caption = '📍Dierkes Lake: Perfect for swimming, paddleboarding, picnicking, and a lakeside walk.';
  check(
    'A: the exact reported malformed hint can never be emitted again',
    !hintsOf(caption).includes('Dierkes Lake: Perfect for swimming'),
    JSON.stringify(hintsOf(caption)),
  );
  check('A: the venue itself is emitted instead', hasHint(caption, 'Dierkes Lake'));
}

// A long description used to push the whole capture past the 6-word gate,
// silently dropping the venue. That is the "worse guesses" pathway.
{
  const caption =
    '📍Mermaid Cove: A hidden gem featuring crystal-clear turquoise water with a waterfall, dramatic canyon views, and a secluded swimming hole.';
  check(
    'A: a long trailing description no longer deletes the venue entirely',
    hasHint(caption, 'Mermaid Cove'),
    JSON.stringify(hintsOf(caption)),
  );
}

// Other separators the caption idiom uses for the same purpose.
{
  check('A: en/em dash separator also bounds the name', hasHint('📍 Pillar Falls — hike to this scenic waterfall', 'Pillar Falls'));
  check('A: semicolon also bounds the name', hasHint('📍 Malad Gorge; watch the Snake River carve through cliffs', 'Malad Gorge'));
}

// ---------------------------------------------------------------------------
// B. Exact venue + city.
// ---------------------------------------------------------------------------
{
  const caption = '📍 Seabright Deli in Santa Cruz — best breakfast sandwich on the coast.';
  const ev = evidenceFor(caption);
  check('B: venue name extracted alongside a city', ev.venueNameHints.some((h) => /Seabright Deli/i.test(h)), JSON.stringify(ev.venueNameHints));
  check('B: the city is kept as context', ev.cityState?.city === 'Santa Cruz' && ev.cityState?.state === 'CA', JSON.stringify(ev.cityState));
  check('B: the city itself is not offered as the venue', !ev.venueNameHints.some((h) => h.toLowerCase() === 'santa cruz'));
}

// ---------------------------------------------------------------------------
// C. Full address stays the strongest input (address verification untouched).
// ---------------------------------------------------------------------------
{
  const caption = '📍 2nd Floor: come hungry! 126 Main St, Huntington Beach, CA';
  const ev = evidenceFor(caption);
  check('C: street address still extracted', ev.addresses.length >= 1, JSON.stringify(ev.addresses.map((a) => a.raw)));
  check('C: caption_explicit_address evidence key still set', ev.keys.includes('caption_explicit_address'), ev.keys.join(','));
  check('C: an address-anchored single-venue post is NOT a roundup', ev.isRoundup === false);
}

// ---------------------------------------------------------------------------
// D. Broad city only -> context, never a business.
// ---------------------------------------------------------------------------
{
  const ev = evidenceFor('A whole weekend in San Diego, so much good food.');
  check('D: city-only caption yields city context', ev.cityState?.city === 'San Diego', JSON.stringify(ev.cityState));
  check('D: city-only caption yields NO venue hint', ev.venueNameHints.length === 0, JSON.stringify(ev.venueNameHints));
  check('D: city-only caption carries no explicit-place evidence key', !ev.keys.includes('caption_venue_hint'), ev.keys.join(','));
  // The pre-existing delimiter guard (`cityStateAppearsAsLocation`) still
  // requires the city to read as a location, not as a passing noun. Pinned so
  // this fix cannot be mistaken for a licence to loosen it.
  const loose = evidenceFor('Spent the weekend eating our way through San Diego.');
  check('D: a city without a locational delimiter stays unanchored', loose.cityState === null, JSON.stringify(loose.cityState));
}

// ---------------------------------------------------------------------------
// E. Multiple explicit destinations -> multi-place, never one arbitrary pick.
// ---------------------------------------------------------------------------
{
  const caption = [
    '3 beaches you need to visit:',
    '📍 Atuh Beach: the cliff views are unreal',
    '📍 Diamond Beach: go early before the crowds',
    '📍 Kelingking Beach: the T-rex cliff everyone posts',
  ].join('\n');
  const ev = evidenceFor(caption);
  check('E: every named beach survives extraction', ['Atuh Beach', 'Diamond Beach', 'Kelingking Beach'].every((n) => ev.venueNameHints.some((h) => h.toLowerCase() === n.toLowerCase())), JSON.stringify(ev.venueNameHints));
  check('E: 3+ pinned places classify as multi-place, not a single venue', ev.isRoundup === true);
  check('E: roundup_post evidence key set so decision policy sees it', ev.keys.includes('roundup_post'), ev.keys.join(','));
}

// A single venue that decorates its caption with pins must NOT become a
// roundup — the count is of NAME-SHAPED pins, not pin glyphs.
{
  const caption = '📍 Loaded Cafe\n📍 Open daily 7am-3pm\n📍 Free parking in the rear\n126 Main St, Huntington Beach, CA';
  const ev = evidenceFor(caption);
  check('E: decorative pins on a single-venue post do not force multi-place', ev.isRoundup === false, `hints=${JSON.stringify(ev.venueNameHints)}`);
}

// ---------------------------------------------------------------------------
// F. Caption evidence vs a weaker unrelated inference.
//    The caption must still carry its own explicit place through extraction so
//    a vaguer hypothesis has something concrete to lose to downstream.
// ---------------------------------------------------------------------------
{
  const ev = evidenceFor('📍 Sunset Cliffs Natural Park: golden hour here is unreal.');
  check('F: explicit caption place is present and exact', ev.venueNameHints[0] === 'Sunset Cliffs Natural Park', JSON.stringify(ev.venueNameHints));
  check('F: it is flagged as real place evidence for the decision policy', ev.keys.includes('caption_venue_hint'));
  check('F: no unrelated city context is invented from scenery words', ev.cityState === null, JSON.stringify(ev.cityState));
}

// ---------------------------------------------------------------------------
// G. Caption contains an unrelated city (origin / creator home base).
//    This is the exact Irvine mechanism.
// ---------------------------------------------------------------------------
{
  const caption =
    '@breezeairways now has a great flight from Orange County (OC) to Twin Falls, Idaho! Check out their flights for your next vacation.';
  check('G: a departure city never becomes the post geographic anchor', extractCityStateContext(caption) === null, JSON.stringify(extractCityStateContext(caption)));
}
{
  check('G: "LA creator exploring San Diego" anchors on the destination', extractCityStateContext('LA based creator, currently exploring San Diego')?.city === 'San Diego');
  check('G: "based in Long Beach" is home base, not destination', extractCityStateContext('Long Beach based photographer')?.city !== 'Long Beach');
  check('G: an ordinary destination mention is unaffected', extractCityStateContext('Grabbing tacos in Santa Cruz today')?.city === 'Santa Cruz');
  check('G: explicit "City, ST" for a real destination still wins', extractCityStateContext('Sunset dinner in Newport Beach, CA')?.city === 'Newport Beach');
  check('G: a distant unrelated "from" does not veto a city', extractCityStateContext('Fresh from the oven, this pizza in Brooklyn is unreal')?.city === 'Brooklyn');
}

// ---------------------------------------------------------------------------
// H. International destinations stay supported (no English/US special-casing).
// ---------------------------------------------------------------------------
{
  const ev = evidenceFor('📍 Praia de Ipanema: o pôr do sol aqui é inesquecível.');
  check('H: Portuguese caption keeps its accented place name intact', ev.venueNameHints.includes('Praia de Ipanema'), JSON.stringify(ev.venueNameHints));
}
{
  const ev = evidenceFor('📍 Pantai Atuh: pemandangan tebingnya luar biasa');
  check('H: Indonesian caption keeps its place name', ev.venueNameHints.includes('Pantai Atuh'), JSON.stringify(ev.venueNameHints));
}
{
  const ev = evidenceFor('📍 Trattoria dell’Arte: la carbonara è leggendaria');
  check('H: Italian caption keeps apostrophes/accents', ev.venueNameHints.some((h) => /Trattoria dell/i.test(h)), JSON.stringify(ev.venueNameHints));
}
{
  // A non-US caption must not acquire a US city anchor from nowhere.
  const ev = evidenceFor('📍 Playa Ometepe: la isla más tranquila de Nicaragua');
  check('H: non-US caption invents no US city context', ev.cityState === null, JSON.stringify(ev.cityState));
}

// ---------------------------------------------------------------------------
// I. Instagram URL variants must be equivalent source identity.
// ---------------------------------------------------------------------------
{
  const canonical = 'https://www.instagram.com/p/DbYVuJjM9u2/';
  const variants = [
    'https://www.instagram.com/p/DbYVuJjM9u2/?igsh=NTc4MTIwNjQ2YQ==',
    'https://www.instagram.com/p/DbYVuJjM9u2',
    'https://www.instagram.com/p/DbYVuJjM9u2/?igsh=OTHERVALUE123',
  ];
  const idOf = (u: string) => (normalizeShareUrl(u).url || u).replace(/\/+$/, '');
  const base = idOf(canonical);
  for (const v of variants) {
    check(`I: URL variant resolves to the same post identity (${v.includes('igsh') ? 'igsh' : 'no-slash'})`, idOf(v) === base, `${idOf(v)} !== ${base}`);
  }
  // The fix must not be built around the literal tracking parameter.
  check('I: no igsh-specific logic leaked into normalization', !normalizeShareUrl(variants[0]).url.includes('igsh'));
}

// ---------------------------------------------------------------------------
// Primary regression: the full production caption shape, end to end through
// evidence extraction. Trimmed to the structure that mattered; no creator
// identity, no raw post text beyond the place names themselves.
// ---------------------------------------------------------------------------
{
  const caption = [
    'AD Twin Falls, Idaho',
    'This is one of America’s ultimate outdoor adventure destinations.',
    '',
    'Day 1: Waterfalls & Sunset Views',
    '📍 Shoshone Falls: Known as the "Niagara of the West," this massive waterfall is a must-see.',
    '📍Dierkes Lake: Perfect for swimming, paddleboarding, picnicking, and a lakeside walk.',
    '📍 Perrine Coulee Falls: Take the short walk behind the waterfall.',
    '',
    'Day 2: Scenic Drives & Natural Wonders',
    '📍Ritter Island: Walk along the waterfalls and swim in natural springs.',
    '📍Blue Heart Springs: Paddle to a hidden crystal-clear turquoise spring.',
    '📍Malad Gorge: Watch the Snake River carve through dramatic volcanic cliffs.',
    '',
    'Day 3: Explore Hidden Gems',
    '📍Pillar Falls: Hike to this scenic waterfall surrounded by basalt formations.',
    '📍Mermaid Cove: A hidden gem featuring crystal-clear turquoise water with a waterfall.',
    '',
    'If you are planning a trip, @breezeairways now has a great flight from Orange County (OC) to Twin Falls, Idaho!',
    '',
    '#TwinFalls #VisitIdaho #SouthernIdaho',
  ].join('\n');

  const ev = evidenceFor(caption);

  check(
    'PRIMARY: the geographic anchor is no longer the departure airport',
    ev.cityState === null,
    JSON.stringify(ev.cityState),
  );
  check(
    'PRIMARY: no Orange County / California context anywhere in the evidence',
    !/orange county|irvine/i.test(JSON.stringify(ev.cityState)) &&
      !ev.venueNameHints.some((h) => /orange county|irvine/i.test(h)),
  );

  const expected = [
    'Shoshone Falls',
    'Dierkes Lake',
    'Perrine Coulee Falls',
    'Ritter Island',
    'Blue Heart Springs',
    'Malad Gorge',
    'Pillar Falls',
    'Mermaid Cove',
  ];
  for (const name of expected) {
    check(`PRIMARY: caption place "${name}" survives to the resolver`, ev.venueNameHints.some((h) => h.toLowerCase() === name.toLowerCase()), JSON.stringify(ev.venueNameHints));
  }

  check(
    'PRIMARY: the first query is a real place name, not a sentence fragment',
    !!ev.venueNameHints[0] && !/[:;]/.test(ev.venueNameHints[0]),
    JSON.stringify(ev.venueNameHints[0]),
  );
  check(
    'PRIMARY: a ten-pin itinerary is treated as multi-place',
    ev.isRoundup === true && ev.keys.includes('roundup_post'),
    ev.keys.join(','),
  );
}

// ---------------------------------------------------------------------------
// Guards against loosening existing safety behavior.
// ---------------------------------------------------------------------------
{
  // Roundup detection that already worked must keep working.
  check('GUARD: "top 10" list language still detected', looksLikeRoundupPost('Top 10 tacos in LA you have to try') === true);
  check('GUARD: ranked "#5 from @handle" still detected', looksLikeRoundupPost('#5 from @woodennickel_wv') === true);
  // And a plain single-venue caption must still not be a roundup.
  check('GUARD: single venue caption is not a roundup', looksLikeRoundupPost('📍 Capone’s Cucina — the best chicken parm in town') === false);
  // Empty / junk input.
  check('GUARD: empty caption yields no hints', extractCaptionVenueHints('').length === 0);
  check('GUARD: empty caption yields no city', extractCityStateContext('') === null);
  check('GUARD: a bare pin with no name yields nothing', extractCaptionVenueHints('📍').length === 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
