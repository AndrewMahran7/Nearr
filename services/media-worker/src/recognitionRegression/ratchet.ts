import { RECOGNITION_CATEGORIES, type CaseScore, type FixtureCorrection, type RatchetBaseline, type RecognitionCategory } from './types.js';

function validCorrection(correction: FixtureCorrection): boolean {
  return !!(
    correction.caseId && correction.oldGroundTruth && correction.newGroundTruth && correction.reason &&
    correction.evidence.length && correction.reviewedBy && !Number.isNaN(Date.parse(correction.reviewedAt))
  );
}

export function assertFixtureCorrection(correction: FixtureCorrection): void {
  if (!validCorrection(correction)) throw new Error(`fixture_correction_requires_explicit_review:${correction.caseId || 'unknown'}`);
}

export function diffCases(previous: CaseScore[], current: CaseScore[]): Record<'NEWLY_FIXED' | 'REGRESSED' | 'UNCHANGED_PASS' | 'UNCHANGED_FAIL' | 'AREA_ONLY' | 'TECHNICAL', string[]> {
  const before = new Map(previous.map((score) => [score.caseId, score]));
  const result = { NEWLY_FIXED: [] as string[], REGRESSED: [] as string[], UNCHANGED_PASS: [] as string[], UNCHANGED_FAIL: [] as string[], AREA_ONLY: [] as string[], TECHNICAL: [] as string[] };
  for (const score of current) {
    const old = before.get(score.caseId);
    if (score.classification === 'TECHNICAL_FAILURE') result.TECHNICAL.push(score.caseId);
    else if (score.classification === 'BROAD_AREA_ONLY') result.AREA_ONLY.push(score.caseId);
    if (!old) continue;
    if (!old.exactAt3 && score.exactAt3) result.NEWLY_FIXED.push(score.caseId);
    else if (old.exactAt3 && !score.exactAt3) result.REGRESSED.push(score.caseId);
    else if (old.exactAt3 && score.exactAt3) result.UNCHANGED_PASS.push(score.caseId);
    else result.UNCHANGED_FAIL.push(score.caseId);
  }
  return result;
}

export function enforceRatchet(baseline: RatchetBaseline, scores: CaseScore[], corrections: FixtureCorrection[] = []): void {
  corrections.forEach(assertFixtureCorrection);
  const corrected = new Set(corrections.map((item) => item.caseId));
  const passing = new Set(scores.filter((score) => score.exactAt3).map((score) => score.caseId));
  const regressed = baseline.passingCaseIds.filter((caseId) => !passing.has(caseId) && !corrected.has(caseId));
  if (regressed.length) throw new Error(`ratchet_case_regression:${regressed.join(',')}`);
  for (const category of RECOGNITION_CATEGORIES) {
    const actual = scores.filter((score) => score.category === category && score.exactAt3).length;
    const reviewedRemovals = (baseline.caseContracts ?? []).filter((item) => item.category === category && item.exactAt3 && corrected.has(item.caseId)).length;
    const effectiveMinimum = baseline.perCategoryExactAt3Minimum[category] - reviewedRemovals;
    if (actual < effectiveMinimum) throw new Error(`ratchet_category_regression:${category}:${actual}<${effectiveMinimum}`);
  }
  if (scores.some((score) => score.wrongAutosave)) throw new Error('ratchet_wrong_autosave');
}

export function assertBaselineDoesNotDecrease(previous: RatchetBaseline, next: RatchetBaseline): void {
  const nextPassing = new Set(next.passingCaseIds);
  const nextContractById = new Map((next.caseContracts ?? []).map((item) => [item.caseId, item]));
  const removed = previous.passingCaseIds.filter((caseId) => !nextPassing.has(caseId) && !next.fixtureCorrections.some((correction) => correction.caseId === caseId && validCorrection(correction)));
  if (removed.length) throw new Error(`baseline_passing_cases_removed:${removed.join(',')}`);
  for (const category of RECOGNITION_CATEGORIES) {
    const reviewedRemovals = (previous.caseContracts ?? []).filter((item) => item.category === category && item.exactAt3 && next.fixtureCorrections.some((correction) => correction.caseId === item.caseId && validCorrection(correction)) && (!nextPassing.has(item.caseId) || nextContractById.get(item.caseId)?.category !== category)).length;
    if (next.perCategoryExactAt3Minimum[category] < previous.perCategoryExactAt3Minimum[category] - reviewedRemovals) throw new Error(`baseline_minimum_lowered:${category}`);
  }
}

export function emptyCategoryMinimum(): Record<RecognitionCategory, number> {
  return Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => [category, 0])) as Record<RecognitionCategory, number>;
}
