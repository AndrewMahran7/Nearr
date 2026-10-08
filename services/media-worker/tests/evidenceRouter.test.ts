import assert from 'node:assert/strict';
import test from 'node:test';
import { routeRecognitionEvidence, type EvidenceRoutingFeatures } from '../src/automaticDeep/evidenceRouter.js';
const base: EvidenceRoutingFeatures = {
  sourceGeography: 'verified', entityRole: 'venue', exactIdentity: 'candidate_bound', canonicalCandidateVerified: true,
  candidateCount: 1, identityAlternativeCount: 0, textSources: ['caption'], visualEvidenceAvailable: true,
  geographyConflict: false, entityConflict: false, upstreamDecision: 'AUTO_SAVE', expectedPlaceCount: 1,
  supportedPlaceCount: 1, unresolvedSegmentCount: 0,
};
for (const [name, changes, route] of [
  ['verified exact identity', {}, 'STRONG'],
  ['caption plus observed geography', { sourceGeography: 'observed', exactIdentity: 'source_named' }, 'MEDIUM'],
  ['visual only', { sourceGeography: 'missing', textSources: [], exactIdentity: 'unproven' }, 'WEAK'],
  ['wrong geography', { geographyConflict: true }, 'CONFLICT'],
  ['sponsor conflict', { entityConflict: true, entityRole: 'brand' }, 'CONFLICT'],
  ['same-name branches', { candidateCount: 2 }, 'AMBIGUOUS'],
  ['strong-looking review', { upstreamDecision: 'REVIEW' }, 'AMBIGUOUS'],
  ['strong-looking rejection', { upstreamDecision: 'REJECT' }, 'CONFLICT'],
  ['partial multi-place', { expectedPlaceCount: 2 }, 'AMBIGUOUS'],
  ['extra invented stop', { supportedPlaceCount: 2 }, 'AMBIGUOUS'],
  ['unresolved segment', { unresolvedSegmentCount: 1 }, 'AMBIGUOUS'],
  ['brand without evidence of physical venue', { entityRole: 'brand' }, 'WEAK'],
] as const) {
  test(`shadow route: ${name}`, () => {
    const result = routeRecognitionEvidence({ ...base, ...changes } as EvidenceRoutingFeatures);
    assert.equal(result.route, route);
    assert.equal(result.authorizesAutosave, false);
    assert.equal(result.mode, 'shadow');
  });
}
