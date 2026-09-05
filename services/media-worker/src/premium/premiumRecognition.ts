import { callSolParity, type SolCallResult } from '../solParity/model.js';
import type { ModelArm, SolAlternative, SolDestination } from '../solParity/types.js';
import { canonicalizePremiumHypothesis } from './premiumCanonicalization.js';
import { evaluatePremiumRecognitionSafety, inferPremiumEvidenceBasis } from './premiumRecognitionSafety.js';
import {
  PREMIUM_ENGINE_VERSION,
  PREMIUM_EVIDENCE_VERSION,
  PREMIUM_SAFETY_VERSION,
  sha256,
  stableStringify,
  structuredSolBoundary,
} from './premiumInferenceFingerprint.js';
import type {
  PremiumLogicalDestination,
  PremiumRecognitionExecution,
  PremiumRecognitionInput,
  PremiumRuntimeHypothesis,
} from './premiumRecognitionTypes.js';

/** The single inference seam used by both the parity benchmark and runtime. */
export async function runPremiumRecognitionInference(args: {
  frameSet: PremiumRecognitionInput['frameSet'];
  platform: string;
  canonicalUrl?: string;
  evidence: PremiumRecognitionInput['evidence'];
  evidenceReuse?: PremiumRecognitionInput['evidenceReuseState'];
  modelArm?: ModelArm;
  webSearchEnabled?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<SolCallResult> {
  return callSolParity({
    frameSet: args.frameSet,
    modelArm: args.modelArm ?? (args.webSearchEnabled === true ? 'M2' : 'M1'),
    platform: args.platform,
    canonicalUrl: args.canonicalUrl,
    evidence: args.evidence,
    evidenceReuse: args.evidenceReuse,
    signal: args.signal,
    fetchImpl: args.fetchImpl,
    env: args.env,
  });
}

function asDestination(alternative: SolAlternative, parent: SolDestination): SolDestination {
  return {
    ...alternative,
    confidence: parent.confidence,
    alternatives: [],
    supporting_clues: parent.supporting_clues,
    contradictions: parent.contradictions,
    web_research_used: parent.web_research_used,
  };
}

function iso(date: Date): string {
  return date.toISOString();
}

function canonicalFingerprint(destinations: PremiumLogicalDestination[]) {
  const hypotheses = destinations.flatMap((destination) => destination.hypotheses.map((hypothesis) => ({
    name: hypothesis.name,
    entityType: hypothesis.entityType,
    geography: { city: hypothesis.city, region: hypothesis.region, country: hypothesis.country },
    calls: hypothesis.canonicalizationCalls,
    selectedGooglePlaceId: hypothesis.canonical?.googlePlaceId ?? null,
    selectedName: hypothesis.canonical?.name ?? null,
    outcome: hypothesis.canonicalStatus,
    rejectionReason: hypothesis.canonicalizationCalls.at(-1)?.rejectionReason ?? null,
  })));
  return {
    version: 'premium-canonicalization-fingerprint.v1',
    hash: sha256(stableStringify(hypotheses)),
    hypotheses,
  };
}

function finalFingerprint(args: {
  call: SolCallResult;
  destinations: PremiumLogicalDestination[];
  outcome: PremiumRecognitionExecution['outcome'];
  chargeability: PremiumRecognitionExecution['chargeability'];
}) {
  const canonical = canonicalFingerprint(args.destinations);
  const value = {
    solResultHash: args.call.payload ? sha256(stableStringify(args.call.payload)) : null,
    canonicalResultHash: canonical.hash,
    safetyDecision: args.destinations.map((destination) => destination.decision),
    resultDecision: args.outcome,
    chargeability: args.chargeability,
    tokenSettlement: args.chargeability === 'CHARGEABLE_ACTIONABLE'
      ? 'CONSUME' as const
      : 'RELEASE' as const,
  };
  return { version: 'premium-final-fingerprint.v1', hash: sha256(stableStringify(value)), ...value };
}

function terminalWithoutResult(args: {
  input: PremiumRecognitionInput;
  call: SolCallResult;
  requestedAt: Date;
  evidenceReadyAt: Date;
  solStartedAt: Date;
  solCompletedAt: Date;
  failure: boolean;
}): PremiumRecognitionExecution {
  const terminal = new Date();
  const outcome = args.failure ? 'PREMIUM_TECHNICAL_FAILURE' as const : 'PREMIUM_NO_USEFUL_RESULT' as const;
  const chargeability = args.failure ? 'NON_CHARGEABLE_TECHNICAL_FAILURE' as const : 'NON_CHARGEABLE_NO_RESULT' as const;
  const canonicalizationFingerprint = canonicalFingerprint([]);
  return {
    schemaVersion: 1,
    outcome,
    chargeability,
    destinationIntent: args.call.payload?.scene_class ?? 'UNKNOWN',
    destinations: [],
    failureCode: args.failure ? args.call.failure?.code ?? 'premium_model_failure' : null,
    telemetry: {
      engineVersion: PREMIUM_ENGINE_VERSION,
      safetyVersion: PREMIUM_SAFETY_VERSION,
      evidenceVersion: PREMIUM_EVIDENCE_VERSION,
      evidenceReuseState: args.input.evidenceReuseState ?? 'EVIDENCE_REGENERATED',
      model: args.call.model,
      promptVersion: args.call.prompt_version,
      webSearchEnabled: args.call.web_search_enabled,
      frameStrategy: args.input.frameSet.strategy,
      frameTimestampsSeconds: args.input.frameSet.frames.map((frame) => frame.timestampSeconds),
      inferenceFingerprint: args.call.fingerprint,
      solBoundary: structuredSolBoundary({
        premiumRequestId: args.input.premiumRequestId,
        shareJobId: args.input.shareJobId,
        call: args.call,
      }),
      canonicalizationFingerprint,
      finalFingerprint: finalFingerprint({ call: args.call, destinations: [], outcome, chargeability }),
      evidenceReuse: {
        media: args.input.evidenceReuse?.media ?? 'REACQUIRED',
        frames: args.input.evidenceReuse?.frames ?? 'REACQUIRED',
        transcript: args.input.evidenceReuse?.transcript ?? 'REACQUIRED',
        ocr: args.input.evidenceReuse?.ocr ?? 'REACQUIRED',
        caption: args.input.evidenceReuse?.caption ?? 'REACQUIRED',
      },
      usage: args.call.usage,
      knownModelCostUsd: args.call.estimated_model_cost_usd,
      placesRequests: 0,
      placesRequestTypes: [],
      timingsMs: {
        evidencePrep: args.input.evidencePrepMs ?? 0,
        sol: args.call.latency_ms,
        places: 0,
        totalAfterEvidenceReady: terminal.getTime() - args.evidenceReadyAt.getTime(),
      },
      timestamps: {
        premiumRequestedAt: iso(args.requestedAt),
        evidenceReadyAt: iso(args.evidenceReadyAt),
        solStartedAt: iso(args.solStartedAt),
        solCompletedAt: iso(args.solCompletedAt),
        canonicalizationStartedAt: iso(args.solCompletedAt),
        canonicalizationCompletedAt: iso(args.solCompletedAt),
        premiumTerminalAt: iso(terminal),
      },
    },
  };
}

export async function runPremiumRecognition(input: PremiumRecognitionInput): Promise<PremiumRecognitionExecution> {
  const requestedAt = input.requestedAt ?? new Date();
  const evidenceReadyAt = input.evidenceReadyAt ?? new Date();
  const solStartedAt = new Date();
  const call = await runPremiumRecognitionInference({
    frameSet: input.frameSet,
    platform: input.platform,
    canonicalUrl: input.canonicalUrl,
    evidence: input.evidence,
    evidenceReuse: input.evidenceReuseState,
    webSearchEnabled: input.webSearchEnabled === true,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    env: input.env,
  });
  const solCompletedAt = new Date();
  return completePremiumRecognition({ input, call, requestedAt, evidenceReadyAt, solStartedAt, solCompletedAt });
}

/** Complete the exact runtime canonicalization/safety path from an already
 * persisted Sol call. This is used by the paid parity replay so model output is
 * never purchased twice and labels still enter only after raw persistence. */
export async function completePremiumRecognition(args: {
  input: PremiumRecognitionInput;
  call: SolCallResult;
  requestedAt?: Date;
  evidenceReadyAt?: Date;
  solStartedAt?: Date;
  solCompletedAt?: Date;
}): Promise<PremiumRecognitionExecution> {
  const { input, call } = args;
  const requestedAt = args.requestedAt ?? input.requestedAt ?? new Date();
  const evidenceReadyAt = args.evidenceReadyAt ?? input.evidenceReadyAt ?? new Date();
  const solStartedAt = args.solStartedAt ?? evidenceReadyAt;
  const solCompletedAt = args.solCompletedAt ?? new Date(evidenceReadyAt.getTime() + call.latency_ms);
  if (call.failure || !call.payload) {
    return terminalWithoutResult({ input, call, requestedAt, evidenceReadyAt, solStartedAt, solCompletedAt, failure: true });
  }
  if (call.payload.results.length === 0 || call.payload.scene_class === 'CONTEXT_ONLY' || call.payload.scene_class === 'UNKNOWN') {
    return terminalWithoutResult({ input, call, requestedAt, evidenceReadyAt, solStartedAt, solCompletedAt, failure: false });
  }

  const canonicalizationStartedAt = new Date();
  const destinations: PremiumLogicalDestination[] = [];
  for (let destinationIndex = 0; destinationIndex < call.payload.results.length; destinationIndex += 1) {
    const result = call.payload.results[destinationIndex]!;
    // Runtime contract is at most three total hypotheses per logical place:
    // one primary plus two genuine alternatives. Real destination count is uncapped.
    const modelHypotheses = [result, ...result.alternatives.slice(0, 2).map((item) => asDestination(item, result))];
    const runtimeHypotheses: PremiumRuntimeHypothesis[] = [];
    for (const modelHypothesis of modelHypotheses) {
      const canonical = await canonicalizePremiumHypothesis({
        hypothesis: modelHypothesis,
        apiKey: input.googlePlacesApiKey,
        search: input.placesSearch,
        signal: input.signal,
        maxCalls: modelHypotheses.length > 1 ? 1 : 2,
      });
      const evidenceBasis = inferPremiumEvidenceBasis(modelHypothesis, input.evidence);
      runtimeHypotheses.push({
        name: modelHypothesis.name,
        entityType: modelHypothesis.entity_type,
        city: modelHypothesis.city,
        region: modelHypothesis.region,
        country: modelHypothesis.country,
        confidence: modelHypothesis.confidence,
        evidenceBasis,
        supportingClues: modelHypothesis.supporting_clues.slice(0, 8),
        contradictions: modelHypothesis.contradictions.slice(0, 8),
        timestamps: input.frameSet.frames.map((frame) => frame.timestampSeconds),
        canonicalStatus: canonical.status,
        canonical: canonical.selected,
        canonicalAlternatives: canonical.alternatives,
        canonicalizationCalls: canonical.calls,
      });
    }
    const primary = runtimeHypotheses[0]!;
    const safety = evaluatePremiumRecognitionSafety({
      hypothesis: result,
      evidenceBasis: primary.evidenceBasis,
      canonicalStatus: primary.canonicalStatus,
      canonical: primary.canonical,
      hypothesisCount: runtimeHypotheses.length,
      destinationCount: call.payload.results.length,
      allowDistinctiveVisualAutoSave: input.allowDistinctiveVisualAutoSave,
    });
    destinations.push({
      logicalDestinationId: `premium-destination-${destinationIndex + 1}`,
      hypotheses: runtimeHypotheses,
      decision: safety.decision,
      permissiveWouldAutoSave: safety.permissiveWouldAutoSave,
      safetyReasons: safety.reasons,
    });
  }
  const canonicalizationCompletedAt = new Date();
  const actionable = destinations.some((destination) => destination.decision !== 'REJECT');
  const terminal = new Date();
  const calls = destinations.flatMap((destination) => destination.hypotheses.flatMap((hypothesis) => hypothesis.canonicalizationCalls));
  const outcome = actionable ? 'PREMIUM_ACTIONABLE_RESULT' as const : 'PREMIUM_NO_USEFUL_RESULT' as const;
  const chargeability = actionable ? 'CHARGEABLE_ACTIONABLE' as const : 'NON_CHARGEABLE_NO_RESULT' as const;
  const visibleDestinations = actionable ? destinations : [];
  const canonicalizationFingerprint = canonicalFingerprint(destinations);
  return {
    schemaVersion: 1,
    outcome,
    chargeability,
    destinationIntent: call.payload.scene_class,
    destinations: visibleDestinations,
    failureCode: null,
    telemetry: {
      engineVersion: PREMIUM_ENGINE_VERSION,
      safetyVersion: PREMIUM_SAFETY_VERSION,
      evidenceVersion: PREMIUM_EVIDENCE_VERSION,
      evidenceReuseState: input.evidenceReuseState ?? 'EVIDENCE_REGENERATED',
      model: call.model,
      promptVersion: call.prompt_version,
      webSearchEnabled: call.web_search_enabled,
      frameStrategy: input.frameSet.strategy,
      frameTimestampsSeconds: input.frameSet.frames.map((frame) => frame.timestampSeconds),
      inferenceFingerprint: call.fingerprint,
      solBoundary: structuredSolBoundary({
        premiumRequestId: input.premiumRequestId,
        shareJobId: input.shareJobId,
        call,
      }),
      canonicalizationFingerprint,
      finalFingerprint: finalFingerprint({ call, destinations, outcome, chargeability }),
      evidenceReuse: {
        media: input.evidenceReuse?.media ?? 'REACQUIRED',
        frames: input.evidenceReuse?.frames ?? 'REACQUIRED',
        transcript: input.evidenceReuse?.transcript ?? 'REACQUIRED',
        ocr: input.evidenceReuse?.ocr ?? 'REACQUIRED',
        caption: input.evidenceReuse?.caption ?? 'REACQUIRED',
      },
      usage: call.usage,
      knownModelCostUsd: call.estimated_model_cost_usd,
      placesRequests: calls.length,
      placesRequestTypes: calls.map((item) => item.reason),
      timingsMs: {
        evidencePrep: input.evidencePrepMs ?? 0,
        sol: call.latency_ms,
        places: canonicalizationCompletedAt.getTime() - canonicalizationStartedAt.getTime(),
        totalAfterEvidenceReady: terminal.getTime() - evidenceReadyAt.getTime(),
      },
      timestamps: {
        premiumRequestedAt: iso(requestedAt),
        evidenceReadyAt: iso(evidenceReadyAt),
        solStartedAt: iso(solStartedAt),
        solCompletedAt: iso(solCompletedAt),
        canonicalizationStartedAt: iso(canonicalizationStartedAt),
        canonicalizationCompletedAt: iso(canonicalizationCompletedAt),
        premiumTerminalAt: iso(terminal),
      },
    },
  };
}
