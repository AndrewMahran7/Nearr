import type { AnalyzeOutput } from '../providers/model.js';

/** Opt-in review decision after a valid, empty visual/text pass. This does not
 * assert that the source is a negative, and never authorizes a saved identity. */
export function canReviewEmptyEvidence(normal: Pick<AnalyzeOutput, 'evidence' | 'parseDiagnostics' | 'recognitionFailureClass'>): boolean {
  const evidence = normal.evidence;
  const parsed = normal.parseDiagnostics;
  return !normal.recognitionFailureClass && evidence.insufficientEvidence === true &&
    evidence.multipleIntentionalPlaces === false && evidence.places.length === 0 &&
    (evidence.partialPlaces?.length ?? 0) === 0 && parsed != null &&
    parsed.topLevelInvalid === false && parsed.validationErrorClass === 'none' &&
    parsed.emitted === 0 && parsed.accepted === 0 && parsed.rejected === 0 &&
    parsed.partialPreserved === 0;
}
