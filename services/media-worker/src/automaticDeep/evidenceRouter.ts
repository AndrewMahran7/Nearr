/** Eval/shadow policy only. No model dispatch or save authority. Features are
 * evidence facts supplied by the caller, never a model's confidence score. */
export type EvidenceRoutingFeatures = {
  sourceGeography: 'verified' | 'observed' | 'missing';
  entityRole: 'venue' | 'location' | 'brand' | 'creator' | 'product' | 'ambiguous';
  exactIdentity: 'candidate_bound' | 'source_named' | 'unproven';
  canonicalCandidateVerified: boolean;
  candidateCount: number;
  identityAlternativeCount: number;
  textSources: readonly ('caption' | 'speech' | 'ocr')[];
  visualEvidenceAvailable: boolean;
  geographyConflict: boolean;
  entityConflict: boolean;
  upstreamDecision: 'AUTO_SAVE' | 'REVIEW' | 'REJECT' | null;
  expectedPlaceCount: number | null;
  supportedPlaceCount: number;
  unresolvedSegmentCount: number;
};
export type EvidenceRoute = {
  version: 'evidence-router.v1-shadow';
  route: 'STRONG' | 'MEDIUM' | 'WEAK' | 'CONFLICT' | 'AMBIGUOUS';
  recommendedStage: 'cheap_verification' | 'visual_verification' | 'deep_verification' | 'review';
  reasons: string[];
  mode: 'shadow';
  authorizesAutosave: false;
};
export function routeRecognitionEvidence(f: EvidenceRoutingFeatures): EvidenceRoute {
  const result = (route: EvidenceRoute['route'], recommendedStage: EvidenceRoute['recommendedStage'], ...reasons: string[]): EvidenceRoute => ({
    version: 'evidence-router.v1-shadow', route, recommendedStage, reasons, mode: 'shadow', authorizesAutosave: false,
  });
  const roleSupportsVenue = f.entityRole === 'venue' || f.entityRole === 'location';
  if (f.geographyConflict || f.entityConflict || f.upstreamDecision === 'REJECT') {
    return result('CONFLICT', 'deep_verification', ...[
      f.geographyConflict && 'source_candidate_geography_conflict',
      f.entityConflict && 'source_entity_role_conflict',
      f.upstreamDecision === 'REJECT' && 'upstream_rejected',
    ].filter((v): v is string => typeof v === 'string'));
  }
  const incomplete = f.unresolvedSegmentCount > 0 ||
    (f.expectedPlaceCount !== null && f.supportedPlaceCount !== f.expectedPlaceCount);
  if (incomplete || f.identityAlternativeCount > 0 || f.candidateCount > 1 || f.upstreamDecision === 'REVIEW') {
    return result('AMBIGUOUS', f.visualEvidenceAvailable ? 'deep_verification' : 'review', ...[
      incomplete && 'incomplete_place_set',
      (f.identityAlternativeCount > 0 || f.candidateCount > 1) && 'unresolved_candidate_identity',
      f.upstreamDecision === 'REVIEW' && 'upstream_review_sticky',
    ].filter((v): v is string => typeof v === 'string'));
  }
  if (f.sourceGeography === 'verified' && roleSupportsVenue &&
      f.exactIdentity === 'candidate_bound' && f.canonicalCandidateVerified && f.candidateCount === 1) {
    return result('STRONG', 'cheap_verification', 'candidate_bound_identity_and_verified_geography');
  }
  if (roleSupportsVenue && f.textSources.length > 0 && f.sourceGeography !== 'missing') {
    return result('MEDIUM', 'visual_verification', 'attributed_text_and_source_geography');
  }
  return result('WEAK', f.visualEvidenceAvailable ? 'deep_verification' : 'review',
    roleSupportsVenue ? 'insufficient_identity_evidence' : 'entity_not_established_as_venue');
}
