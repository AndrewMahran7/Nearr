/**
 * Deterministic verification policy for retrieved real-world candidates.
 *
 * The model describes evidence; this module owns survival, rejection, ranking,
 * and outside-shortlist control. A model opinion cannot silently erase a
 * candidate, and absence is never promoted into contradiction without a
 * justified necessarily-visible camera view.
 */

export const VERIFICATION_V3_CANDIDATE_LIMIT = 8;
export const VERIFICATION_V3_USER_CANDIDATE_LIMIT = 3;

export type EvidenceState = 'SUPPORTS' | 'CONTRADICTS' | 'UNKNOWN';
export type EvidenceBasis = 'visual' | 'textual' | 'region' | 'canonical_identity' | 'retrieval';
export type EvidenceStrength = 'strong' | 'moderate' | 'weak';
export type VisibilityAssessment = 'visible' | 'necessarily_visible' | 'not_visible' | 'unknown';
export type ContradictionKind =
  | 'identity_conflict'
  | 'geographic_conflict'
  | 'impossible_geometry'
  | 'visible_feature_conflict'
  | 'expected_feature_absent'
  | 'viewpoint_uncertain'
  | 'appearance_variation'
  | 'none';

export type VerificationEvidenceClaim = {
  statement: string;
  state: EvidenceState;
  basis: EvidenceBasis;
  strength: EvidenceStrength;
  visibility: VisibilityAssessment;
  contradictionKind: ContradictionKind;
};

export type RetrievalStrength = 'strong' | 'moderate' | 'weak';
export type VerificationCandidateSource =
  | 'descriptor_web'
  | 'direct_image'
  | 'canonical_place'
  | 'region_poi'
  | 'metadata';

export type VerificationCandidate = {
  candidateId: string;
  candidateName: string;
  initialRank: number;
  source: VerificationCandidateSource;
  retrievalStrength: RetrievalStrength;
  retrievalEvidence: string[];
  canonicalPlaceId?: string | null;
  locality?: string | null;
  country?: string | null;
  category?: string | null;
  regionConsistent?: boolean;
  confirmationOnly?: boolean;
};

export type RawCandidateVerification = {
  candidateId: string;
  evidence: VerificationEvidenceClaim[];
  visualCompatibility: 'strong' | 'moderate' | 'weak' | 'unknown';
  regionCompatibility: 'strong' | 'moderate' | 'weak' | 'unknown';
  overallVerdict: 'promote' | 'preserve' | 'demote' | 'reject';
  reasonCode: string;
};

export type CandidateVerificationRecord = {
  candidateId: string;
  candidateName: string;
  initialRank: number;
  retrievalSource: VerificationCandidateSource;
  retrievalEvidence: string[];
  supportingEvidence: VerificationEvidenceClaim[];
  contradictingEvidence: VerificationEvidenceClaim[];
  unknownEvidence: VerificationEvidenceClaim[];
  visualCompatibility: RawCandidateVerification['visualCompatibility'];
  regionCompatibility: RawCandidateVerification['regionCompatibility'];
  verdict: 'PROMOTE' | 'PRESERVE' | 'DEMOTE' | 'REJECT';
  reasonCode: string;
  /** Deterministic ordering weight, not calibrated probability. */
  finalScore: number;
  finalRank: number | null;
  rejectionReasonIfAny: string | null;
  confirmationOnly: boolean;
};

export type VerificationV3Result = {
  records: CandidateVerificationRecord[];
  rankedCandidates: VerificationCandidate[];
  outsideShortlistAllowed: boolean;
  missingEvaluationCount: number;
  correctCandidatePolicy: 'preserve_uncertainty_over_false_rejection';
};

function boundedText(value: unknown, max = 320): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeClaims(claims: readonly VerificationEvidenceClaim[]): VerificationEvidenceClaim[] {
  const seen = new Set<string>();
  const output: VerificationEvidenceClaim[] = [];
  for (const claim of claims) {
    const statement = boundedText(claim.statement);
    const key = `${claim.state}:${claim.basis}:${fold(statement)}`;
    if (!statement || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...claim, statement });
    if (output.length >= 16) break;
  }
  return output;
}

/** Missing or viewpoint-dependent expected features are uncertainty. */
export function normalizeEvidenceClaim(claim: VerificationEvidenceClaim): VerificationEvidenceClaim {
  const statement = boundedText(claim.statement);
  const absenceLanguage = /\b(?:absent|missing|not visible|not shown|no visible|does not show|lacks?)\b/i.test(statement);
  const viewpointDependent = claim.contradictionKind === 'expected_feature_absent' ||
    claim.contradictionKind === 'viewpoint_uncertain' ||
    claim.contradictionKind === 'appearance_variation';
  if (claim.state === 'CONTRADICTS' && (
    claim.visibility !== 'necessarily_visible' ||
    viewpointDependent ||
    absenceLanguage
  )) {
    return {
      ...claim,
      statement,
      state: 'UNKNOWN',
      strength: claim.strength === 'strong' ? 'moderate' : claim.strength,
      contradictionKind: viewpointDependent ? claim.contradictionKind : 'expected_feature_absent',
    };
  }
  return { ...claim, statement };
}

