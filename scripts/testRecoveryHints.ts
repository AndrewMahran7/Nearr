/**
 * scripts/testRecoveryHints.ts
 *
 * Unit tests for lib/shareAgent/recoveryHints.ts covering the
 * timeout-recovery / Places query-building heuristics introduced for
 * the collab-post + venue-handle scenario (e.g. Paradise Dynasty at
 * 3333 Bristol St / South Coast Plaza).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testRecoveryHints.ts
 */

import {
  derivePlaceNameHintFromHandle,
  compactNameMatches,
  extractCaptionVenueHints,
  extractCityStateContext,
  extractMallContextLabel,
  extractStateFromFormattedAddress,
  extractVenueHandleCandidates,
  isGenericAddressCard,
  isMallContextHandle,
  isNoiseHandle,
  isWrongLocationCandidate,
  looksLikeRoundupPost,
  normalizeCompactName,
} from '../lib/shareAgent/recoveryHints';
import type { DetectedHandles } from '../lib/shareAgent/tools';
import type { LikelyAddress } from '../lib/shareAgent/queryCleaner';

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
// derivePlaceNameHintFromHandle
// ---------------------------------------------------------------------------
// Compact tokens are NOT word-split (no dictionary). The contract
// is: strip region/marketing suffixes, title-case what remains.
// Google Places fuzzy-matches "Paradisedynasty 3333 Bristol St"
// to the real listing without needing perfect word boundaries.
check(
  'paradisedynasty_usa → "Paradisedynasty" (usa suffix stripped, compact preserved)',
  derivePlaceNameHintFromHandle('paradisedynasty_usa') === 'Paradisedynasty',
  `got=${derivePlaceNameHintFromHandle('paradisedynasty_usa')}`,
);
check(
  'paradisedynastyusa → "Paradisedynasty" (compact, usa stripped)',
  derivePlaceNameHintFromHandle('paradisedynastyusa') === 'Paradisedynasty',
  `got=${derivePlaceNameHintFromHandle('paradisedynastyusa')}`,
);
check(
  'burritoslapalma → "Burritoslapalma"',
  derivePlaceNameHintFromHandle('burritoslapalma') === 'Burritoslapalma',
);
check(
  '2nd_floor_hb → "2nd Floor" (hb suffix stripped)',
  derivePlaceNameHintFromHandle('2nd_floor_hb') === '2nd Floor',
  `got=${derivePlaceNameHintFromHandle('2nd_floor_hb')}`,
);
check(
  'dametra_fresh_official → "Dametra Fresh"',
  derivePlaceNameHintFromHandle('dametra_fresh_official') === 'Dametra Fresh',
);
check(
  'usa → null (nothing left)',
  derivePlaceNameHintFromHandle('usa') === null,
);
check(
  'empty → null',
  derivePlaceNameHintFromHandle('') === null,
);

// ---------------------------------------------------------------------------
// isMallContextHandle
// ---------------------------------------------------------------------------
check('southcoastplaza is mall', isMallContextHandle('southcoastplaza'));
check('westfieldcentury is NOT mall', !isMallContextHandle('westfieldcentury'));
check('blossom_mall is mall', isMallContextHandle('blossom_mall'));
check('americanaattheoutlets is mall (outlets)', isMallContextHandle('americanaattheoutlets'));
check('paradisedynasty_usa is NOT mall', !isMallContextHandle('paradisedynasty_usa'));
check('citadeloutlets is mall', isMallContextHandle('citadeloutlets'));

// ---------------------------------------------------------------------------
// extractVenueHandleCandidates: collab post with poster + venue + venue + mall
// ---------------------------------------------------------------------------
{
  const handles: DetectedHandles = {
    posterHandle: 'ocfoodandview',
    taggedHandles: ['paradisedynasty_usa', 'burritoslapalma', 'southcoastplaza', 'ocfoodandview'],
    allHandles: ['ocfoodandview', 'paradisedynasty_usa', 'burritoslapalma', 'southcoastplaza'],
  };
  const candidates = extractVenueHandleCandidates(handles);
  check(
    'venue candidates exclude poster and mall',
    candidates.length === 2 &&
      candidates[0] === 'paradisedynasty_usa' &&
      candidates[1] === 'burritoslapalma',
    `got=${JSON.stringify(candidates)}`,
  );
  check(
    'mall context label = "Southcoastplaza" (compact, not word-split)',
    extractMallContextLabel(handles) === 'Southcoastplaza',
    `got=${extractMallContextLabel(handles)}`,
  );
}

