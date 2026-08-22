const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const SHA_RE = /^[a-f0-9]{40}$/i;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function readReleaseRecord(file, cwd = process.cwd()) {
  const resolved = path.resolve(cwd, file);
  return { resolved, record: JSON.parse(readFileSync(resolved, 'utf8')) };
}

function validateReleaseRecord(record) {
  const errors = [];
  if (!SHA_RE.test(record?.previousMainSha ?? '')) errors.push('previousMainSha');
  if (!UUID_RE.test(record?.previousOtaGroup ?? '')) errors.push('previousOtaGroup');
  if (!record?.edgeVersions || Object.keys(record.edgeVersions).length === 0) errors.push('edgeVersions');
  if (typeof record?.railwayDeployment !== 'string' || !record.railwayDeployment.trim()) errors.push('railwayDeployment');
  if (!Array.isArray(record?.migrationLedger) || record.migrationLedger.length === 0) errors.push('migrationLedger');
  if (typeof record?.rollbackProcedure !== 'string' || record.rollbackProcedure.trim().length < 12) errors.push('rollbackProcedure');
  for (const key of ['signedOutColdLaunch', 'signedInColdLaunch', 'forceCloseRelaunch']) {
    if (!['PASS', 'PENDING'].includes(record?.physicalQa?.[key])) errors.push(`physicalQa.${key}`);
  }
  if (!['PASS', 'PENDING', 'NOT_REQUIRED'].includes(record?.physicalQa?.freshOnboardingLaunch)) {
    errors.push('physicalQa.freshOnboardingLaunch');
  }
  return errors;
}

function releaseVerdict(record) {
  const errors = validateReleaseRecord(record);
  if (errors.length) return { healthy: false, verdict: `INVALID RELEASE RECORD: ${errors.join(', ')}` };
  const deployed = record.deploymentStatus === 'DEPLOYED' && UUID_RE.test(record.currentOtaGroup ?? '');
  if (!deployed) return { healthy: false, verdict: 'PLANNED — NOT DEPLOYED' };
  const qa = record.physicalQa;
  const physicalPassed =
    qa.signedOutColdLaunch === 'PASS' &&
    qa.signedInColdLaunch === 'PASS' &&
    qa.forceCloseRelaunch === 'PASS' &&
    ['PASS', 'NOT_REQUIRED'].includes(qa.freshOnboardingLaunch);
  return physicalPassed
    ? { healthy: true, verdict: 'DEPLOYED — PHYSICALLY VALIDATED — HEALTHY' }
    : { healthy: false, verdict: 'DEPLOYED — PHYSICAL COLD-START VALIDATION PENDING' };
}

function markReleaseDeployed(file, record, currentOtaGroup) {
  const next = {
    ...record,
    currentOtaGroup,
    deploymentStatus: 'DEPLOYED',
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

module.exports = { markReleaseDeployed, readReleaseRecord, releaseVerdict, validateReleaseRecord };
