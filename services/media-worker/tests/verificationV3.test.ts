import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SelectedFrame } from '../src/types/media.js';
import { selectFramesForVayrin } from '../src/vayrin/frameSelection.js';
import { parseVayrinPayload, estimateVayrinCostUsd } from '../src/vayrin/visualGeolocationClient.js';
import {
  VAYRIN_CANDIDATE_VERIFICATION_SCHEMA,
  VAYRIN_CANDIDATE_VERIFICATION_SYSTEM_PROMPT,
  VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT,
} from '../src/vayrin/visualGeolocationPrompt.js';
import {
  classifyExpectedFeature,
  normalizeEvidenceClaim,
  serializeCandidatesForVerificationV3,
  verificationV3AllowsAutoSave,
  verificationV3IdentityEvidenceKind,
  verifyRetrievedCandidatesV3,
  type RawCandidateVerification,
  type VerificationCandidate,
  type VerificationEvidenceClaim,
} from '../src/vayrin/verificationV3.js';

function candidate(overrides: Partial<VerificationCandidate> = {}): VerificationCandidate {
  return {
    candidateId: 'candidate:1',
    candidateName: 'Example Cove',
    initialRank: 1,
    source: 'descriptor_web',
    retrievalStrength: 'strong',
    retrievalEvidence: ['Multiple independent retrieval sources agree.'],
    regionConsistent: true,
    confirmationOnly: true,
    ...overrides,
  };
}

function claim(overrides: Partial<VerificationEvidenceClaim> = {}): VerificationEvidenceClaim {
  return {
    statement: 'Visible limestone cliffs are compatible.',
    state: 'SUPPORTS',
    basis: 'visual',
    strength: 'moderate',
    visibility: 'visible',
    contradictionKind: 'none',
    ...overrides,
  };
}

function evaluation(overrides: Partial<RawCandidateVerification> = {}): RawCandidateVerification {
  return {
    candidateId: 'candidate:1',
    evidence: [claim()],
    visualCompatibility: 'moderate',
    regionCompatibility: 'strong',
    overallVerdict: 'preserve',
    reasonCode: 'SUPPORTED_AND_REGION_CONSISTENT',
    ...overrides,
  };
}

test('1 SUPPORTS evidence is retained', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation()] });
  assert.equal(result.records[0]?.supportingEvidence.length, 1);
  assert.equal(result.records[0]?.verdict, 'PRESERVE');
  assert.equal(verificationV3IdentityEvidenceKind(result.records[0]!), 'observable');
});

test('2 genuine necessarily-visible incompatibility remains CONTRADICTS', () => {
  const item = normalizeEvidenceClaim(claim({
    statement: 'A readable sign names a different place.', state: 'CONTRADICTS', strength: 'strong',
    visibility: 'necessarily_visible', contradictionKind: 'identity_conflict',
  }));
  assert.equal(item.state, 'CONTRADICTS');
});

test('3 UNKNOWN evidence is retained explicitly', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation({
    evidence: [claim({ state: 'UNKNOWN', visibility: 'unknown', contradictionKind: 'viewpoint_uncertain' })],
  })] });
  assert.equal(result.records[0]?.unknownEvidence.length, 1);
});

for (const [index, statement, kind] of [
  ['4', 'The expected landmark is absent due to crop.', 'expected_feature_absent'],
  ['5', 'The expected entrance may be behind the camera.', 'viewpoint_uncertain'],
  ['6', 'Weather differs from common reference images.', 'appearance_variation'],
  ['7', 'Seasonal vegetation has a different color.', 'appearance_variation'],
  ['8', 'This drone view differs from the common ground angle.', 'viewpoint_uncertain'],
  ['9', 'The feature is partially occluded.', 'viewpoint_uncertain'],
  ['10', 'The scene is night rather than day.', 'appearance_variation'],
] as const) {
  test(`${index} viewpoint-dependent evidence normalizes to UNKNOWN`, () => {
    const normalized = normalizeEvidenceClaim(claim({
      statement, state: 'CONTRADICTS', strength: 'strong', visibility: 'not_visible', contradictionKind: kind,
    }));
    assert.equal(normalized.state, 'UNKNOWN');
  });
}

