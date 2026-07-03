/**
 * scripts/testPlatformNoise.ts
 *
 * Assertions for the TikTok platform-noise fixes:
 *   - isPlatformNoiseName / isPlatformBoilerplateSeed (lib/shareAgent/platformNoise)
 *   - cleanPlacesSeed strips TikTok boilerplate (lib/shareAgent/queryCleaner)
 *   - buildCleanPlacesQueries produces a NOVA Kitchen & Bar query and NEVER
 *     a "TikTok" query.
 *
 * Covers task test cases A (generic title → no TikTok query), B (NOVA venue
 * hint), C (platform candidates rejected). D/E (decision floor / Capo) live
 * in the resolver and are validated by remote tests.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlatformNoise.ts
 */

import {
  isPlatformNoiseName,
  isPlatformBoilerplateSeed,
} from '../lib/shareAgent/platformNoise';
import { cleanPlacesSeed, buildCleanPlacesQueries } from '../lib/shareAgent/queryCleaner';

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
// C. Platform-noise candidate names — rejected for TikTok source only
// ---------------------------------------------------------------------------
check('TikTok Inc. is noise (tiktok)', isPlatformNoiseName('TikTok Inc.', 'tiktok'));
check('Tiktok Verification is noise', isPlatformNoiseName('Tiktok Verification', 'tiktok'));
check(
  'The Short Media - TikTok Marketing Agency is noise',
  isPlatformNoiseName('The Short Media - TikTok Marketing Agency in USA', 'tiktok'),
);
check('ByteDance is noise (tiktok)', isPlatformNoiseName('ByteDance', 'tiktok'));
check('"Tik Tok" spaced is noise', isPlatformNoiseName('Tik Tok Shop', 'tiktok'));

check('NOVA Kitchen & Bar is NOT noise', !isPlatformNoiseName('NOVA Kitchen & Bar', 'tiktok'));
check('Capo Leisure House is NOT noise', !isPlatformNoiseName('Capo Leisure House', 'tiktok'));

// Scoped to TikTok only — never fires for Instagram / link / generic.
check('TikTok Inc. NOT noise for instagram', !isPlatformNoiseName('TikTok Inc.', 'instagram'));
check('TikTok Inc. NOT noise for link', !isPlatformNoiseName('TikTok Inc.', 'link'));
check('TikTok Inc. NOT noise for genericWeb', !isPlatformNoiseName('TikTok Inc.', 'genericWeb'));
check('null name is not noise', !isPlatformNoiseName(null, 'tiktok'));

// ---------------------------------------------------------------------------
// Boilerplate seed detection
// ---------------------------------------------------------------------------
check('"TikTok - Make Your Day" is boilerplate', isPlatformBoilerplateSeed('TikTok - Make Your Day'));
check('"tiktok" is boilerplate', isPlatformBoilerplateSeed('tiktok'));
check('"Make Your Day" is boilerplate', isPlatformBoilerplateSeed('make your day'));
check('"NOVA Kitchen & Bar" is NOT boilerplate', !isPlatformBoilerplateSeed('NOVA Kitchen & Bar'));

// ---------------------------------------------------------------------------
// A. cleanPlacesSeed strips TikTok boilerplate → empty (never queried)
// ---------------------------------------------------------------------------
check(
  'cleanPlacesSeed("TikTok - Make Your Day") → empty',
  cleanPlacesSeed('TikTok - Make Your Day').trim() === '',
  JSON.stringify(cleanPlacesSeed('TikTok - Make Your Day')),
);
check(
  'cleanPlacesSeed keeps NOVA caption',
  /nova kitchen/i.test(cleanPlacesSeed('📍NOVA Kitchen & Bar Such a cool asian-fusion restaurant')),
  cleanPlacesSeed('📍NOVA Kitchen & Bar Such a cool asian-fusion restaurant'),
);

// ---------------------------------------------------------------------------
// B. buildCleanPlacesQueries — NOVA venue hint, no TikTok query
// ---------------------------------------------------------------------------
{
  const queries = buildCleanPlacesQueries({
    title: 'TikTok - Make Your Day',
    description: '📍NOVA Kitchen & Bar Such a cool asian-fusion restaurant in OC',
    address: null,
    placeName: 'NOVA Kitchen & Bar',
    city: null,
    max: 6,
  });
  check(
    'B1 queries include "NOVA Kitchen & Bar"',
    queries.some((q) => q === 'NOVA Kitchen & Bar'),
    queries.join(' | '),
  );
  check(
    'B2 queries include the "and" variant',
    queries.some((q) => /nova kitchen and bar/i.test(q)),
    queries.join(' | '),
  );
  check(
    'B3 NO query contains "tiktok"',
    !queries.some((q) => /tik\s*tok/i.test(q)),
    queries.join(' | '),
  );
}

// A. Generic TikTok title with no venue hint → no TikTok query produced.
{
  const queries = buildCleanPlacesQueries({
    title: 'TikTok - Make Your Day',
    description: 'TikTok - Make Your Day',
    address: null,
    placeName: null,
    city: null,
    max: 6,
  });
  check(
    'A1 generic TikTok-only metadata yields NO query',
    queries.length === 0,
    queries.join(' | '),
  );
}

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('All platform-noise assertions passed.');
}
