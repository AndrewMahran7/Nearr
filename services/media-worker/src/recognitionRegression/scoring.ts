import { RECOGNITION_CATEGORIES, type CaseScore, type GroundTruthTarget, type RankedCandidate, type RegressionAttempt, type RegressionCorpusCase, type RegressionMetrics } from './types.js';

const SCORABLE = new Set(['VERIFIED', 'HIGH_CONFIDENCE']);

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function exactText(value: string, accepted: string[]): boolean {
  const candidate = normalize(value);
  return accepted.some((item) => normalize(item) === candidate);
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function branchMatches(candidate: RankedCandidate, truth: GroundTruthTarget): boolean {
  if (!truth.requiredLocality) return true;
  const location = normalize([candidate.name, candidate.locality, candidate.country].filter(Boolean).join(' '));
  return normalize(truth.requiredLocality).split(' ').every((token) => location.split(' ').includes(token));
}

export function matchCandidate(candidate: RankedCandidate, truth: GroundTruthTarget): 'CANONICAL' | 'ALIAS' | 'COORDINATE' | null {
  const broad = candidate.specificity === 'ADMIN_AREA' || candidate.specificity === 'BROAD_AREA';
  if (truth.intendedSpecificity === 'SPECIFIC_PHYSICAL_PLACE' && (broad || candidate.specificity === 'GENERIC_TYPE')) return null;
  if (!branchMatches(candidate, truth)) return null;
  if (exactText(candidate.name, [truth.canonicalName])) return 'CANONICAL';
  if (exactText(candidate.name, truth.acceptedAliases)) return 'ALIAS';
  if (
    candidate.latitude != null && candidate.longitude != null &&
    truth.latitude != null && truth.longitude != null && truth.acceptableRadiusMeters != null &&
    haversineMeters(candidate.latitude, candidate.longitude, truth.latitude, truth.longitude) <= truth.acceptableRadiusMeters
  ) return 'COORDINATE';
  return null;
}

function hasNamedCandidate(candidates: RankedCandidate[], names: string[]): boolean {
  return candidates.some((candidate) => exactText(candidate.name, names));
}

export function scoreCase(attempt: RegressionAttempt, truth: GroundTruthTarget): CaseScore {
  const scorable = SCORABLE.has(truth.quality);
  if (!scorable) return {
    caseId: attempt.caseId, category: attempt.category, scorable: false, classification: 'UNSCORED',
    exactAt1: false, exactAt3: false, matchedRank: null, matchedBy: null,
    autoSaveCorrect: false, wrongAutosave: false, reviewCorrect: false,
  };
  if (attempt.status === 'TECHNICAL_FAILURE') return {
    caseId: attempt.caseId, category: attempt.category, scorable: true, classification: 'TECHNICAL_FAILURE',
    exactAt1: false, exactAt3: false, matchedRank: null, matchedBy: null,
    autoSaveCorrect: false, wrongAutosave: false, reviewCorrect: attempt.safetyDecision === 'REVIEW',
  };
  const top3 = [...attempt.candidates].sort((a, b) => a.rank - b.rank).slice(0, 3);
  if (!top3.length) return {
    caseId: attempt.caseId, category: attempt.category, scorable: true, classification: 'EMPTY',
    exactAt1: false, exactAt3: false, matchedRank: null, matchedBy: null,
    autoSaveCorrect: false, wrongAutosave: false, reviewCorrect: attempt.safetyDecision === 'REVIEW',
  };
  const matchIndex = top3.findIndex((candidate) => matchCandidate(candidate, truth) !== null);
  const matched = matchIndex >= 0 ? top3[matchIndex]! : null;
  const matchedBy = matched ? matchCandidate(matched, truth) : null;
  const exactAt1 = matchIndex === 0;
  const exactAt3 = matchIndex >= 0;
  let classification: CaseScore['classification'];
  if (matchIndex === 0) classification = matchedBy === 'CANONICAL' ? 'EXACT' : 'ACCEPTABLE_ALIAS';
  else if (matchIndex > 0) classification = 'TOP3_EXACT';
  else if (hasNamedCandidate(top3, truth.parentPlaceNames)) classification = 'PARENT_PLACE_FAILURE';
  else if (top3.some((candidate) => candidate.specificity === 'GENERIC_TYPE')) classification = 'GENERIC_TYPE_FAILURE';
  else if (truth.intendedSpecificity === 'SPECIFIC_PHYSICAL_PLACE' && top3.some((candidate) =>
    candidate.specificity === 'ADMIN_AREA' || candidate.specificity === 'BROAD_AREA' || exactText(candidate.name, truth.broaderAreaNames)
  )) classification = 'BROAD_AREA_ONLY';
  else classification = 'WRONG';
  const autoSave = attempt.safetyDecision === 'AUTO_SAVE';
  const wrongAutosave = autoSave && (!exactAt1 || truth.autoSaveProhibited === true);
  return {
    caseId: attempt.caseId,
    category: attempt.category,
    scorable: true,
    classification,
    exactAt1,
    exactAt3,
    matchedRank: exactAt3 ? matchIndex + 1 : null,
    matchedBy,
    autoSaveCorrect: autoSave && exactAt1 && truth.autoSaveProhibited !== true,
    wrongAutosave,
    reviewCorrect: attempt.safetyDecision === 'REVIEW' && (exactAt3 || truth.expectedSafetyDecision === 'REVIEW'),
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

export function calculateMetrics(corpus: RegressionCorpusCase[], attempts: RegressionAttempt[], scores: CaseScore[]): RegressionMetrics {
  const attemptsByCase = new Map(attempts.map((attempt) => [attempt.caseId, attempt]));
  const perCategory = Object.fromEntries(RECOGNITION_CATEGORIES.map((category) => {
    const categoryCases = corpus.filter((item) => item.category === category);
    const categoryScores = scores.filter((score) => score.category === category);
    const scorable = categoryScores.filter((score) => score.scorable);
    return [category, {
      caseCount: categoryCases.length,
      acquired: categoryCases.filter((item) => attemptsByCase.get(item.caseId)?.acquisitionStatus !== 'ACQUISITION_BLOCKED').length,
      scorable: scorable.length,
      exactAt1: scorable.filter((score) => score.exactAt1).length,
      exactAt3: scorable.filter((score) => score.exactAt3).length,
      areaOnly: scorable.filter((score) => score.classification === 'BROAD_AREA_ONLY').length,
      parentPlace: scorable.filter((score) => score.classification === 'PARENT_PLACE_FAILURE').length,
      genericType: scorable.filter((score) => score.classification === 'GENERIC_TYPE_FAILURE').length,
      wrong: scorable.filter((score) => score.classification === 'WRONG').length,
      empty: scorable.filter((score) => score.classification === 'EMPTY').length,
      technical: scorable.filter((score) => score.classification === 'TECHNICAL_FAILURE').length,
      wrongAutosaves: scorable.filter((score) => score.wrongAutosave).length,
    }];
  })) as RegressionMetrics['perCategory'];
  const scorable = scores.filter((score) => score.scorable);
  const categoryRates1 = RECOGNITION_CATEGORIES.map((category) => rate(perCategory[category].exactAt1, perCategory[category].scorable)).filter((value): value is number => value !== null);
  const categoryRates3 = RECOGNITION_CATEGORIES.map((category) => rate(perCategory[category].exactAt3, perCategory[category].scorable)).filter((value): value is number => value !== null);
  return {
    perCategory,
    microExactAt1: rate(scorable.filter((score) => score.exactAt1).length, scorable.length),
    microExactAt3: rate(scorable.filter((score) => score.exactAt3).length, scorable.length),
    macroExactAt1: categoryRates1.length === RECOGNITION_CATEGORIES.length ? categoryRates1.reduce((sum, value) => sum + value, 0) / categoryRates1.length : null,
    macroExactAt3: categoryRates3.length === RECOGNITION_CATEGORIES.length ? categoryRates3.reduce((sum, value) => sum + value, 0) / categoryRates3.length : null,
  };
}