export function classifyExpectedFeature(input: {
  observed: boolean;
  incompatible: boolean;
  necessarilyVisible: boolean;
  variationOnly?: boolean;
}): EvidenceState {
  if (input.observed && !input.incompatible) return 'SUPPORTS';
  if (input.incompatible && input.necessarilyVisible && !input.variationOnly) return 'CONTRADICTS';
  return 'UNKNOWN';
}

function strongDirectContradictions(claims: readonly VerificationEvidenceClaim[]): VerificationEvidenceClaim[] {
  return claims.filter((claim) => claim.state === 'CONTRADICTS' &&
    claim.strength === 'strong' && claim.visibility === 'necessarily_visible' &&
    (claim.contradictionKind === 'identity_conflict' ||
      claim.contradictionKind === 'geographic_conflict' ||
      claim.contradictionKind === 'impossible_geometry'));
}

function candidateCredible(candidate: VerificationCandidate): boolean {
  return candidate.retrievalStrength !== 'weak' && (
    candidate.retrievalEvidence.length > 0 ||
    !!candidate.canonicalPlaceId ||
    candidate.regionConsistent === true
  );
}

function scoreCandidate(
  candidate: VerificationCandidate,
  supports: readonly VerificationEvidenceClaim[],
  contradictions: readonly VerificationEvidenceClaim[],
  unknowns: readonly VerificationEvidenceClaim[],
  verdict: CandidateVerificationRecord['verdict'],
): number {
  const retrievalBase = candidate.retrievalStrength === 'strong' ? 72 : candidate.retrievalStrength === 'moderate' ? 58 : 42;
  const sourceBoost = candidate.source === 'direct_image' || candidate.source === 'canonical_place' ? 8
    : candidate.source === 'region_poi' ? 4 : 0;
  const supportBoost = Math.min(18, supports.reduce((total, item) => total +
    (item.strength === 'strong' ? 8 : item.strength === 'moderate' ? 5 : 2), 0));
  const contradictionPenalty = Math.min(40, contradictions.reduce((total, item) => total +
    (item.strength === 'strong' ? 18 : item.strength === 'moderate' ? 9 : 3), 0));
  const uncertaintyPenalty = Math.min(6, unknowns.length);
  const verdictAdjustment = verdict === 'PROMOTE' ? 8 : verdict === 'DEMOTE' ? -10 : verdict === 'REJECT' ? -80 : 0;
  return Math.round(Math.max(0, Math.min(100,
    retrievalBase + sourceBoost + supportBoost - contradictionPenalty - uncertaintyPenalty + verdictAdjustment - candidate.initialRank,
  )));
}

function synthesizedUnknown(candidate: VerificationCandidate): RawCandidateVerification {
  return {
    candidateId: candidate.candidateId,
    evidence: [{
      statement: 'The verifier did not return an evaluation for this retrieved candidate.',
      state: 'UNKNOWN',
      basis: 'retrieval',
      strength: 'weak',
      visibility: 'unknown',
      contradictionKind: 'none',
    }],
    visualCompatibility: 'unknown',
    regionCompatibility: candidate.regionConsistent ? 'moderate' : 'unknown',
    overallVerdict: 'preserve',
    reasonCode: 'MISSING_EVALUATION_PRESERVED',
  };
}

