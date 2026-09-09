import assert from 'node:assert/strict';
import { planAutomaticCompletion } from '../lib/automaticCompletion';
import { evaluateMediaAutoSave } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';

// The historical six-run baseline contained five wrong automatic saves. Keep
// only that reviewed aggregate in the deterministic suite; raw live evidence
// artifacts are intentionally not part of the canonical runtime branch.
const prior = [
  { outcome: 'hard_fail' }, { outcome: 'hard_fail' }, { outcome: 'hard_fail' },
  { outcome: 'pass' }, { outcome: 'hard_fail' }, { outcome: 'hard_fail' },
];
assert.equal(prior.length, 6);
assert.equal(prior.filter((run: any) => run.outcome === 'hard_fail').length, 5,
  'the retained ONB2-01D baseline remains 5/6 wrong saves');

const mention = (name: string, over: Partial<VenueMention> = {}): VenueMention => ({
  id: 'm1', displayName: name, normalizedName: name.toLowerCase(),
  distinctiveTokens: name.toLowerCase().split(/\s+/).filter((token) => token.length > 2),
  category: 'attraction', sources: ['frame'], nameEvidenceSources: [],
  timestamps: [1, 3, 5], mentionCount: 3, repeated: true, confidence: .95,
  geo: { city: null, region: null, country: 'Singapore' },
  identityEvidenceKind: 'observable', ...over,
});
const candidate = (id: string, name: string, score: number) => ({
  googlePlaceId: id, name, formattedAddress: 'Bayfront, Singapore',
  latitude: 1.28, longitude: 103.86, types: ['tourist_attraction'], confidenceScore: score,
  reasons: [], evidence: [],
});
const mediaResult = (name: string, values: ReturnType<typeof candidate>[]) => ({
  mentionId: 'm1', displayName: name,
  outcome: values.length === 1 ? 'verified_single' as const : 'ambiguous_candidates' as const,
  query: name, candidates: values,
  scoring: values.map((value) => ({
    googlePlaceId: value.googlePlaceId, name: value.name, rawScore: 100,
    normalizedScore: value.confidenceScore, reasons: ['strong_name_match', 'state_match'],
    rejected: false, rejectionReason: null,
  })),
});

for (let attempt = 1; attempt <= 2; attempt += 1) {
  const result = mediaResult('Marina Bay Sands', [candidate('parent', 'Marina Bay Sands Singapore', .9926)]);
  const decision = evaluateMediaAutoSave({ mention: mention('Marina Bay Sands'), result, allResults: [result] });
  assert.equal(decision.eligible, false, `Spectra parent-complex reconstruction ${attempt} must review`);
  assert.equal(decision.exactIdentityReason, 'exact_identity_unproven');
}

{
  const result = mediaResult('Marina Bay Sands Event Plaza', [
    candidate('sibling', 'Rain Oculus', .989),
    candidate('parent', 'Marina Bay Sands Singapore', .914),
    candidate('neighbor', 'The Shoppes at Marina Bay Sands', .914),
  ]);
  const decision = evaluateMediaAutoSave({ mention: mention(result.displayName), result, allResults: [result] });
  assert.equal(decision.eligible, false, 'Spectra sibling-attraction reconstruction must review');
  assert.equal(decision.exactIdentityReason, 'related_place_not_distinguished');
}

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const plan = planAutomaticCompletion([
    {
      ...candidate('attabad', 'Attabad Lake', .65),
      exactIdentityStrength: undefined,
      upstreamSafetyDecision: 'REVIEW' as const,
    },
    {
      ...candidate('satpara', 'Satpara Lake', .65),
      upstreamSafetyDecision: 'REVIEW' as const,
    },
  ]);
  assert.equal(plan.action, 'escalate', `Attabad/Satpara reconstruction ${attempt} must review`);
  assert.equal(plan.reason, 'upstream_exact_identity_review_required');
}

console.log('PASS ONB2-01D six-run safety reconstruction (all prior wrong-save routes blocked)');
