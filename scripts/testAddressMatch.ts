/**
 * scripts/testAddressMatch.ts
 *
 * Standalone assertions for the address comparator +
 * compareCandidateToEvidence scoring. Targets the regression that
 * caused `126 Main St` (caption) to be reported as `address=miss`
 * against `126 Main St, Huntington Beach, CA 92648, USA` (Places).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testAddressMatch.ts
 */

import {
  addressesMatch,
  compareCandidateToEvidence,
} from '../lib/shareAgent/tools';

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
// addressesMatch — formatting/abbreviation tolerance
// ---------------------------------------------------------------------------

check(
  '126 Main St vs Google formatted (ZIP + country)',
  addressesMatch('126 Main St', '126 Main St, Huntington Beach, CA 92648, USA'),
);
check(
  'St → Street suffix expansion',
  addressesMatch('126 Main Street', '126 Main St, Huntington Beach, CA 92648, USA'),
);
check(
  'Street → St suffix contraction',
  addressesMatch('126 Main St', '126 Main Street, Huntington Beach, CA 92648, USA'),
);
check(
  'Ave ↔ Avenue',
  addressesMatch('500 Sunset Ave', '500 Sunset Avenue, Los Angeles, CA 90028, USA'),
);
check(
  'Blvd ↔ Boulevard',
  addressesMatch('1 Wilshire Boulevard', '1 Wilshire Blvd, Los Angeles, CA, USA'),
);
check(
  'Different street number rejected',
  !addressesMatch('128 Main St', '126 Main St, Huntington Beach, CA 92648, USA'),
);
check(
  'Different street name rejected',
  !addressesMatch('126 Oak St', '126 Main St, Huntington Beach, CA 92648, USA'),
);
check(
  'Missing street number rejected (no false positive on just "Main St")',
  !addressesMatch('Main St', '126 Main St, Huntington Beach, CA 92648, USA'),
);
check(
  'Null/empty rejected',
  !addressesMatch(null, '126 Main St, Huntington Beach, CA 92648, USA') &&
    !addressesMatch('126 Main St', null) &&
    !addressesMatch('', ''),
);
check(
  'Unit suffix ignored (Suite/#)',
  addressesMatch(
    '126 Main St Suite 200',
    '126 Main St, Huntington Beach, CA 92648, USA',
  ),
);

// ---------------------------------------------------------------------------
// compareCandidateToEvidence — the exact DYpcd2ZBTsZ regression case.
// ---------------------------------------------------------------------------

const candidate = {
  googlePlaceId: 'ChIJE5pV1UMh3YARIhsItpUt0K8',
  name: '2nd Floor',
  formattedAddress: '126 Main St, Huntington Beach, CA 92648, USA',
  latitude: 33.6595,
  longitude: -117.9988,
  types: ['restaurant'],
};

const withAddress = compareCandidateToEvidence(candidate, {
  placeName: '2nd Floor',
  address: '126 Main St',
  city: 'Huntington Beach',
  state: 'CA',
}).result;
check(
  'caption "126 Main St" + Places "126 Main St, …, USA" → address match',
  withAddress.hasAddressMatch,
  `score=${withAddress.score} nameOverlap=${withAddress.nameOverlap}`,
);
check(
  'score crosses 0.75 places_strong_match floor (was 0.70)',
  withAddress.score >= 0.75,
  `score=${withAddress.score}`,
);
check(
  'name overlap recognised for "2nd Floor"',
  withAddress.nameOverlap >= 0.99,
  `nameOverlap=${withAddress.nameOverlap}`,
);

const withoutAddress = compareCandidateToEvidence(candidate, {
  placeName: '2nd Floor',
  address: null,
  city: 'Huntington Beach',
  state: null,
}).result;
check(
  'no-address path still scores city + name (regression: 0.70)',
  Math.abs(withoutAddress.score - 0.7) < 0.01,
  `score=${withoutAddress.score}`,
);
check(
  'no-address path reports address=miss (no false positive)',
  !withoutAddress.hasAddressMatch,
);

console.log('');
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All address-comparator tests passed');
