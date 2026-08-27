import assert from 'node:assert/strict';

import { RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { mediaEvidenceAutoSaveEligible, parseMediaEvidence } from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import { buildRecognitionFunnel } from '../supabase/functions/process-share-jobs/mediaRunDiagnostics';
import { consolidateIdentityAlternativeResults, type MentionResult } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';

function rawPlace(name: string, rank: number, identitySupport: 'exact' | 'strong' | 'weak') {
  return {
    logicalPlaceId: 'scene-1', hypothesisRank: rank,
    hypothesisOrigin: 'independent_multimodal',
    hypothesisPathVersion: 'vayrin-hypothesis-first-2026-08-27.v1',
    identitySupport, geoSupport: 'strong_inferred_geo',
    semanticCategory: 'natural water feature', conflicts: [],
    evidenceBasis: identitySupport === 'weak' ? 'contextual_or_memory_prior' : 'distinctive_visual_match',
    identityEvidenceKind: identitySupport === 'weak' ? 'model_prior' : 'observable',
    name, category: 'waterfall', address: null, city: 'Rotorua', region: 'Bay of Plenty',
    country: 'New Zealand', role: 'primary', confidence: rank === 0 ? 0.81 : 0.62,
    explicitEvidence: [{ timestampSeconds: 2, source: 'frame', value: 'distinctive waterfall and gorge geometry' }],
    inferredEvidence: [], memoryCue: null, memoryCueEvidence: [],
  };
}

const parsed = parseMediaEvidence({
  places: [rawPlace('Okere Falls', 0, 'strong'), rawPlace('Wrong Commercial Result', 1, 'weak')],
  multipleIntentionalPlaces: false, insufficientEvidence: false, warnings: [],
});
if (!parsed.ok) throw new Error(parsed.error);
assert.equal(parsed.ok, true);
assert.equal(parsed.value.places[0]?.hypothesisOrigin, 'independent_multimodal');

const built = buildVenueMentions(parsed.value);
assert.equal(built.mentions.length, 1);
assert.equal(built.mentions[0]?.displayName, 'Okere Falls');
assert.equal(built.mentions[0]?.identityAlternatives?.[0]?.displayName, 'Wrong Commercial Result');

const rc = (id: string, score: number) => ({
  googlePlaceId: id, name: id, formattedAddress: '', confidenceScore: score, evidence: [], reasons: [],
}) as any;
const scoring = (id: string, score: number) => ({
  googlePlaceId: id, name: id, rawScore: score * 100, normalizedScore: score,
  reasons: [], rejected: false, rejectionReason: null,
}) as any;
const variants: MentionResult[] = [
  { mentionId: 'm1', displayName: 'Okere Falls', outcome: 'verified_single', query: 'Okere Falls', candidates: [rc('okere', 0.55)], scoring: [scoring('okere', 0.55)] },
  { mentionId: 'm1:a1', displayName: 'Wrong Commercial Result', outcome: 'verified_single', query: 'wrong', candidates: [rc('wrong', 0.99)], scoring: [scoring('wrong', 0.99)] },
];
const consolidated = consolidateIdentityAlternativeResults(built.mentions, variants)[0]!;
assert.deepEqual(consolidated.candidates.map((candidate) => candidate.googlePlaceId), ['okere', 'wrong']);
assert.equal(consolidated.identityHypotheses?.[0]?.name, 'Okere Falls');
assert.equal(consolidated.identityHypotheses?.[0]?.hypothesisOrigin, 'independent_multimodal');
assert.equal(consolidated.canonicalizationOutcome, 'AMBIGUOUS_CANONICAL');

const noMatch = consolidateIdentityAlternativeResults(built.mentions, [
  { mentionId: 'm1', displayName: 'Okere Falls', outcome: 'no_match', query: 'Okere Falls', candidates: [], scoring: [] },
])[0]!;
assert.equal(noMatch.canonicalizationOutcome, 'NO_CANONICAL_MATCH');
assert.equal(noMatch.identityHypotheses?.[0]?.name, 'Okere Falls');

assert.equal(mediaEvidenceAutoSaveEligible({
  ...parsed.value,
  places: [{
    ...parsed.value.places[0]!, identitySupport: 'weak',
    explicitEvidence: [{ timestampSeconds: 1, source: 'visible_text', value: 'Okere Falls, Rotorua, Bay of Plenty' }],
  }],
}), false);

const funnel = buildRecognitionFunnel({
  vayrin: {
    invoked: true, hardPathEligible: true, hardPathReason: 'no_exact_source_identity',
    hardPathVersion: 'vayrin-hypothesis-first-2026-08-27.v1', hypothesisModel: 'gpt-5.6-sol',
    hypothesisFrameCount: 8, hypothesisCount: 2, topHypothesisNamePresent: true,
    hypothesisGeoStrength: 'strong_inferred_geo', rawFrames: 20, candidateFrames: 14,
    selectedFrames: 8, canonicalizationOutcome: 'deferred_to_edge', canonicalPlacesCalls: 0,
    hardPathCost: 0.13, hardPathLatency: 14_000,
  },
}, parsed.value, 2);
assert.equal(funnel.vayrinInvocation?.hardPathCost, 0.13);
assert.equal(funnel.vayrinInvocation?.selectedFrames, 8);
assert.equal(funnel.vayrinInvocation?.canonicalizationOutcome, 'deferred_to_edge');
assert.match(RECOGNITION_VERSION, /v4-core/);

console.log('PASS Vayrin hypothesis-first Edge provenance, ranking, cache, safety, and telemetry contracts');
