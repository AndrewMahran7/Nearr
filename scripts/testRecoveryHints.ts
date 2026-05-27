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
  extractMallContextLabel,
  extractVenueHandleCandidates,
  isGenericAddressCard,
  isMallContextHandle,
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

console.log('');
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All recovery-hint tests passed');