export function verifyRetrievedCandidatesV3(input: {
  candidates: readonly VerificationCandidate[];
  evaluations: readonly RawCandidateVerification[];
}): VerificationV3Result {
  const candidates = input.candidates.slice(0, VERIFICATION_V3_CANDIDATE_LIMIT);
  const evaluations = new Map(input.evaluations.map((item) => [item.candidateId, item]));
  let missingEvaluationCount = 0;
  const provisional = candidates.map((candidate): CandidateVerificationRecord => {
    let evaluation = evaluations.get(candidate.candidateId);
    if (!evaluation) {
      missingEvaluationCount += 1;
      evaluation = synthesizedUnknown(candidate);
    }
    const evidence = dedupeClaims(evaluation.evidence.map(normalizeEvidenceClaim));
    const supports = evidence.filter((item) => item.state === 'SUPPORTS');
    const contradictions = evidence.filter((item) => item.state === 'CONTRADICTS');
    const unknowns = evidence.filter((item) => item.state === 'UNKNOWN');
    const strongContradictions = strongDirectContradictions(contradictions);
    const identityOrRegionConflict = strongContradictions.some((item) =>
      item.contradictionKind === 'identity_conflict' || item.contradictionKind === 'geographic_conflict');
    const credible = candidateCredible(candidate);

    let verdict: CandidateVerificationRecord['verdict'];
    let reasonCode = boundedText(evaluation.reasonCode, 120) || 'MODEL_VERDICT_UNSPECIFIED';
    if (evaluation.overallVerdict === 'reject') {
      const enoughForStrongRetrievalRejection = identityOrRegionConflict || strongContradictions.length >= 2;
      if (credible && !enoughForStrongRetrievalRejection) {
        verdict = contradictions.length > 0 ? 'DEMOTE' : 'PRESERVE';
        reasonCode = contradictions.length > 0
          ? 'WEAK_CONTRADICTION_CANNOT_REMOVE_CREDIBLE_RETRIEVAL'
          : 'ABSENCE_OR_UNKNOWN_CANNOT_REMOVE_CREDIBLE_RETRIEVAL';
      } else if (!credible && strongContradictions.length === 0) {
        verdict = 'DEMOTE';
        reasonCode = 'REJECTION_WITHOUT_STRONG_DIRECT_CONTRADICTION';
      } else {
        verdict = 'REJECT';
      }
    } else if (evaluation.overallVerdict === 'promote' && supports.length > 0) {
      verdict = 'PROMOTE';
    } else if (evaluation.overallVerdict === 'demote') {
      verdict = strongContradictions.length > 0 || !credible ? 'DEMOTE' : 'PRESERVE';
      if (verdict === 'PRESERVE') reasonCode = 'CREDIBLE_RETRIEVAL_PRESERVED_UNDER_UNCERTAINTY';
    } else {
      verdict = 'PRESERVE';
    }

    const finalScore = scoreCandidate(candidate, supports, contradictions, unknowns, verdict);
    return {
      candidateId: candidate.candidateId,
      candidateName: candidate.candidateName,
      initialRank: candidate.initialRank,
      retrievalSource: candidate.source,
      retrievalEvidence: [...new Set(candidate.retrievalEvidence.map((item) => boundedText(item)).filter(Boolean))].slice(0, 8),
      supportingEvidence: supports,
      contradictingEvidence: contradictions,
      unknownEvidence: unknowns,
      visualCompatibility: evaluation.visualCompatibility,
      regionCompatibility: evaluation.regionCompatibility,
      verdict,
      reasonCode,
      finalScore,
      finalRank: null,
      rejectionReasonIfAny: verdict === 'REJECT' ? reasonCode : null,
      confirmationOnly: candidate.confirmationOnly === true || candidate.source === 'region_poi',
    };
  });

  const surviving = provisional.filter((record) => record.verdict !== 'REJECT')
    .sort((a, b) => b.finalScore - a.finalScore || a.initialRank - b.initialRank || a.candidateName.localeCompare(b.candidateName));
  const rankById = new Map(surviving.map((record, index) => [record.candidateId, index + 1]));
  const records = provisional.map((record) => ({ ...record, finalRank: rankById.get(record.candidateId) ?? null }));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const rankedCandidates = surviving.map((record) => candidateById.get(record.candidateId)!).filter(Boolean);
  const outsideShortlistAllowed = records.length > 0 && records.every((record) => {
    const observationalSupports = record.supportingEvidence.filter((item) => item.basis !== 'retrieval');
    return record.verdict === 'REJECT' ||
      (record.visualCompatibility === 'weak' && observationalSupports.length === 0);
  });

  return {
    records,
    rankedCandidates,
    outsideShortlistAllowed,
    missingEvaluationCount,
    correctCandidatePolicy: 'preserve_uncertainty_over_false_rejection',
  };
}

export function serializeCandidatesForVerificationV3(candidates: readonly VerificationCandidate[]): string {
  return JSON.stringify(candidates.slice(0, VERIFICATION_V3_CANDIDATE_LIMIT).map((candidate) => ({
    candidateId: candidate.candidateId,
    candidateName: candidate.candidateName,
    initialRank: candidate.initialRank,
    source: candidate.source,
    retrievalStrength: candidate.retrievalStrength,
    retrievalEvidence: candidate.retrievalEvidence.slice(0, 4),
    canonicalPlaceId: candidate.canonicalPlaceId ?? null,
    locality: candidate.locality ?? null,
    country: candidate.country ?? null,
    category: candidate.category ?? null,
    regionConsistent: candidate.regionConsistent === true,
  })));
}

export function userFacingVerificationCandidates(result: VerificationV3Result): VerificationCandidate[] {
  return result.rankedCandidates.slice(0, VERIFICATION_V3_USER_CANDIDATE_LIMIT);
}

/**
 * V3 never authorizes a save by itself. A supported candidate may proceed to
 * the ordinary canonical resolver and autosave gates, which retain the final
 * decision.
 */
export function verificationV3AllowsAutoSave(_record: CandidateVerificationRecord): false {
  return false;
}

export function verificationV3IdentityEvidenceKind(
  record: CandidateVerificationRecord,
): 'observable' | 'model_prior' {
  if (strongDirectContradictions(record.contradictingEvidence).length > 0) return 'model_prior';
  return record.supportingEvidence.length > 0 ? 'observable' : 'model_prior';
}