// ---------------------------------------------------------------------------
// extractVenueHandleCandidates: influencer-only post (no tagged venues)
// ---------------------------------------------------------------------------
{
  const handles: DetectedHandles = {
    posterHandle: 'ocfoodandview',
    taggedHandles: [],
    allHandles: ['ocfoodandview'],
  };
  check(
    'no tagged handles → no venue candidates',
    extractVenueHandleCandidates(handles).length === 0,
  );
  check('no mall context', extractMallContextLabel(handles) === null);
}

// ---------------------------------------------------------------------------
// extractVenueHandleCandidates: poster is the venue (single-account post)
// ---------------------------------------------------------------------------
{
  const handles: DetectedHandles = {
    posterHandle: '2nd_floor_hb',
    taggedHandles: ['2nd_floor_hb'],
    allHandles: ['2nd_floor_hb'],
  };
  check(
    'poster=tagged → still excluded as venue candidate (handle-only guard)',
    extractVenueHandleCandidates(handles).length === 0,
    `got=${JSON.stringify(extractVenueHandleCandidates(handles))}`,
  );
}

// ---------------------------------------------------------------------------
// isGenericAddressCard
// ---------------------------------------------------------------------------
const captionAddress3333: LikelyAddress = {
  raw: '3333 Bristol St',
  city: 'Costa Mesa',
  state: 'CA',
};
check(
  'name="3333 Bristol St" is generic',
  isGenericAddressCard({ name: '3333 Bristol St' }, captionAddress3333),
);
check(
  'name="3333 Bristol Street" is generic (suffix variation)',
  isGenericAddressCard({ name: '3333 Bristol Street' }, captionAddress3333),
);
check(
  'name="Paradise Dynasty" is NOT generic',
  !isGenericAddressCard({ name: 'Paradise Dynasty' }, captionAddress3333),
);
check(
  'name="South Coast Plaza" is NOT generic (no leading digits)',
  !isGenericAddressCard({ name: 'South Coast Plaza' }, captionAddress3333),
);
check(
  'null candidate → false',
  !isGenericAddressCard(null, captionAddress3333),
);
check(
  'null captionAddress → false',
  !isGenericAddressCard({ name: '3333 Bristol St' }, null),
);
check(
  'address with no leading digits in candidate → false',
  !isGenericAddressCard({ name: 'Bristol Plaza' }, captionAddress3333),
);

// ---------------------------------------------------------------------------
// Integration: query plan for the Paradise Dynasty + 3333 Bristol St case.
//
// This re-implements the venue+address-first ordering that lives in
// shadowRun.ts so we can assert the contract without booting Deno.
// If shadowRun.ts diverges, this test must be updated and the change
// noted in repo memory.
// ---------------------------------------------------------------------------
function planAddressQueries(args: {
  handles: DetectedHandles;
  captionAddress: LikelyAddress;
  titleBrand: string | null;
}): string[] {
  const venueHandleHints = extractVenueHandleCandidates(args.handles)
    .map((handle) => derivePlaceNameHintFromHandle(handle))
    .filter((name): name is string => !!name);
  const mall = extractMallContextLabel(args.handles);
  const hints = [...venueHandleHints];
  if (args.titleBrand && !hints.includes(args.titleBrand)) hints.push(args.titleBrand);

  const out: string[] = [];
  for (const hint of hints) {
    if (args.captionAddress.city && args.captionAddress.state) {
      out.push(`${hint} ${args.captionAddress.raw} ${args.captionAddress.city} ${args.captionAddress.state}`);
    }
    if (args.captionAddress.city) {
      out.push(`${hint} ${args.captionAddress.raw} ${args.captionAddress.city}`);
    }
    out.push(`${hint} ${args.captionAddress.raw}`);
    if (mall && args.captionAddress.city && args.captionAddress.state) {
      out.push(`${hint} ${mall} ${args.captionAddress.city} ${args.captionAddress.state}`);
    }
  }
  if (args.captionAddress.city && args.captionAddress.state) {
    out.push(`${args.captionAddress.raw} ${args.captionAddress.city} ${args.captionAddress.state}`);
  }
  if (args.captionAddress.city) {
    out.push(`${args.captionAddress.raw} ${args.captionAddress.city}`);
  }
  out.push(args.captionAddress.raw);
  return out;
}

