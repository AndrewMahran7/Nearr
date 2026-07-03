/**
 * scripts/testGenericCaptionGuard.ts
 *
 * Assertions for the "no explicit place evidence → don't query casual prose"
 * fix. Covers the query-seed layer (lib/shareAgent/queryCleaner):
 *   - isCasualCaptionSeed detects sentiment prose
 *   - buildCleanPlacesQueries never turns casual prose into a query when
 *     allowGenericCaptionSeed=false (no explicit evidence)
 *   - explicit venue / address queries are UNAFFECTED
 *
 * The decision-level gate (manual_fallback when evidence used is empty) lives
 * in the Deno resolver/decisionPolicy and is validated by remote tests.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testGenericCaptionGuard.ts
 */

import {
  buildCleanPlacesQueries,
  isCasualCaptionSeed,
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
// isCasualCaptionSeed — the feedmedangit caption + friends
// ---------------------------------------------------------------------------
check(
  'casual: "pretty cool spot!! glad i stopped by..."',
  isCasualCaptionSeed('pretty cool spot!! glad i stopped by. i wish they had a slightly bigger menu but'),
);
check('casual: "I’ll def be back"', isCasualCaptionSeed("I'll def be back"));
check('casual: "so good must try"', isCasualCaptionSeed('so good must try'));
check('casual: "obsessed with the vibes"', isCasualCaptionSeed('obsessed with the vibes'));
check('NOT casual: "NOVA Kitchen & Bar"', !isCasualCaptionSeed('NOVA Kitchen & Bar'));
check('NOT casual: "Capo Leisure House"', !isCasualCaptionSeed('Capo Leisure House'));

// ---------------------------------------------------------------------------
// A/D. No explicit evidence → casual prose yields NO query
// ---------------------------------------------------------------------------
{
  const queries = buildCleanPlacesQueries({
    title: 'pretty cool spot!! glad i stopped by. i wish they had a slightly bigger menu but',
    description: 'pretty cool spot!! glad i stopped by. i wish they had a slightly bigger menu but',
    address: null,
    placeName: null,
    city: null,
    allowGenericCaptionSeed: false,
    max: 6,
  });
  check('A1 casual prose + no evidence → zero queries', queries.length === 0, queries.join(' | '));
}
{
  // Even if the caller mistakenly allows generic seeds, casual prose is
  // still filtered by the phrase guard.
  const queries = buildCleanPlacesQueries({
    title: 'pretty cool spot glad i stopped by',
    description: null,
    address: null,
    placeName: null,
    allowGenericCaptionSeed: true,
    max: 6,
  });
  check('A2 casual prose filtered even when generic seed allowed', queries.length === 0, queries.join(' | '));
}
{
  // Generic (non-casual) prose is still blocked when no explicit evidence.
  const queries = buildCleanPlacesQueries({
    title: 'the food was amazing today',
    description: null,
    address: null,
    placeName: null,
    allowGenericCaptionSeed: false,
    max: 6,
  });
  check('D1 generic prose + no evidence → zero queries', queries.length === 0, queries.join(' | '));
}

// ---------------------------------------------------------------------------
// B/C. Explicit venue hint → venue queries UNAFFECTED by the gate
// ---------------------------------------------------------------------------
{
  const queries = buildCleanPlacesQueries({
    title: 'TikTok - Make Your Day',
    description: '📍NOVA Kitchen & Bar Such a cool asian-fusion restaurant',
    address: null,
    placeName: 'NOVA Kitchen & Bar',
    city: null,
    allowGenericCaptionSeed: true,
    max: 6,
  });
  check('B1 venue query present', queries.some((q) => q === 'NOVA Kitchen & Bar'), queries.join(' | '));
  check('B2 no tiktok query', !queries.some((q) => /tik\s*tok/i.test(q)), queries.join(' | '));
}
{
  // Capo-style: explicit venue name + city still queries the venue even with
  // the gate off (venue/address steps are never gated).
  const queries = buildCleanPlacesQueries({
    title: 'Capo Leisure House',
    description: 'great spot',
    address: null,
    placeName: 'Capo Leisure House',
    city: 'San Juan Capistrano',
    allowGenericCaptionSeed: false,
    max: 6,
  });
  check(
    'C1 venue+city query present with gate OFF',
    queries.some((q) => /capo leisure house/i.test(q)),
    queries.join(' | '),
  );
}

// ---------------------------------------------------------------------------
// E. Instagram-style explicit address → always builds (gate irrelevant)
// ---------------------------------------------------------------------------
{
  const queries = buildCleanPlacesQueries({
    title: 'dinner last night',
    description: '126 Main St, Huntington Beach, CA',
    address: { raw: '126 Main St', city: 'Huntington Beach', state: 'CA' },
    placeName: null,
    city: 'Huntington Beach',
    allowGenericCaptionSeed: false,
    max: 6,
  });
  check(
    'E1 address query present with gate OFF',
    queries.some((q) => /126 main st/i.test(q)),
    queries.join(' | '),
  );
}

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('All generic-caption-guard assertions passed.');
}
