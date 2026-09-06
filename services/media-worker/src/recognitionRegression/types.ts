export const RECOGNITION_REGRESSION_SCHEMA_VERSION = 2 as const;

export const RECOGNITION_CATEGORIES = [
  'FOOD_RESTAURANT',
  'CLIFF_JUMPING',
  'HIKING_TRAIL',
  'LANDMARK',
  'TRAVEL_DESTINATION',
] as const;

export type RecognitionCategory = typeof RECOGNITION_CATEGORIES[number];
export type GroundTruthQuality = 'VERIFIED' | 'HIGH_CONFIDENCE' | 'PROVISIONAL' | 'UNSCORED';
export type IntendedSpecificity = 'SPECIFIC_PHYSICAL_PLACE' | 'BROAD_DESTINATION';
export type ResultClassification =
  | 'EXACT'
  | 'ACCEPTABLE_ALIAS'
  | 'TOP3_EXACT'
  | 'BROAD_AREA_ONLY'
  | 'PARENT_PLACE_FAILURE'
  | 'GENERIC_TYPE_FAILURE'
  | 'WRONG'
  | 'EMPTY'
  | 'TECHNICAL_FAILURE'
  | 'UNSCORED';
export type SafetyDecision = 'AUTO_SAVE' | 'REVIEW' | 'MANUAL_FALLBACK';

export type RegressionCorpusCase = {
  caseId: string;
  category: RecognitionCategory;
  sourceUrl: string;
  sourceCorpus: string;
  sourceCaseId: string | null;
  evidenceFixture: string | null;
  researchOnly: boolean;
  fixtureKind?: 'LIVE_SOURCE' | 'CONTRACT_CONTROL';
};

export type GroundTruthTarget = {
  caseId: string;
  canonicalName: string;
  acceptedAliases: string[];
  latitude: number | null;
  longitude: number | null;
  acceptableRadiusMeters: number | null;
  intendedSpecificity: IntendedSpecificity;
  quality: GroundTruthQuality;
  requiredLocality: string | null;
  parentPlaceNames: string[];
  broaderAreaNames: string[];
  expectedSafetyDecision: 'AUTO_SAVE' | 'REVIEW';
  autoSaveProhibited?: boolean;
  evidenceSources: Array<{ kind: string; reference: string; supports: string }>;
  notes: string | null;
};

export type RankedCandidate = {
  rank: number;
  name: string;
  identityType: string;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  evidenceType: string | null;
  canonicalizationStatus: string | null;
  specificity: 'SPECIFIC_PHYSICAL_PLACE' | 'ADMIN_AREA' | 'BROAD_AREA' | 'GENERIC_TYPE' | 'UNKNOWN';
};

export type RegressionAttempt = {
  schemaVersion: 2;
  runId: string;
  caseId: string;
  category: RecognitionCategory;
  sourceUrl: string;
  recognitionVersion: string;
  evidenceVersion: string;
  modelPath: string;
  acquisitionStatus: 'ACQUIRED' | 'EVIDENCE_REPLAY' | 'ACQUISITION_BLOCKED';
  status: 'COMPLETED' | 'TECHNICAL_FAILURE';
  candidates: RankedCandidate[];
  safetyDecision: SafetyDecision;
  frameManifest: Array<{ timestampSeconds: number; sha256: string }>;
  placesCallCount: number;
  cacheReadUsed: false;
  modelRequests: number;
  apiRequests: number;
  costUsd: number | null;
  latencyMs: number;
  failureCode: string | null;
  persistedAt: string;
};

export type CaseScore = {
  caseId: string;
  category: RecognitionCategory;
  scorable: boolean;
  classification: ResultClassification;
  exactAt1: boolean;
  exactAt3: boolean;
  matchedRank: number | null;
  matchedBy: 'CANONICAL' | 'ALIAS' | 'COORDINATE' | null;
  autoSaveCorrect: boolean;
  wrongAutosave: boolean;
  reviewCorrect: boolean;
};

export type CategoryMetrics = {
  caseCount: number;
  acquired: number;
  scorable: number;
  exactAt1: number;
  exactAt3: number;
  areaOnly: number;
  parentPlace: number;
  genericType: number;
  wrong: number;
  empty: number;
  technical: number;
  wrongAutosaves: number;
};

export type RegressionMetrics = {
  perCategory: Record<RecognitionCategory, CategoryMetrics>;
  microExactAt1: number | null;
  microExactAt3: number | null;
  macroExactAt1: number | null;
  macroExactAt3: number | null;
};

export type FixtureCorrection = {
  caseId: string;
  oldGroundTruth: string;
  newGroundTruth: string;
  reason: string;
  evidence: string[];
  reviewedBy: string;
  reviewedAt: string;
};

export type BaselineCaseContract = {
  caseId: string;
  category: RecognitionCategory;
  groundTruth: string;
  exactAt1: boolean;
  exactAt3: boolean;
  top3: string[];
  classification: ResultClassification;
};

export type RatchetBaseline = {
  schemaVersion: 2;
  recognitionVersion: string;
  recordedAt: string;
  passingCaseIds: string[];
  perCategoryExactAt3Minimum: Record<RecognitionCategory, number>;
  productTargetExactAt3Percent: Record<RecognitionCategory, 100>;
  wrongAutosavesMaximum: 0;
  fixtureCorrections: FixtureCorrection[];
  caseContracts?: BaselineCaseContract[];
};