{
  // Scenario: Paradise Dynasty + 3333 Bristol St + collab handle + mall
  const queries = planAddressQueries({
    handles: {
      posterHandle: 'ocfoodandview',
      taggedHandles: ['paradisedynasty_usa', 'burritoslapalma', 'southcoastplaza'],
      allHandles: ['ocfoodandview', 'paradisedynasty_usa', 'burritoslapalma', 'southcoastplaza'],
    },
    captionAddress: captionAddress3333,
    titleBrand: null,
  });
  check(
    'first query is "Paradisedynasty 3333 Bristol St Costa Mesa CA" (venue+address first)',
    queries[0] === 'Paradisedynasty 3333 Bristol St Costa Mesa CA',
    `got=${queries[0]}`,
  );
  check(
    'bare address comes after venue+mall variants',
    queries.indexOf('3333 Bristol St') > queries.indexOf('Paradisedynasty 3333 Bristol St Costa Mesa CA'),
    `queries=${JSON.stringify(queries)}`,
  );
  check(
    'mall-context query is generated for primary venue hint',
    queries.includes('Paradisedynasty Southcoastplaza Costa Mesa CA'),
    `queries=${JSON.stringify(queries)}`,
  );
  check(
    'second venue hint (Burritoslapalma) also gets venue+address query',
    queries.includes('Burritoslapalma 3333 Bristol St Costa Mesa CA'),
  );
  check(
    'mall handle never appears as primary venue',
    !queries.some((q) => /^southcoastplaza /i.test(q)),
  );
  check(
    'poster handle never appears as primary venue',
    !queries.some((q) => /^ocfoodandview\b/i.test(q)),
  );
}

{
  // Scenario: collab with two restaurant handles, no mall, address only.
  const queries = planAddressQueries({
    handles: {
      posterHandle: 'foodietraveler',
      taggedHandles: ['joesburgers', 'mariastacos'],
      allHandles: ['foodietraveler', 'joesburgers', 'mariastacos'],
    },
    captionAddress: { raw: '500 Pine Ave', city: 'Long Beach', state: 'CA' },
    titleBrand: null,
  });
  check(
    'two venue handles → first hint is first tag (caption order preserved)',
    queries[0] === 'Joesburgers 500 Pine Ave Long Beach CA',
    `got=${queries[0]}`,
  );
  check(
    'second venue hint still gets venue+address query',
    queries.includes('Mariastacos 500 Pine Ave Long Beach CA'),
  );
}

{
  // Scenario: generic-address-only (no tagged venues at all)
  const queries = planAddressQueries({
    handles: {
      posterHandle: 'somerandomposter',
      taggedHandles: [],
      allHandles: ['somerandomposter'],
    },
    captionAddress: { raw: '100 Main St', city: 'Anywhere', state: 'CA' },
    titleBrand: null,
  });
  check(
    'no venue hints → only bare-address queries produced',
    queries[0] === '100 Main St Anywhere CA' && queries.includes('100 Main St'),
    `got=${JSON.stringify(queries)}`,
  );
}

{
  // Scenario: influencer poster + single venue handle + address.
  const queries = planAddressQueries({
    handles: {
      posterHandle: 'foodieinfluencer',
      taggedHandles: ['theslantedstore'],
      allHandles: ['foodieinfluencer', 'theslantedstore'],
    },
    captionAddress: { raw: '42 Elm St', city: 'Brooklyn', state: 'NY' },
    titleBrand: null,
  });
  check(
    'influencer + single venue handle → venue first',
    queries[0] === 'Theslantedstore 42 Elm St Brooklyn NY',
    `got=${queries[0]}`,
  );
  check(
    'influencer handle does not appear as venue',
    !queries.some((q) => /^foodieinfluencer\b/i.test(q)),
  );
}

{
  // Scenario: mall handle used as context (no other venue tags).
  // We should NOT promote the mall to venue, but bare address still works.
  const queries = planAddressQueries({
    handles: {
      posterHandle: 'foodietraveler',
      taggedHandles: ['southcoastplaza'],
      allHandles: ['foodietraveler', 'southcoastplaza'],
    },
    captionAddress: captionAddress3333,
    titleBrand: null,
  });
  check(
    'mall-only tags → no venue hints, only bare address',
    queries[0] === '3333 Bristol St Costa Mesa CA',
    `got=${queries[0]}`,
  );
  check(
    'mall is never the venue even when it is the only tagged handle',
    !queries.some((q) => /^Southcoastplaza /.test(q)),
  );
}

// ---------------------------------------------------------------------------
// Patch 1 — address-free recovery helpers
// ---------------------------------------------------------------------------
// extractCityStateContext
check(
  'extractCityStateContext: "Santa Cruz, CA" → Santa Cruz / CA',
  JSON.stringify(extractCityStateContext('caption blah Santa Cruz, CA more text')) ===
    JSON.stringify({ city: 'Santa Cruz', state: 'CA' }),
);
check(
  'extractCityStateContext: "in Newport Beach" prose → Newport Beach / CA',
  JSON.stringify(extractCityStateContext('Iconic Cantina in Newport Beach 🍹')) ===
    JSON.stringify({ city: 'Newport Beach', state: 'CA' }),
);
check(
  'extractCityStateContext: #santacruz hashtag → Santa Cruz / CA',
  JSON.stringify(extractCityStateContext('great burger #foodie #santacruz #bayarea')) ===
    JSON.stringify({ city: 'Santa Cruz', state: 'CA' }),
);
check(
  'extractCityStateContext: #downtownsantacruz hashtag → Santa Cruz / CA',
  JSON.stringify(extractCityStateContext('#organicfood #downtownsantacruz #visitsantacruz')) ===
    JSON.stringify({ city: 'Santa Cruz', state: 'CA' }),
);
check(
  'extractCityStateContext: unknown city → null',
  extractCityStateContext('Some random text in Wabash, IL with no known cities') === null,
);
check(
  'extractCityStateContext: empty → null',
  extractCityStateContext('') === null && extractCityStateContext(null) === null,
);

