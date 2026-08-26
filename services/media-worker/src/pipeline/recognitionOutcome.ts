import type { AnalyzeOutput } from '../providers/model.js';

export type RecognitionFinalizeOutcome =
  | 'evidence'
  | 'partial_evidence'
  | 'insufficient_evidence'
  | 'failed';

export type RecognitionFinalResult = {
  outcome: RecognitionFinalizeOutcome;
  resultClass: 'canonical_evidence' | 'partial_evidence' | 'genuine_no_evidence' | 'technical_failure';
  failureCode?: 'insufficient_evidence' | 'recognition_recovery_exhausted';
};

/** Pure final-state classifier. Evidence always wins over diagnostics: a
 * malformed sibling must never erase a valid canonical or partial survivor. */
export function classifyRecognitionFinalResult(
  analysis: Pick<AnalyzeOutput, 'evidence' | 'parseDiagnostics' | 'recognitionFailureClass'>,
): RecognitionFinalResult {
  const canonical = analysis.evidence.places.some((place) => place.explicitEvidence.length > 0);
  if (canonical) return { outcome: 'evidence', resultClass: 'canonical_evidence' };

  if ((analysis.evidence.partialPlaces ?? []).some((place) => place.explicitEvidence.length > 0)) {
    return { outcome: 'partial_evidence', resultClass: 'partial_evidence' };
  }

  const technical =
    analysis.parseDiagnostics?.topLevelInvalid === true ||
    analysis.recognitionFailureClass === 'candidate_field_invalid' ||
    analysis.recognitionFailureClass === 'model_schema_invalid' ||
    analysis.recognitionFailureClass === 'model_provider_failure' ||
    analysis.recognitionFailureClass === 'recovery_invalid';

  if (technical) {
    return {
      outcome: 'failed',
      resultClass: 'technical_failure',
      failureCode: 'recognition_recovery_exhausted',
    };
  }

  return {
    outcome: 'insufficient_evidence',
    resultClass: 'genuine_no_evidence',
    failureCode: 'insufficient_evidence',
  };
}
