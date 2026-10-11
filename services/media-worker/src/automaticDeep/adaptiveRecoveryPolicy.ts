import type { AnalyzeOutput } from '../providers/model.js';
import type { PremiumRecognitionExecution } from '../premium/premiumRecognitionTypes.js';
import type { FrameSet } from '../solParity/types.js';

/** A successful empty first result can abstain when the recovery has no new
 * frames. This is an experimental stopping policy, not proof of a negative. A
 * different prompt can still find a place; paired evaluation must measure that
 * risk. Technical errors, tentative identities and multi-place intent recover. */
export function canStopWithoutNewEvidence(
  normal: AnalyzeOutput, first: PremiumRecognitionExecution,
  frameSets: { F1: FrameSet; F2: FrameSet },
): boolean {
  if (normal.recognitionFailureClass || normal.evidence.insufficientEvidence !== true ||
      normal.evidence.places.length || normal.evidence.partialPlaces?.length ||
      normal.evidence.multipleIntentionalPlaces ||
      first.outcome !== 'PREMIUM_NO_USEFUL_RESULT' || first.failureCode || first.destinations.length ||
      first.telemetry.solBoundary?.parseSuccess !== true ||
      first.telemetry.solBoundary.parseFailureCode || !frameSets.F1.frames.length || !frameSets.F2.frames.length) return false;
  return frameSets.F2.frames.every((frame) => frameSets.F1.frames.some((seen) =>
    seen.path === frame.path && seen.timestampSeconds === frame.timestampSeconds && seen.aHash === frame.aHash));
}