// looksLikeRoundupPost
check(
  'looksLikeRoundupPost: "top 5 burgers" → true',
  looksLikeRoundupPost('Top 5 burgers in Santa Cruz!') === true,
);
check(
  'looksLikeRoundupPost: "#5 from @woodennickel_wv" → true',
  looksLikeRoundupPost(
    'Who holds the title for best burger in Santa Cruz? #5 from @woodennickel_wv',
  ) === true,
);
check(
  'looksLikeRoundupPost: "best burger" alone → false (single venue context)',
  looksLikeRoundupPost('Easily the best sandwich spot in Santa Cruz') === false,
);
check(
  'looksLikeRoundupPost: 3+ tagged handles ALONE → false (Patch 5: not enough signal)',
  looksLikeRoundupPost('caption', {
    posterHandle: 'roundupposter',
    taggedHandles: ['placeone', 'placetwo', 'placethree'],
    allHandles: ['roundupposter', 'placeone', 'placetwo', 'placethree'],
  } as DetectedHandles) === false,
);
check(
  'looksLikeRoundupPost: 3+ tagged handles + list language → true',
  looksLikeRoundupPost('Top 5 spots this month!', {
    posterHandle: 'roundupposter',
    taggedHandles: ['placeone', 'placetwo', 'placethree'],
    allHandles: ['roundupposter', 'placeone', 'placetwo', 'placethree'],
  } as DetectedHandles) === true,
);
check(
  'looksLikeRoundupPost: 1 tagged handle → false',
  looksLikeRoundupPost('caption', {
    posterHandle: 'someposter',
    taggedHandles: ['singleplace'],
    allHandles: ['someposter', 'singleplace'],
  } as DetectedHandles) === false,
);

// Patch 5 additions: single-place posts with collaborator tags must NOT
// be classified as roundup.
check(
  'looksLikeRoundupPost: "2nd Floor 126 Main St Huntington Beach" + collab tags → false',
  looksLikeRoundupPost(
    '📍 2nd Floor, 126 Main St, Huntington Beach, CA — best happy hour',
    {
      posterHandle: 'foodie',
      taggedHandles: ['somesupplier', 'somecollab', 'someguest'],
      allHandles: ['foodie', 'somesupplier', 'somecollab', 'someguest'],
    } as DetectedHandles,
  ) === false,
);
check(
  'looksLikeRoundupPost: "Seabright Deli 415 Seabright Ave Santa Cruz" + tags → false',
  looksLikeRoundupPost(
    'Seabright Deli, 415 Seabright Ave, Santa Cruz, CA - hands down the best sando',
    {
      posterHandle: 'foodie',
      taggedHandles: ['supplier', 'eggcollab', 'breadguy'],
      allHandles: ['foodie', 'supplier', 'eggcollab', 'breadguy'],
    } as DetectedHandles,
  ) === false,
);
check(
  'looksLikeRoundupPost: "Top 5 burger spots" → true',
  looksLikeRoundupPost('Top 5 burger spots in Newport Beach') === true,
);
check(
  'looksLikeRoundupPost: "list of our favorite pizza places" → true',
  looksLikeRoundupPost('A list of our favorite pizza places in LA') === true,
);
check(
  'looksLikeRoundupPost: "our picks for sushi" → true',
  looksLikeRoundupPost('Our picks for the best sushi this year') === true,
);
check(
  'looksLikeRoundupPost: 5 numbered list items → true',
  looksLikeRoundupPost('1. Foo\n2. Bar\n3. Baz\n4. Qux\n5. Quux') === true,
);
check(
  'looksLikeRoundupPost: list keyword on a single-place post with full address → false',
  looksLikeRoundupPost(
    '📍 Mad Yolks, 1411 Pacific Ave, Santa Cruz — the best brunch in town',
  ) === false,
);
// Patch 5b: idiomatic "round up your crew" must NOT trigger.
check(
  'looksLikeRoundupPost: idiomatic "Round up your crew" → false',
  looksLikeRoundupPost(
    'Round up your crew and join us here at 2nd Floor for brunch',
  ) === false,
);
check(
  'looksLikeRoundupPost: "roundup" (one word) still → true',
  looksLikeRoundupPost('Our annual best sushi roundup is here') === true,
);
check(
  'looksLikeRoundupPost: "round-up" (hyphen) still → true',
  looksLikeRoundupPost('Pizza round-up: every spot in town') === true,
);

