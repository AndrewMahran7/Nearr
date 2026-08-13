import assert from 'node:assert/strict';

import {
  METADATA_AUTO_SAVE_RULE_VERSION,
  evaluateMetadataAutoSave,
  formatMetadataAutoSaveDecisionLog,
} from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { planFromResolverDecision } from '../supabase/functions/process-share-jobs/decisionMapping';

const santaFe = {
  googlePlaceId: 'ChIJxRuQrqwv3YARWdKYfs8FIBY',
  name: 'Santa Fe Importers Seal Beach',
  formattedAddress: '12430 Seal Beach Blvd B, Seal Beach, CA 90740, USA',
  latitude: 33.78155760000001,
  longitude: -118.0715926,
  businessStatus: 'OPERATIONAL',
  confidenceScore: 0.6063273449765341,
  reasons: ['business_type', 'meaningful_name_match', 'state_match'],
};

const santaFeDecision = evaluateMetadataAutoSave({
  result: { decision: 'candidate_confirmation', candidates: [santaFe] },
  evidence: {
    isRoundup: false,
    address: { raw: '12430 Seal Beach Blvd B' },
    addresses: [
      { raw: '12430 Seal Beach Blvd B' },
      { raw: '1401 Santa Fe Ave' },
    ],
  },
});

assert.equal(santaFeDecision.ruleVersion, METADATA_AUTO_SAVE_RULE_VERSION);
assert.equal(santaFeDecision.rawCandidateCount, 1);
assert.equal(santaFeDecision.plausibleCandidateCount, 1);
assert.equal(santaFeDecision.selectedProviderId, santaFe.googlePlaceId);
assert.equal(santaFeDecision.confidenceScore, santaFe.confidenceScore);
assert.deepEqual(santaFeDecision.reasonCodes, ['single_plausible_candidate']);
assert.equal(santaFeDecision.eligible, true, 'the exact Santa Fe screenshot shape must auto-save');

const santaFePlan = planFromResolverDecision({
  decision: santaFeDecision.eligible ? 'auto_save' : 'candidate_confirmation',
  safeToAutoSave: santaFeDecision.eligible,
  hasPrimaryCandidate: true,
  candidateCount: 1,
});
assert.deepEqual(santaFePlan, { route: 'auto_save' }, 'Santa Fe cannot become Needs you / Quick Check');

const log = formatMetadataAutoSaveDecisionLog({ jobId: 'santa-fe-job', decision: santaFeDecision });
assert.match(log, /raw_candidate_count=1/);
assert.match(log, /plausible_candidate_count=1/);
assert.match(log, /final_decision=auto_save/);

const cases: Array<[string, Parameters<typeof evaluateMetadataAutoSave>[0], string]> = [
  [
    'explicit location conflict',
    {
      result: { decision: 'candidate_confirmation', candidates: [santaFe] },
      evidence: { address: { raw: '999 Other St' }, addresses: [{ raw: '999 Other St' }] },
    },
    'location_conflict',
  ],
  [
    'multiple provider candidates',
    {
      result: {
        decision: 'candidate_confirmation',
        candidates: [santaFe, { ...santaFe, googlePlaceId: 'other-provider' }],
      },
      evidence: {},
    },
    'multiple_plausible_candidates',
  ],
  [
    'invalid coordinates',
    {
      result: {
        decision: 'candidate_confirmation',
        candidates: [{ ...santaFe, latitude: null }],
      },
      evidence: {},
    },
    'provider_coordinates_invalid',
  ],
  [
    'permanent closure',
    {
      result: {
        decision: 'candidate_confirmation',
        candidates: [{ ...santaFe, businessStatus: 'CLOSED_PERMANENTLY' }],
      },
      evidence: {},
    },
    'provider_permanently_closed',
  ],
  [
    'manual resolver outcome',
    {
      result: { decision: 'manual_fallback', candidates: [santaFe] },
      evidence: {},
    },
    'resolver_manual_fallback',
  ],
];

for (const [name, input, reason] of cases) {
  const decision = evaluateMetadataAutoSave(input);
  assert.equal(decision.eligible, false, `${name} must remain review/manual`);
  assert.ok(
    decision.reasonCodes.includes(reason) || decision.explicitConflictFlags.includes(reason),
    `${name} must preserve its concrete blocker`,
  );
}

console.log('PASS exact Santa Fe metadata auto-save and explicit contradiction gates');
