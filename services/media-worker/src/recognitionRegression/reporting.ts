import path from 'node:path';
import type { CaseScore, GroundTruthTarget, RegressionAttempt } from './types.js';
import type { BaselineCaseContract } from './types.js';
import { writeJsonAtomic } from '../solParity/persistence.js';

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

export function buildCaseDiff(
  previous: BaselineCaseContract[],
  attempts: RegressionAttempt[],
  scores: CaseScore[],
  truthById: Map<string, GroundTruthTarget>,
): Array<{ caseId: string; category: string; status: string; groundTruth: string; previousTop3: string[]; newTop3: string[]; classification: string }> {
  const previousById = new Map(previous.map((item) => [item.caseId, item]));
  const attemptById = new Map(attempts.map((item) => [item.caseId, item]));
  return scores.map((score) => {
    const before = previousById.get(score.caseId);
    const status = score.classification === 'TECHNICAL_FAILURE' ? 'TECHNICAL'
      : score.classification === 'BROAD_AREA_ONLY' ? 'AREA_ONLY'
      : !before ? (score.exactAt3 ? 'NEWLY_FIXED' : 'UNCHANGED_FAIL')
      : before.exactAt3 && !score.exactAt3 ? 'REGRESSED'
      : !before.exactAt3 && score.exactAt3 ? 'NEWLY_FIXED'
      : score.exactAt3 ? 'UNCHANGED_PASS' : 'UNCHANGED_FAIL';
    return {
      caseId: score.caseId,
      category: score.category,
      status,
      groundTruth: truthById.get(score.caseId)?.canonicalName ?? '',
      previousTop3: before?.top3 ?? [],
      newTop3: attemptById.get(score.caseId)?.candidates.slice(0, 3).map((candidate) => candidate.name) ?? [],
      classification: score.classification,
    };
  });
}

export async function persistFailureArtifacts(
  runDir: string,
  attempts: RegressionAttempt[],
  scores: CaseScore[],
  truthById: Map<string, GroundTruthTarget>,
): Promise<void> {
  const attemptById = new Map(attempts.map((item) => [item.caseId, item]));
  for (const score of scores.filter((item) => item.scorable && !item.exactAt3)) {
    const attempt = attemptById.get(score.caseId)!;
    await writeJsonAtomic(path.join(runDir, 'case-results', `${score.caseId}.json`), {
      caseId: score.caseId,
      category: score.category,
      groundTruth: truthById.get(score.caseId)?.canonicalName ?? '',
      returnedTop3: attempt.candidates.slice(0, 3),
      recognitionVersion: attempt.recognitionVersion,
      evidenceVersion: attempt.evidenceVersion,
      modelPath: attempt.modelPath,
      frameManifest: attempt.frameManifest,
      placesCallCount: attempt.placesCallCount,
      classification: score.classification,
      failureClass: score.classification,
      cacheReadUsed: attempt.cacheReadUsed,
    });
  }
}