// extractCaptionVenueHints
{
  const hints = extractCaptionVenueHints(
    'Seabright Deli In Santa Cruz @seabrightdeli the best',
  );
  check(
    'extractCaptionVenueHints: "Seabright Deli In Santa Cruz" → ["Seabright Deli"]',
    hints.includes('Seabright Deli'),
    `got=${JSON.stringify(hints)}`,
  );
}
{
  const hints = extractCaptionVenueHints(
    'Burrito on the beach!? POINT MARKET AND CAFE, Santa Cruz, CA📍 one of the freshest',
  );
  check(
    'extractCaptionVenueHints: "POINT MARKET AND CAFE, Santa Cruz, CA" → ["POINT MARKET AND CAFE"]',
    hints.some((h) => /point market and cafe/i.test(h)),
    `got=${JSON.stringify(hints)}`,
  );
}
{
  const hints = extractCaptionVenueHints(
    '📍Seabright Deli\n415 Seabright Ave\nSanta Cruz, CA',
  );
  check(
    'extractCaptionVenueHints: "📍Seabright Deli" pin → ["Seabright Deli"]',
    hints.includes('Seabright Deli'),
    `got=${JSON.stringify(hints)}`,
  );
}
{
  const hints = extractCaptionVenueHints('no caps no patterns here');
  check(
    'extractCaptionVenueHints: no patterns → []',
    hints.length === 0,
    `got=${JSON.stringify(hints)}`,
  );
}
// Patch 6 follow-up: descriptor/time stoplist.
{
  const hints = extractCaptionVenueHints('Easily the best sandwich spot in Santa Cruz');
  check(
    'extractCaptionVenueHints: descriptor first-word "Easily ..." → []',
    hints.length === 0,
    `got=${JSON.stringify(hints)}`,
  );
}
{
  const hints = extractCaptionVenueHints('Open daily 11AM - 3PM 📍 ');
  check(
    'extractCaptionVenueHints: "11AM - 3PM 📍" time fragment → []',
    hints.length === 0,
    `got=${JSON.stringify(hints)}`,
  );
}
{
  const hints = extractCaptionVenueHints('The Best Place In Town in Santa Cruz');
  check(
    'extractCaptionVenueHints: "The Best ..." descriptor → []',
    hints.length === 0,
    `got=${JSON.stringify(hints)}`,
  );
}

// normalizeCompactName
check(
  'normalizeCompactName: "Seabright Deli" → "seabrightdeli"',
  normalizeCompactName('Seabright Deli') === 'seabrightdeli',
);
check(
  'normalizeCompactName: "Point Market & Cafe" → "pointmarketcafe"',
  normalizeCompactName('Point Market & Cafe') === 'pointmarketcafe',
);
check(
  'normalizeCompactName: accents stripped',
  normalizeCompactName('Café Olé') === 'cafeole',
);

// Integration-style check: the 6 required scenarios from the brief.
// We assert the helpers compose into the inputs the backend orchestrator
// will use to construct queries. Actual Places calls aren't made here.
function buildAddressFreeInputs(text: string, handles: DetectedHandles): {
  cityState: ReturnType<typeof extractCityStateContext>;
  hints: string[];
  isRoundup: boolean;
} {
  return {
    cityState: extractCityStateContext(text),
    hints: [
      ...extractCaptionVenueHints(text),
      ...extractVenueHandleCandidates(handles)
        .map(derivePlaceNameHintFromHandle)
        .filter((v): v is string => !!v),
    ],
    isRoundup: looksLikeRoundupPost(text, handles),
  };
}

