import * as assert from 'assert';

import {
  buildShareJobRequest,
  classifyRecognition,
  loadTutorialCorpus,
  qualificationInfrastructureFailure,
  recordFreshQualificationJob,
  tutorialEntries,
  validateTutorialCorpus,
  type RecognitionObservation,
} from './tutorialRecognitionCorpus';
import { TUTORIAL_RECOGNITION_SAFETY_FIXTURES } from './tutorialRecognitionSafetyFixtures';

const corpus = loadTutorialCorpus();
assert.deepStrictEqual(validateTutorialCorpus(corpus), []);

const entries = tutorialEntries(corpus);
for (const platform of ['instagram', 'tiktok', 'facebook', 'youtube']) {
  assert.ok(entries.some((entry) => entry.platform === platform), `missing ${platform} tutorial audit entry`);
}

const eligibilityProbe = JSON.parse(JSON.stringify(corpus)) as typeof corpus;
const eligibilityEntry = eligibilityProbe.entries.find(
  (entry) => entry.id === 'instagram_dorset_quarry_visual_candidate_01',
)!;
eligibilityEntry.tutorial!.eligibility = 'primary';
eligibilityEntry.tutorial!.qualification = {
  lastQualifiedAt: '2026-09-08T00:00:00.000Z',
  attempts: 2,
  freshJobs: 2,
  mediaFallbackObserved: 2,
  correct: 2,
  controlledNonSuccess: 0,
  wrong: 0,
  wrongSave: 0,
  infrastructureFailure: 0,
  medianLatencyMs: 1000,
};
assert.ok(
  validateTutorialCorpus(eligibilityProbe).some((error) => error.includes('at least three fresh')),
  'two successful jobs cannot qualify a primary fixture',
);
eligibilityEntry.tutorial!.qualification = {
  ...eligibilityEntry.tutorial!.qualification,
  attempts: 3,
  freshJobs: 3,
  mediaFallbackObserved: 3,
  correct: 3,
};
assert.deepStrictEqual(validateTutorialCorpus(eligibilityProbe), []);
eligibilityEntry.tutorial!.sourceHealth!.status = 'degraded';
assert.ok(
  validateTutorialCorpus(eligibilityProbe).some((error) => error.includes('healthy timestamped source identity')),
  'degraded source health cannot qualify a primary fixture',
);

const base: RecognitionObservation = {
  terminalStatus: 'completed',
  decision: 'candidate_confirmation',
  returnedGooglePlaceIds: ['expected-id'],
  savedGooglePlaceIds: [],
  sourceAvailable: true,
  infrastructureFailure: null,
};

assert.strictEqual(classifyRecognition('expected-id', base).outcome, 'pass');
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, decision: 'auto_save' }).outcome,
  'controlled_non_success',
  'auto_save is not a pass until the expected saved result is observable',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, decision: 'auto_save', savedGooglePlaceIds: ['expected-id'] }).outcome,
  'pass',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, decision: 'manual_fallback', returnedGooglePlaceIds: [] }).outcome,
  'controlled_non_success',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, returnedGooglePlaceIds: ['valid-but-wrong-id'] }).outcome,
  'hard_fail',
  'a structurally valid but semantically wrong singleton must hard-fail',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, savedGooglePlaceIds: ['wrong-saved-id'] }).outcome,
  'hard_fail',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, sourceAvailable: false }).outcome,
  'infrastructure_failure',
);
assert.strictEqual(
  classifyRecognition('expected-id', { ...base, infrastructureFailure: 'timeout' }).outcome,
  'infrastructure_failure',
);
assert.strictEqual(
  qualificationInfrastructureFailure({
    status: 'failed',
    failureCategory: 'technical_failure',
    failureCode: 'fresh_recognition_unavailable',
  }),
  'fresh_recognition_unavailable',
);
assert.strictEqual(
  qualificationInfrastructureFailure({ status: 'needs_help', needsHelpReason: 'no_candidates' }),
  null,
  'a safe recognition non-success is not an infrastructure failure',
);

const request = buildShareJobRequest('https://www.instagram.com/reel/example/', 'tutorial-test-1');
assert.deepStrictEqual(Object.keys(request).sort(), ['clientRequestId', 'qualificationMode', 'url']);
assert.strictEqual(request.qualificationMode, 'fresh_media');
assert.ok(!JSON.stringify(request).includes('expected-id'), 'ground truth must never enter the recognition request');

const seenQualificationJobs = new Set<string>();
assert.strictEqual(recordFreshQualificationJob('fresh-job-1', false, seenQualificationJobs), 'fresh-job-1');
assert.throws(
  () => recordFreshQualificationJob('duplicate-job', true, seenQualificationJobs),
  /duplicate_job_returned:duplicate-job/,
);
assert.throws(
  () => recordFreshQualificationJob('fresh-job-1', false, seenQualificationJobs),
  /non_independent_job_id_reused:fresh-job-1/,
);
assert.throws(
  () => recordFreshQualificationJob(undefined, false, seenQualificationJobs),
  /create_share_job_missing_job_id/,
);

const dangerousClasses = [
  'creator_identity_mistaken_for_venue',
  'tagged_collaborator_mistaken_for_venue',
  'same_name_wrong_city',
  'multiple_branches',
  'roundup_or_list',
  'weak_handle_only_evidence',
  'deleted_private_unavailable_source',
  'redirect_or_provider_page',
  'structurally_valid_wrong_singleton',
] as const;
for (const dangerousClass of dangerousClasses) {
  assert.ok(
    TUTORIAL_RECOGNITION_SAFETY_FIXTURES.some((fixture) => fixture.riskClass === dangerousClass),
    `missing safety coverage marker: ${dangerousClass}`,
  );
}
for (const fixture of TUTORIAL_RECOGNITION_SAFETY_FIXTURES) {
  assert.strictEqual(
    classifyRecognition(fixture.expectedGooglePlaceId, fixture.observation).outcome,
    fixture.expectedOutcome,
    fixture.id,
  );
}

console.log(`PASS tutorial corpus schema (${entries.length} audited tutorial sources)`);
console.log('PASS qualification outcome safety rules');
console.log('PASS ground truth excluded from recognition request');
console.log('PASS fresh qualification job enforcement');
console.log('PASS three-run and source-health eligibility gates');
