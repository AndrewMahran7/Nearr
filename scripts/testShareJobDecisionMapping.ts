import assert from 'node:assert/strict';
import { planFromResolverDecision } from '../supabase/functions/process-share-jobs/decisionMapping';

assert.deepEqual(planFromResolverDecision({
  decision: 'auto_save', safeToAutoSave: true, hasPrimaryCandidate: true, candidateCount: 1,
}), { route: 'auto_save' });

assert.equal(planFromResolverDecision({
  decision: 'auto_save', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 1,
}).route, 'needs_help');

const confirmation = planFromResolverDecision({
  decision: 'candidate_confirmation', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 1,
});
assert.equal(confirmation.route, 'needs_help');
assert.equal(confirmation.route === 'needs_help' ? confirmation.mode : null, 'single');

const picker = planFromResolverDecision({
  decision: 'candidate_picker', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 3,
});
assert.equal(picker.route, 'needs_help');
assert.equal(picker.route === 'needs_help' ? picker.mode : null, 'picker');

const multi = planFromResolverDecision({
  decision: 'multi_candidate_confirmation', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 3,
});
assert.equal(multi.route, 'needs_help');
assert.equal(multi.route === 'needs_help' ? multi.mode : null, 'multi');

const manual = planFromResolverDecision({
  decision: 'manual_fallback',
  safeToAutoSave: false,
  hasPrimaryCandidate: false,
  candidateCount: 0,
  cleanSearchQuery: 'Nova Kitchen Bar Arlington',
});
assert.equal(manual.route, 'needs_help');
assert.equal(manual.route === 'needs_help' ? manual.mode : null, 'manual');
assert.equal(manual.route === 'needs_help' ? manual.suggestedQuery : null, 'Nova Kitchen Bar Arlington');

const failed = planFromResolverDecision({
  decision: 'failed', safeToAutoSave: false, hasPrimaryCandidate: false, candidateCount: 0, failureReason: 'no_candidates',
});
assert.equal(failed.route, 'needs_help');
assert.equal(failed.route === 'needs_help' ? failed.mode : null, 'manual');

console.log('PASS share-job resolver decision mapping');