{
  // 1. Seabright Deli + Santa Cruz, no street address.
  const r = buildAddressFreeInputs(
    'Seabright Deli In Santa Cruz @seabrightdeli #santacruz',
    {
      posterHandle: 'thesnacksensei',
      taggedHandles: ['seabrightdeli'],
      allHandles: ['thesnacksensei', 'seabrightdeli'],
    } as DetectedHandles,
  );
  check(
    'scenario: Seabright Deli — produces venue hint + Santa Cruz city',
    !r.isRoundup &&
      r.cityState?.city === 'Santa Cruz' &&
      r.cityState?.state === 'CA' &&
      r.hints.some((h) => /seabright/i.test(h)),
    `got=${JSON.stringify(r)}`,
  );
}
{
  // 2. Tacos El Chuy Truck via tagged handle + #santacruz.
  const r = buildAddressFreeInputs(
    'Rainy days call for warm tasty food like ramen birria from @tacoselchuytruck #santacruz',
    {
      posterHandle: 'santacruzbucketlist',
      taggedHandles: ['tacoselchuytruck'],
      allHandles: ['santacruzbucketlist', 'tacoselchuytruck'],
    } as DetectedHandles,
  );
  check(
    'scenario: Tacos El Chuy Truck — handle becomes venue hint, city detected',
    !r.isRoundup &&
      r.cityState?.city === 'Santa Cruz' &&
      r.hints.some((h) => /tacoselchuytruck|tacos el chuy/i.test(h)),
    `got=${JSON.stringify(r)}`,
  );
}
{
  // 3. Taqueria Los Pericos with explicit "📍 @handle | Santa Cruz, CA".
  const r = buildAddressFreeInputs(
    'Buche Super Burrito from Taqueria Los Pericos 📍 @taquerialospericossocial | Santa Cruz, CA',
    {
      posterHandle: 'kristinasee.eats',
      taggedHandles: ['taquerialospericossocial'],
      allHandles: ['kristinasee.eats', 'taquerialospericossocial'],
    } as DetectedHandles,
  );
  check(
    'scenario: Taqueria Los Pericos — caption hint + explicit city',
    !r.isRoundup &&
      r.cityState?.city === 'Santa Cruz' &&
      r.cityState?.state === 'CA' &&
      r.hints.some((h) => /taqueria los pericos|taquerialospericos/i.test(h)),
    `got=${JSON.stringify(r)}`,
  );
}
{
  // 4. Point Market & Cafe — caption "Name, City, CA" form.
  const r = buildAddressFreeInputs(
    'Burrito on the beach!? POINT MARKET AND CAFE, Santa Cruz, CA📍 One of the freshest #santacruz',
    {
      posterHandle: 'taranexploro',
      taggedHandles: [],
      allHandles: ['taranexploro'],
    } as DetectedHandles,
  );
  check(
    'scenario: Point Market & Cafe — caption "Name, City, CA" pattern produces hint',
    !r.isRoundup &&
      r.cityState?.city === 'Santa Cruz' &&
      r.hints.some((h) => /point market and cafe/i.test(h)),
    `got=${JSON.stringify(r)}`,
  );
}
{
  // 5. Chocolate the Restaurant — only handle + Santa Cruz hashtags.
  const r = buildAddressFreeInputs(
    'Come and get it! #organicfood #downtownfun #downtownsantacruz #visitsantacruz',
    {
      posterHandle: 'chocolatetherestaurant',
      taggedHandles: [],
      allHandles: ['chocolatetherestaurant'],
    } as DetectedHandles,
  );
  check(
    'scenario: Chocolate the Restaurant — hashtag city + poster-as-venue (when address-free path adds title hint)',
    !r.isRoundup &&
      r.cityState?.city === 'Santa Cruz' &&
      r.cityState?.state === 'CA',
    `got=${JSON.stringify(r)}`,
  );
}
{
  // 6. Top-5 burger list — MUST be flagged as roundup.
  const r = buildAddressFreeInputs(
    'Who holds the title for best burger in Santa Cruz? Top 5 burgers. #5 from @woodennickel_wv #4 from @bellygoatburger',
    {
      posterHandle: 'lookoutsantacruz',
      taggedHandles: ['woodennickel_wv', 'bellygoatburger'],
      allHandles: ['lookoutsantacruz', 'woodennickel_wv', 'bellygoatburger'],
    } as DetectedHandles,
  );
  check(
    'scenario: Top 5 burgers — flagged as roundup, address-free branch must skip',
    r.isRoundup === true,
    `got=${JSON.stringify(r)}`,
  );
}

