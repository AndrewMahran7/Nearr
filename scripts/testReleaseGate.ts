import assert from 'node:assert/strict';

const { releaseVerdict, validateReleaseRecord } = require('./lib/releaseGate.js');

const base = {
  previousMainSha: 'a'.repeat(40),
  previousOtaGroup: '11111111-1111-4111-8111-111111111111',
  currentOtaGroup: '22222222-2222-4222-8222-222222222222',
  edgeVersions: { 'process-share-link': 131 },
  railwayDeployment: 'deployment-id@commit',
  migrationLedger: ['20260822000001'],
  rollbackProcedure: 'Republish the previous OTA group to production.',
  deploymentStatus: 'DEPLOYED',
  physicalQa: {
    signedOutColdLaunch: 'PENDING',
    signedInColdLaunch: 'PENDING',
    forceCloseRelaunch: 'PENDING',
    freshOnboardingLaunch: 'PENDING',
  },
};

assert.deepEqual(validateReleaseRecord(base), []);
assert.equal(releaseVerdict(base).verdict, 'DEPLOYED — PHYSICAL COLD-START VALIDATION PENDING');
assert.equal(releaseVerdict(base).healthy, false);
const passed = {
  ...base,
  physicalQa: Object.fromEntries(Object.keys(base.physicalQa).map((key) => [key, 'PASS'])),
};
assert.equal(releaseVerdict(passed).healthy, true);
assert.match(releaseVerdict({ ...base, previousOtaGroup: '' }).verdict, /INVALID RELEASE RECORD/);
console.log('Production release gate contracts passed.');
