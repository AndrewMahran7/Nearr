/**
 * scripts/testManualFallback.ts
 *
 * Unit tests for lib/shareAgent/manualFallback.ts — the pure helpers that
 * power the graceful "manual search is the automatic recovery state" flow
 * on app/share.tsx.
 *
 * These cover the deterministic, RN-free pieces of the fix:
 *   - malformed/partial candidate rows are skipped (never throw at render)
 *   - if zero valid candidates remain, the caller knows to enter manual
 *     fallback
 *   - one invalid + one valid candidate → the valid one is still shown
 *   - a safe, name-led prefill query is derived (never a raw address when a
 *     name exists) and is never auto-submitted (that is enforced at the
 *     call-site; here we only assert derivation)
 *   - the user-facing copy is the friendly inline message, not an alert
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testManualFallback.ts
 */

import {
  MANUAL_FALLBACK_MESSAGE,
  deriveManualFallbackQuery,
  filterRenderableCandidates,
  isRenderableCandidate,
} from '../lib/shareAgent/manualFallback';

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
// isRenderableCandidate
// ---------------------------------------------------------------------------
check(
  'valid candidate (id + name) is renderable',
  isRenderableCandidate({ googlePlaceId: 'abc', name: 'Joe Coffee' }),
);
check(
  'missing googlePlaceId is NOT renderable',
  !isRenderableCandidate({ name: 'Joe Coffee' }),
);
check(
  'empty googlePlaceId is NOT renderable',
  !isRenderableCandidate({ googlePlaceId: '   ', name: 'Joe Coffee' }),
);
check(
  'missing name is NOT renderable',
  !isRenderableCandidate({ googlePlaceId: 'abc' }),
);
check(
  'empty name is NOT renderable',
  !isRenderableCandidate({ googlePlaceId: 'abc', name: '' }),
);
check('null is NOT renderable', !isRenderableCandidate(null));
check('undefined is NOT renderable', !isRenderableCandidate(undefined));
check('non-object is NOT renderable', !isRenderableCandidate('abc' as unknown));
check(
  'numeric googlePlaceId is NOT renderable',
  !isRenderableCandidate({ googlePlaceId: 123 as unknown as string, name: 'X' }),
);

// ---------------------------------------------------------------------------
// filterRenderableCandidates — Task H #7, #8, #10
// ---------------------------------------------------------------------------
{
  // #7 malformed candidate array → invalid rows skipped
  const malformed = [
    { googlePlaceId: 'a', name: 'Valid A' },
    null,
    undefined,
    { name: 'no id' },
    { googlePlaceId: 'b' }, // no name
    { googlePlaceId: '', name: 'empty id' },
  ];
  const res = filterRenderableCandidates(malformed as unknown[]);
  check(
    '#7 malformed array → only the single valid row survives',
    res.valid.length === 1 && (res.valid[0] as { name: string }).name === 'Valid A',
    `valid=${res.valid.length}`,
  );
  check(
    '#7 malformed array → invalidCount counts the 5 skipped rows',
    res.invalidCount === 5,
    `invalidCount=${res.invalidCount}`,
  );
}

{
  // #8 manual search if none remain — all rows invalid → valid is empty,
  // so the caller (enterManualFallback) takes over.
  const allBad = [null, { name: 'x' }, { googlePlaceId: '' }];
  const res = filterRenderableCandidates(allBad as unknown[]);
  check(
    '#8 all-invalid array → zero valid candidates remain',
    res.valid.length === 0 && res.invalidCount === 3,
    `valid=${res.valid.length} invalid=${res.invalidCount}`,
  );
}

{
  // #10 one invalid + one valid → valid candidate shown
  const mixed = [
    { googlePlaceId: '', name: 'broken' },
    { googlePlaceId: 'good', name: 'Good Place' },
  ];
  const res = filterRenderableCandidates(mixed as unknown[]);
  check(
    '#10 one invalid + one valid → exactly the valid candidate is kept',
    res.valid.length === 1 &&
      (res.valid[0] as { googlePlaceId: string }).googlePlaceId === 'good',
    `valid=${JSON.stringify(res.valid)}`,
  );
}

check(
  'null/undefined/non-array input never throws and yields empty',
  filterRenderableCandidates(null).valid.length === 0 &&
    filterRenderableCandidates(undefined).invalidCount === 0 &&
    filterRenderableCandidates('nope' as unknown as unknown[]).valid.length === 0,
);

// ---------------------------------------------------------------------------
// deriveManualFallbackQuery — safe name-led prefill (never auto-submitted)
// ---------------------------------------------------------------------------
check(
  'prefers "<place> <city> <state>" over a raw address',
  deriveManualFallbackQuery({
    placeName: '2nd Floor',
    city: 'Huntington Beach',
    state: 'CA',
    address: '126 Main St',
  }) === '2nd Floor Huntington Beach CA',
  `got=${deriveManualFallbackQuery({ placeName: '2nd Floor', city: 'Huntington Beach', state: 'CA', address: '126 Main St' })}`,
);
check(
  'address-only (no place) falls back to the address',
  deriveManualFallbackQuery({ address: '415 Seabright Ave', city: null, state: null }) ===
    '415 Seabright Ave',
);
check(
  'place + city only (no state) → "<place> <city>"',
  deriveManualFallbackQuery({ placeName: 'Seabright Deli', city: 'Santa Cruz' }) ===
    'Seabright Deli Santa Cruz',
);
check(
  'no explicit signal → empty prefill (box stays empty, never auto-submits)',
  deriveManualFallbackQuery({}) === '' &&
    deriveManualFallbackQuery(null) === '' &&
    deriveManualFallbackQuery(undefined) === '',
);
check(
  'falls back to the raw query only when nothing structured exists',
  deriveManualFallbackQuery({ query: 'some seed' }) === 'some seed',
);
check(
  'does not duplicate a state already present in the joined parts',
  deriveManualFallbackQuery({ placeName: 'Cafe CA', state: 'CA' }) === 'Cafe CA',
  `got=${deriveManualFallbackQuery({ placeName: 'Cafe CA', state: 'CA' })}`,
);

// ---------------------------------------------------------------------------
// MANUAL_FALLBACK_MESSAGE — Task C: friendly inline copy, not a blocking
// "Couldn't save link" alert.
// ---------------------------------------------------------------------------
check(
  'manual fallback copy is the friendly inline message',
  /could.?n.?t identify this place automatically/i.test(MANUAL_FALLBACK_MESSAGE) &&
    /keep the original post attached/i.test(MANUAL_FALLBACK_MESSAGE),
);
check(
  'manual fallback copy is NOT the old blocking-alert language',
  !/couldn.?t save link/i.test(MANUAL_FALLBACK_MESSAGE),
);

// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
  console.log('ALL manual-fallback tests passed.');
  process.exit(0);
} else {
  console.log(`${failures} manual-fallback test(s) FAILED.`);
  process.exit(1);
}