// ---------------------------------------------------------------------------
// Patch 2 — compactNameMatches: compact handle ↔ spaced canonical name
// ---------------------------------------------------------------------------
check(
  'compactNameMatches: bajasharkeeznb ↔ Baja Sharkeez (region suffix)',
  compactNameMatches('bajasharkeeznb', 'Baja Sharkeez'),
);
check(
  'compactNameMatches: taquerialospericossocial ↔ Taqueria Los Pericos (social suffix)',
  compactNameMatches('taquerialospericossocial', 'Taqueria Los Pericos'),
);
check(
  'compactNameMatches: paradisedynasty ↔ Paradise Dynasty (direct compact)',
  compactNameMatches('paradisedynasty', 'Paradise Dynasty'),
);
check(
  'compactNameMatches: kenosrestaurant ↔ Keno\'s Restaurant (possessive)',
  compactNameMatches('kenosrestaurant', "Keno's Restaurant"),
);
check(
  'compactNameMatches: famousdaves ↔ Famous Dave\'s Bar-B-Que',
  compactNameMatches('famousdaves', "Famous Dave's Bar-B-Que"),
);
check(
  'compactNameMatches: loadedcafe ↔ Loaded Cafe - Orange',
  compactNameMatches('loadedcafe', 'Loaded Cafe - Orange'),
);
check(
  'compactNameMatches: phobamboorestaurant ↔ Pho Bamboo Vietnamese Restaurant (generic strip)',
  compactNameMatches('phobamboorestaurant', 'Pho Bamboo Vietnamese Restaurant'),
);
check(
  'compactNameMatches: aptosstbbq ↔ Aptos St. BBQ (punctuation stripped)',
  compactNameMatches('aptosstbbq', 'Aptos St. BBQ'),
);
// Patch 3: connector words (and/the/of) collapse so `&` ↔ `and` resolves.
check(
  'compactNameMatches: pointmarketandcafe ↔ Point Market & Cafe (and ↔ &)',
  compactNameMatches('pointmarketandcafe', 'Point Market & Cafe'),
);
check(
  'compactNameMatches: POINT MARKET AND CAFE ↔ Point Market & Cafe',
  compactNameMatches('POINT MARKET AND CAFE', 'Point Market & Cafe'),
);
check(
  'compactNameMatches: house of pies ↔ houseofpies',
  compactNameMatches('House of Pies', 'houseofpies'),
);
check(
  'compactNameMatches: Sandwich Spot NOT mangled by "and" stripping',
  compactNameMatches('Sandwich Spot', 'Sandwich Spot'),
);
check(
  'compactNameMatches: Sandwich Spot ↔ unrelated → false',
  !compactNameMatches('Sandwich Spot', 'Panda Express'),
);
// Negative tests — must NOT match unrelated venues.
check(
  'compactNameMatches: bajasharkeeznb ↔ Sushi Spot → false',
  !compactNameMatches('bajasharkeeznb', 'Sushi Spot'),
);
check(
  'compactNameMatches: paradisedynasty ↔ Panda Express → false',
  !compactNameMatches('paradisedynasty', 'Panda Express'),
);
check(
  'compactNameMatches: empty inputs → false',
  !compactNameMatches('', 'Baja Sharkeez') && !compactNameMatches('paradisedynasty', ''),
);
check(
  'compactNameMatches: short stub inputs → false',
  !compactNameMatches('abc', 'Baja Sharkeez'),
);
// Symmetry sanity.
check(
  'compactNameMatches: symmetric for Baja Sharkeez',
  compactNameMatches('Baja Sharkeez', 'bajasharkeeznb') ===
    compactNameMatches('bajasharkeeznb', 'Baja Sharkeez'),
);

// ---------------------------------------------------------------------------
// 2026-05-27 — Patch 8/9 wrong-location guard
// ---------------------------------------------------------------------------
check(
  'extractStateFromFormattedAddress: "...Costa Mesa, CA 92626, USA" → CA',
  extractStateFromFormattedAddress('1525 Mesa Verde Dr E, Costa Mesa, CA 92626, USA') === 'CA',
);
check(
  'extractStateFromFormattedAddress: "...Ferndale, MI 48220, USA" → MI',
  extractStateFromFormattedAddress('22757 Woodward Ave #210, Ferndale, MI 48220, USA') === 'MI',
);
check(
  'extractStateFromFormattedAddress: Toronto address → null',
  extractStateFromFormattedAddress('55 Front St W, Toronto, ON M5J 0G3, Canada') === null,
);
check(
  'extractStateFromFormattedAddress: null input → null',
  extractStateFromFormattedAddress(null) === null,
);
check(
  'isWrongLocationCandidate: Toronto candidate, expected CA → true',
  isWrongLocationCandidate('55 Front St W, Toronto, ON M5J 0G3, Canada', 'CA') === true,
);
check(
  'isWrongLocationCandidate: Michigan candidate, expected CA → true',
  isWrongLocationCandidate('22757 Woodward Ave, Ferndale, MI 48220, USA', 'CA') === true,
);
check(
  'isWrongLocationCandidate: CA candidate, expected CA → false',
  isWrongLocationCandidate('126 Main St, Huntington Beach, CA 92648, USA', 'CA') === false,
);
check(
  'isWrongLocationCandidate: expectedState null → false (do not block)',
  isWrongLocationCandidate('55 Front St W, Toronto, ON M5J 0G3, Canada', null) === false,
);
check(
  'isWrongLocationCandidate: candidate address null → false',
  isWrongLocationCandidate(null, 'CA') === false,
);
check(
  'isWrongLocationCandidate: NY candidate, expected NY → false',
  isWrongLocationCandidate('123 Main St, Brooklyn, NY 11201, USA', 'NY') === false,
);

