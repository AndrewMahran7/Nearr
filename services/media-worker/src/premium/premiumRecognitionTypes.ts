import type { SolCallResult } from '../solParity/model.js';
import type { FrameSet, SourceEvidence } from '../solParity/types.js';

export type PremiumEvidenceBasis =
  | 'DIRECT_VISIBLE_IDENTITY'
  | 'DISTINCTIVE_VISUAL_MATCH'
  | 'SOURCE_TEXT_IDENTITY'
  | 'CONTEXTUAL_OR_MEMORY_PRIOR';

export type PremiumSafetyDecision = 'AUTO_SAVE' | 'REVIEW' | 'NAMED_LEAD' | 'REJECT';
export type PremiumChargeability =
  | 'CHARGEABLE_ACTIONABLE'
  | 'NON_CHARGEABLE_NO_RESULT'
  | 'NON_CHARGEABLE_TECHNICAL_FAILURE';

export type PremiumCanonicalCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
};

export type PremiumCanonicalStatus =
  | 'CANONICAL_EXACT'
  | 'CANONICAL_ALIAS'
  | 'AMBIGUOUS_CANONICAL'
  | 'NAMED_LEAD';

export type PremiumCanonicalizationCall = {
  query: string;
  reason: 'PRIMARY_SPECIFIC_IDENTITY' | 'CONTROLLED_ALIAS_RETRY';
  resultCount: number;
  matched: boolean;
};

export type PremiumRuntimeHypothesis = {
  name: string;
  entityType: string;
  city: string | null;
  region: string | null;
  country: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceBasis: PremiumEvidenceBasis;
  supportingClues: string[];
  contradictions: string[];
  timestamps: number[];
  canonicalStatus: PremiumCanonicalStatus;
  canonical: PremiumCanonicalCandidate | null;
  canonicalAlternatives: PremiumCanonicalCandidate[];
  canonicalizationCalls: PremiumCanonicalizationCall[];
};

export type PremiumLogicalDestination = {
  logicalDestinationId: string;
  hypotheses: PremiumRuntimeHypothesis[];
  decision: PremiumSafetyDecision;
  permissiveWouldAutoSave: boolean;
  safetyReasons: string[];
};

export type PremiumRecognitionTelemetry = {
  model: string;
  promptVersion: string;
  webSearchEnabled: boolean;
  frameStrategy: string;
  frameTimestampsSeconds: number[];
  evidenceReuse: {
    media: 'REUSED' | 'REACQUIRED';
    frames: 'REUSED' | 'REACQUIRED';
    transcript: 'REUSED' | 'REACQUIRED';
    ocr: 'REUSED' | 'REACQUIRED';
    caption: 'REUSED' | 'REACQUIRED';
  };
  usage: SolCallResult['usage'];
  knownModelCostUsd: number | null;
  placesRequests: number;
  placesRequestTypes: string[];
  timingsMs: {
    evidencePrep: number;
    sol: number;
    places: number;
    totalAfterEvidenceReady: number;
  };
  timestamps: {
    premiumRequestedAt: string;
    evidenceReadyAt: string;
    solStartedAt: string;
    solCompletedAt: string;
    canonicalizationStartedAt: string;
    canonicalizationCompletedAt: string;
    premiumTerminalAt: string;
  };
};

export type PremiumRecognitionExecution = {
  schemaVersion: 1;
  outcome: 'PREMIUM_ACTIONABLE_RESULT' | 'PREMIUM_NO_USEFUL_RESULT' | 'PREMIUM_TECHNICAL_FAILURE';
  chargeability: PremiumChargeability;
  destinationIntent: 'ONE_DESTINATION' | 'MULTIPLE_DESTINATIONS' | 'CONTEXT_ONLY' | 'UNKNOWN';
  destinations: PremiumLogicalDestination[];
  failureCode: string | null;
  telemetry: PremiumRecognitionTelemetry;
};

export type PremiumRecognitionInput = {
  frameSet: FrameSet;
  platform: string;
  canonicalUrl: string;
  evidence: SourceEvidence;
  requestedAt?: Date;
  evidenceReadyAt?: Date;
  evidencePrepMs?: number;
  evidenceReuse?: Partial<PremiumRecognitionTelemetry['evidenceReuse']>;
  googlePlacesApiKey: string | null;
  webSearchEnabled?: boolean;
  allowDistinctiveVisualAutoSave?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  placesSearch?: PremiumPlacesSearch;
  env?: NodeJS.ProcessEnv;
};

export type PremiumPlacesSearch = (
  query: string,
  apiKey: string,
  signal?: AbortSignal,
) => Promise<{ ok: true; results: PremiumCanonicalCandidate[] } | { ok: false; reason: string }>;