test('11 absent feature classification defaults to UNKNOWN', () => {
  assert.equal(classifyExpectedFeature({ observed: false, incompatible: false, necessarilyVisible: false }), 'UNKNOWN');
});

test('12 direct impossible geometry can be CONTRADICTS', () => {
  assert.equal(classifyExpectedFeature({ observed: true, incompatible: true, necessarilyVisible: true }), 'CONTRADICTS');
});

test('13 Stiniva-style credible rank-one retrieval survives absent geometry rejection', () => {
  const stiniva = candidate({ candidateName: 'Stiniva Cove' });
  const result = verifyRetrievedCandidatesV3({ candidates: [stiniva], evaluations: [evaluation({
    evidence: [claim({
      statement: 'The narrow entrance is not visible in these selected frames.', state: 'CONTRADICTS',
      strength: 'strong', visibility: 'not_visible', contradictionKind: 'expected_feature_absent',
    })],
    visualCompatibility: 'unknown', overallVerdict: 'reject', reasonCode: 'EXPECTED_GEOMETRY_ABSENT',
  })] });
  assert.notEqual(result.records[0]?.verdict, 'REJECT');
  assert.equal(result.records[0]?.finalRank, 1);
  assert.equal(result.records[0]?.unknownEvidence[0]?.state, 'UNKNOWN');
  assert.equal(verificationV3IdentityEvidenceKind(result.records[0]!), 'model_prior');
});

test('14 strong retrieval cannot be overridden by one weak semantic conflict', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation({
    evidence: [claim({ state: 'CONTRADICTS', strength: 'weak', visibility: 'visible', contradictionKind: 'visible_feature_conflict' })],
    overallVerdict: 'reject',
  })] });
  assert.notEqual(result.records[0]?.verdict, 'REJECT');
});

test('15 strong visible identity conflict may reject', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation({
    evidence: [claim({
      statement: 'A readable sign names a different exact attraction.', state: 'CONTRADICTS', basis: 'canonical_identity',
      strength: 'strong', visibility: 'necessarily_visible', contradictionKind: 'identity_conflict',
    })], overallVerdict: 'reject', reasonCode: 'VISIBLE_IDENTITY_CONFLICT',
  })] });
  assert.equal(result.records[0]?.verdict, 'REJECT');
});

test('15b any surviving strong direct contradiction remains confirmation-only', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation({
    evidence: [
      claim(),
      claim({
        statement: 'A necessarily visible sign names another place.', state: 'CONTRADICTS',
        basis: 'canonical_identity', strength: 'strong', visibility: 'necessarily_visible',
        contradictionKind: 'identity_conflict',
      }),
    ],
    overallVerdict: 'demote',
  })] });
  assert.notEqual(result.records[0]?.verdict, 'REJECT');
  assert.equal(verificationV3IdentityEvidenceKind(result.records[0]!), 'model_prior');
});

test('16 every candidate receives an explicit record even when the model omits it', () => {
  const candidates = [candidate(), candidate({ candidateId: 'candidate:2', candidateName: 'Second Cove', initialRank: 2 })];
  const result = verifyRetrievedCandidatesV3({ candidates, evaluations: [evaluation()] });
  assert.equal(result.records.length, 2);
  assert.equal(result.missingEvaluationCount, 1);
  assert.equal(result.records[1]?.reasonCode, 'MISSING_EVALUATION_PRESERVED');
});

test('17 outside shortlist is blocked while a credible candidate remains', () => {
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation()] });
  assert.equal(result.outsideShortlistAllowed, false);
});

test('18 outside shortlist is allowed after strong direct rejection of every candidate', () => {
  const rejected = evaluation({
    evidence: [claim({ state: 'CONTRADICTS', basis: 'canonical_identity', strength: 'strong',
      visibility: 'necessarily_visible', contradictionKind: 'identity_conflict' })],
    visualCompatibility: 'weak', overallVerdict: 'reject',
  });
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [rejected] });
  assert.equal(result.outsideShortlistAllowed, true);
});

test('18b outside shortlist is allowed when every candidate is visually weak without observational support', () => {
  const weak = evaluation({
    evidence: [], visualCompatibility: 'weak', regionCompatibility: 'unknown',
    overallVerdict: 'reject', reasonCode: 'NO_OBSERVATIONAL_MATCH',
  });
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [weak] });
  assert.equal(result.records[0]?.verdict, 'PRESERVE');
  assert.equal(result.outsideShortlistAllowed, true);
});

