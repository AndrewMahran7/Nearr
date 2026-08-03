/**
 * scripts/testShareJobsUi.ts
 *
 * Unit tests for lib/shareJobsUi.ts — the pure presentation logic for the queue
 * and confirmation screens. Covers the spec cases:
 *   - queue count matches visible actionable jobs
 *   - "Needs your help" hidden when empty / "Processing" hidden when empty
 *   - terminal jobs remain hidden (never actionable/processing)
 *   - empty queue state
 *   - queue back control returns to previous route OR the map fallback
 *   - small / malformed candidate data does not crash
 *   - already-saved lookup
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testShareJobsUi.ts
 */

import {
  actionableJobs,
  processingJobs,
  actionableCount,
  actionableSectionHeading,
  isQueueEmpty,
  backTarget,
  normalizeShareJobCandidates,
  findSavedPlaceIdByGooglePlaceId,
} from '../lib/shareJobsUi';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const j = (id: string, status: string) => ({ id, status });

// A realistic already-filtered set (filterQueueVisible has run upstream, so no
// completed/cancelled here — but the helpers must still be robust if they slip
// through).
const jobs = [
  j('a', 'needs_help'),
  j('b', 'queued'),
  j('c', 'failed'),
  j('d', 'processing_metadata'),
  j('e', 'needs_help'),
];

// ---- sections + count ------------------------------------------------------
check('actionable = needs_help + failed', actionableJobs(jobs).map((x) => x.id).join(',') === 'a,e,c');
check('needs_help leads before failed', actionableJobs(jobs)[0].status === 'needs_help');
check('processing = queued + processing_metadata', processingJobs(jobs).map((x) => x.id).join(',') === 'b,d');
check('count matches visible actionable jobs (needs_help + failed)', actionableCount(jobs) === 3);
check('count excludes processing jobs', actionableCount(jobs) !== jobs.length);

// ---- sections hidden when empty -------------------------------------------
const onlyProcessing = [j('a', 'queued'), j('b', 'processing_metadata')];
check('Needs-your-help empty when only processing', actionableJobs(onlyProcessing).length === 0);
check('Processing non-empty when processing present', processingJobs(onlyProcessing).length === 2);
check('not empty when processing present', isQueueEmpty(onlyProcessing) === false);

const onlyActionable = [j('a', 'needs_help'), j('b', 'failed')];
check('Processing empty when only actionable', processingJobs(onlyActionable).length === 0);
check('Needs-your-help non-empty when actionable present', actionableJobs(onlyActionable).length === 2);

// ---- terminal jobs never actionable/processing ----------------------------
const withTerminal = [j('a', 'completed'), j('b', 'cancelled'), j('c', 'needs_help')];
check('completed is not actionable', !actionableJobs(withTerminal).some((x) => x.status === 'completed'));
check('cancelled is not actionable', !actionableJobs(withTerminal).some((x) => x.status === 'cancelled'));
check('completed is not processing', !processingJobs(withTerminal).some((x) => x.status === 'completed'));
check('terminal excluded from count', actionableCount(withTerminal) === 1);

// ---- empty state -----------------------------------------------------------
check('empty when no jobs', isQueueEmpty([]) === true);
check('empty when only terminal jobs slip through', isQueueEmpty([j('a', 'completed'), j('b', 'cancelled')]) === true);

// ---- back target -----------------------------------------------------------
check('back when a previous route exists', backTarget(true, '/(tabs)/map').kind === 'back');
check(
  'replace to fallback when trapped',
  (() => {
    const t = backTarget(false, '/(tabs)/map');
    return t.kind === 'replace' && t.route === '/(tabs)/map';
  })(),
);
check(
  'confirmation falls back to the queue',
  (() => {
    const t = backTarget(false, '/share-jobs');
    return t.kind === 'replace' && t.route === '/share-jobs';
  })(),
);

// ---- candidate normalisation (no crash on bad data) -----------------------
check('null candidate input => []', normalizeShareJobCandidates(null).length === 0);
check('non-array candidate input => []', normalizeShareJobCandidates('nope' as unknown).length === 0);
check('object (not array) => []', normalizeShareJobCandidates({ candidates: [] } as unknown).length === 0);
check(
  'rows missing id/name are dropped',
  normalizeShareJobCandidates([{ name: 'No id' }, { googlePlaceId: 'x' }]).length === 0,
);
check(
  'malformed field types are coerced safely',
  (() => {
    const out = normalizeShareJobCandidates([
      {
        googlePlaceId: 'gp1',
        name: 'Cafe',
        formattedAddress: 12345, // wrong type -> null
        latitude: 'nope', // wrong type -> null
        longitude: -122.4,
        types: ['cafe', 7, null], // filters non-strings
        matchScore: 'high', // wrong type -> null
      },
      null,
      42,
    ]);
    if (out.length !== 1) return false;
    const c = out[0];
    return (
      c.googlePlaceId === 'gp1' &&
      c.name === 'Cafe' &&
      c.formattedAddress === null &&
      c.latitude === null &&
      c.longitude === -122.4 &&
      c.types.length === 1 &&
      c.types[0] === 'cafe' &&
      c.matchScore === null
    );
  })(),
);

// ---- already-saved lookup --------------------------------------------------
const savedList = [
  { id: 'sp1', place: { google_place_id: 'gpA' } },
  { id: 'sp2', place: { google_place_id: null } },
  { id: 'sp3', place: { google_place_id: 'gpB' } },
];
check('finds saved id by google place id', findSavedPlaceIdByGooglePlaceId('gpB', savedList) === 'sp3');
check('returns null when not saved', findSavedPlaceIdByGooglePlaceId('gpZ', savedList) === null);
check('returns null for missing place id', findSavedPlaceIdByGooglePlaceId(null, savedList) === null);
check('returns null for missing saved list', findSavedPlaceIdByGooglePlaceId('gpA', null) === null);

// ---- friendly section heading (singular / plural) --------------------------
check('singular heading for 1', actionableSectionHeading(1) === 'One place needs a quick check');
check('singular heading for 0 (defensive)', actionableSectionHeading(0) === 'One place needs a quick check');
check('plural heading for 3', actionableSectionHeading(3) === '3 places need a quick check');
check('plural heading avoids system vocabulary', !/needs_help|candidate|terminal/i.test(actionableSectionHeading(5)));

if (failures > 0) {
  console.error(`\n${failures} share-jobs-ui test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-jobs-ui tests passed.');
