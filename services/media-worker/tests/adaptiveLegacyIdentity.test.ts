import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLegacyCandidateIdentity } from '../../../supabase/functions/process-share-jobs/adaptiveLegacyIdentity.ts';
import { planLegacyMediaFinalization } from '../../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { parseMediaEvidence } from '../../../supabase/functions/process-share-jobs/mediaEvidence.ts';

function evidence(name = 'Silver Lantern Cafe at River Plaza', overrides = {}) {
  const parsed = parseMediaEvidence({ places: [{ name, category: 'cafe', city: 'Westhaven', country: 'Testland',
    address: '42 Lantern Avenue', role: 'primary', confidence: .99,
    explicitEvidence: [{ source: 'caption', value: name + ', 42 Lantern Avenue, Westhaven', timestampSeconds: 0 }],
    inferredEvidence: [], ...overrides }], multipleIntentionalPlaces: false, insufficientEvidence: false });
  if (!parsed.ok) throw new Error('synthetic_evidence_invalid');
  return parsed.value;
}
const candidate = (name = 'Silver Lantern Cafe', overrides = {}) => ({ name, googlePlaceId: 'synthetic-lantern',
  latitude: 42, longitude: -71, formattedAddress: '42 Lantern Avenue, Westhaven, Testland',
  primaryType: 'cafe', types: ['cafe', 'food', 'establishment'], confidenceScore: .96, matchScore: .96,
  reasons: ['address_verified'], ...overrides });

test('legacy address verification cannot bind a parent plaza to its tenant', () => {
  const source = evidence(), parent = candidate('River Plaza', { primaryType: 'shopping_mall', types: ['shopping_mall'] });
  assert.equal(evaluateLegacyCandidateIdentity(parent, source).eligible, false);
  assert.equal(evaluateLegacyCandidateIdentity(candidate(), source).eligible, true);
  const falselyNamedFood = evidence('River Plaza');
  assert.equal(evaluateLegacyCandidateIdentity(parent, falselyNamedFood).reason, 'legacy_parent_category_mismatch');
});

test('name binding permits exact child and explicit locality suffix, never parent suffix or generic brand prefix', () => {
  assert.equal(evaluateLegacyCandidateIdentity(candidate(), evidence('Silver Lantern Cafe Westhaven')).eligible, true);
  assert.equal(evaluateLegacyCandidateIdentity(candidate('River Plaza'), evidence()).eligible, false);
  assert.equal(evaluateLegacyCandidateIdentity(candidate('Silver Lantern'), evidence()).eligible, false);
  assert.equal(evaluateLegacyCandidateIdentity(candidate(), evidence('Silver Lantern Cafe Uptown')).eligible, false);
});

test('prior-only, passing or empty evidence and explicit unit contradiction retain review', () => {
  for (const update of [{ identityEvidenceKind: 'model_prior' }, { role: 'passing_mention' }, { explicitEvidence: [] }]) {
    assert.equal(evaluateLegacyCandidateIdentity(candidate(), evidence('Silver Lantern Cafe', update)).eligible, false);
  }
  assert.equal(evaluateLegacyCandidateIdentity(candidate(undefined, { formattedAddress: '42 Lantern Avenue #50' }), evidence('Silver Lantern Cafe', { address: '42 Lantern Avenue #49' })).reason, 'legacy_unit_conflict');
});

test('opt-in shared finalizer vetoes wrong identity and preserves correct child without changing baseline', () => {
  const groundedEvidence = evidence();
  const run = (c: ReturnType<typeof candidate>, flag?: boolean) => planLegacyMediaFinalization({
    ordinaryResult: { decision: 'candidate_confirmation', safeToAutoSave: false, primaryCandidate: c, candidates: [c], cleanSearchQuery: 'synthetic query' },
    groundedEvidence, sourceGeography: null, requireCandidateIdentity: flag,
  });
  const wrong = candidate('River Plaza', { primaryType: 'shopping_mall', types: ['shopping_mall'] });
  assert.equal(run(wrong).post.action, 'auto_save');
  assert.notEqual(run(wrong, true).post.action, 'auto_save');
  assert.equal(run(candidate(), true).post.action, 'auto_save');
  assert.deepEqual(run(wrong, false), run(wrong));
});