test('19 candidate cap is eight', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => candidate({
    candidateId: `candidate:${index}`, candidateName: `Candidate ${index}`, initialRank: index + 1,
  }));
  assert.equal(verifyRetrievedCandidatesV3({ candidates, evaluations: [] }).records.length, 8);
});

test('20 duplicate evidence is removed', () => {
  const duplicate = claim();
  const result = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation({ evidence: [duplicate, duplicate] })] });
  assert.equal(result.records[0]?.supportingEvidence.length, 1);
});

test('21 candidate identity survives serialization', () => {
  const serialized = JSON.parse(serializeCandidatesForVerificationV3([candidate()])) as Array<Record<string, unknown>>;
  assert.equal(serialized[0]?.candidateId, 'candidate:1');
  assert.equal(serialized[0]?.candidateName, 'Example Cove');
});

test('22 V3 alone can never authorize auto-save', () => {
  const record = verifyRetrievedCandidatesV3({ candidates: [candidate()], evaluations: [evaluation()] }).records[0]!;
  assert.equal(verificationV3AllowsAutoSave(record), false);
});

test('23 global prompt is candidate-blind while legacy verification remains bounded', () => {
  assert.match(VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT, /blind to Google Places candidates/);
  assert.match(VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT, /First determine WHAT KIND OF PLACE/);
  assert.doesNotMatch(VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT, /retrieved candidate shortlist/i);
  assert.match(VAYRIN_CANDIDATE_VERIFICATION_SYSTEM_PROMPT, /at most three short/i);
  assert.equal(VAYRIN_CANDIDATE_VERIFICATION_SCHEMA.properties.retrieved_candidate_evaluations.items.properties.evidence.maxItems, 3);
});

test('24 structured V3 output parses', () => {
  const parsed = parseVayrinPayload({
    place_hypotheses: [], multiple_distinct_places_visible: false, additional_place_segments: [],
    metadata_was_sufficient: false,
    retrieved_candidate_evaluations: [{
      candidateId: 'candidate:1', evidence: [claim()], visualCompatibility: 'moderate',
      regionCompatibility: 'strong', overallVerdict: 'preserve', reasonCode: 'SUPPORTED',
    }],
    outside_candidate_proposals: [],
  });
  assert.equal(parsed?.retrieved_candidate_evaluations?.[0]?.candidateId, 'candidate:1');
});

test('24b compact verification-only output parses without freeform hypothesis fields', () => {
  const parsed = parseVayrinPayload({
    retrieved_candidate_evaluations: [{
      candidateId: 'candidate:1', evidence: [claim()], visualCompatibility: 'moderate',
      regionCompatibility: 'strong', overallVerdict: 'preserve', reasonCode: 'SUPPORTED',
    }],
    outside_candidate_proposals: [],
  });
  assert.deepEqual(parsed?.place_hypotheses, []);
  assert.equal(parsed?.retrieved_candidate_evaluations?.[0]?.candidateId, 'candidate:1');
});

test('25 cost telemetry remains computable', () => {
  assert.equal(estimateVayrinCostUsd({ inputTokens: 1000, outputTokens: 100, reasoningTokens: 50, totalTokens: 1100, cachedInputTokens: 0 },
    { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 }), 0.008);
});

test('26 bounded diverse frame selection spans time and avoids repeat starvation', () => {
  const frames: SelectedFrame[] = Array.from({ length: 12 }, (_, index) => ({
    timestampSeconds: index, path: `frame-${index}.jpg`, width: 768, height: 432,
    reason: index === 0 ? 'first' : index === 11 ? 'last' : 'interval',
    aHash: index < 6 ? '0000000000000000' : `${index.toString(16).padStart(16, 'f')}`.slice(-16),
  }));
  const selected = selectFramesForVayrin(frames, 'diverse', 6);
  assert.equal(selected.frames.length, 6);
  assert.equal(selected.frames[0]?.timestampSeconds, 0);
  assert.equal(selected.frames.at(-1)?.timestampSeconds, 11);
  assert.ok(new Set(selected.frames.map((frame) => frame.timestampSeconds)).size === 6);
});