// ---------------------------------------------------------------------------
// Regression: Instagram Reel CxdY35frOrf — caption venue BEFORE address,
// separated by an em dash + pin. Must extract "Brooklyn City Pizzeria &
// Market" and must NOT let poster/platform noise (Media/Foodie) become the
// venue. See scripts/shareRegressionFixtures.ts.
// ---------------------------------------------------------------------------
const BROOKLYN_CAPTION =
  '🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677';
const BROOKLYN_TITLE =
  'Andrewtrung Le | Foodie 🙂 on Instagram: "🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677 — 🎻Pepperoni Pizza"';
const BROOKLYN_DESC =
  '44 likes, 10 comments - mr.les.munchies on September 21, 2023: "🌃Brooklyn City Pizzeria & Market — 📍30012 Crown Valley Pkwy suite I, Laguna Niguel, CA 92677 —"';

check(
  'A. caption venue-before-pin → "Brooklyn City Pizzeria & Market"',
  extractCaptionVenueHints(BROOKLYN_CAPTION).includes('Brooklyn City Pizzeria & Market'),
  `got=${JSON.stringify(extractCaptionVenueHints(BROOKLYN_CAPTION))}`,
);
check(
  'B. IG title form → includes Brooklyn venue, excludes Foodie/Media/Instagram',
  (() => {
    const hints = extractCaptionVenueHints(BROOKLYN_TITLE);
    return (
      hints.includes('Brooklyn City Pizzeria & Market') &&
      !hints.includes('Foodie') &&
      !hints.includes('Media') &&
      !hints.includes('Instagram')
    );
  })(),
  `got=${JSON.stringify(extractCaptionVenueHints(BROOKLYN_TITLE))}`,
);
check(
  'B2. IG title form → Brooklyn venue ranks FIRST (used as placeNameHint)',
  extractCaptionVenueHints(BROOKLYN_TITLE)[0] === 'Brooklyn City Pizzeria & Market',
  `got=${JSON.stringify(extractCaptionVenueHints(BROOKLYN_TITLE))}`,
);
check(
  'C. IG description form → includes Brooklyn venue',
  extractCaptionVenueHints(BROOKLYN_DESC).includes('Brooklyn City Pizzeria & Market'),
  `got=${JSON.stringify(extractCaptionVenueHints(BROOKLYN_DESC))}`,
);
check(
  'D. generic IG metadata → no Media/Instagram/Foodie/Reel venue hints',
  (() => {
    const generic =
      'Andrewtrung Le | Foodie 🙂 on Instagram: "check out this reel #foodie #reels"';
    const hints = extractCaptionVenueHints(generic);
    return (
      !hints.includes('Media') &&
      !hints.includes('Instagram') &&
      !hints.includes('Foodie') &&
      !hints.includes('Reel')
    );
  })(),
);

// isNoiseHandle: reject platform/CSS/poster noise, keep real venue handles.
check('isNoiseHandle: media (from @media CSS) → true', isNoiseHandle('media') === true);
check('isNoiseHandle: @media → true (strips @)', isNoiseHandle('@media') === true);
check('isNoiseHandle: instagram → true', isNoiseHandle('instagram') === true);
check('isNoiseHandle: foodie → true', isNoiseHandle('foodie') === true);
check('isNoiseHandle: reel/reels → true', isNoiseHandle('reel') === true && isNoiseHandle('reels') === true);
check('isNoiseHandle: media_kitchen → false (substring not matched)', isNoiseHandle('media_kitchen') === false);
check('isNoiseHandle: null/empty → false', isNoiseHandle(null) === false && isNoiseHandle('') === false);
// E. Known-good handles are NOT rejected and still derive their venue names.
check('E. isNoiseHandle: 2nd_floor_hb → false', isNoiseHandle('2nd_floor_hb') === false);
check('E. isNoiseHandle: paradisedynasty_usa → false', isNoiseHandle('paradisedynasty_usa') === false);
check('E. isNoiseHandle: kenos → false', isNoiseHandle('kenos') === false);
check(
  'E. 2nd_floor_hb still → "2nd Floor"',
  derivePlaceNameHintFromHandle('2nd_floor_hb') === '2nd Floor',
);
check(
  'E. paradisedynasty_usa still → "Paradisedynasty"',
  derivePlaceNameHintFromHandle('paradisedynasty_usa') === 'Paradisedynasty',
);

console.log('');
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All recovery-hint tests passed');
