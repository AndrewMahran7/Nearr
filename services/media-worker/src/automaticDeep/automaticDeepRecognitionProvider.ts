import type { WorkerConfig } from '../config/env.js';
import type { AnalyzeInput, AnalyzeOutput, ModelProvider } from '../providers/model.js';
import { buildAutomaticFrameSets } from '../solParity/frames.js';
import {
  premiumExecutionToEvidence,
  sourceEvidenceForPremium,
} from '../premium/premiumRecognitionAdapter.js';
import { runSimpleSolRecognition } from '../premium/premiumRecognition.js';
import type { PremiumRecognitionExecution } from '../premium/premiumRecognitionTypes.js';
import { isCategoryOnlyPlaceName } from '../vayrin/placeIdentityGuard.js';
import {
  evaluateNormalResultSpecificity,
  NORMAL_RESULT_SPECIFICITY_VERSION,
} from './normalResultSpecificity.js';

export const AUTOMATIC_DEEP_RECOGNITION_VERSION = 'automatic-deep-recognition.v2';

export type AutomaticDeepRecognitionRunner = typeof runSimpleSolRecognition;

const NON_SPECIFIC_ENTITY_TYPES = new Set(['ADMIN_AREA', 'BROAD_AREA', 'UNKNOWN']);

function specificHypothesisCount(execution: PremiumRecognitionExecution): number {
  if (execution.outcome !== 'PREMIUM_ACTIONABLE_RESULT') return 0;
  return execution.destinations.reduce((count, destination) => count + destination.hypotheses
    .filter((hypothesis) =>
      !!hypothesis.name.trim() &&
      !NON_SPECIFIC_ENTITY_TYPES.has(hypothesis.entityType) &&
      !isCategoryOnlyPlaceName(hypothesis.name))
    .length, 0);
}

function specificOnly(execution: PremiumRecognitionExecution): PremiumRecognitionExecution {
  const destinations = execution.destinations.flatMap((destination) => {
    const hypotheses = destination.hypotheses.filter((hypothesis) =>
      !!hypothesis.name.trim() &&
      !NON_SPECIFIC_ENTITY_TYPES.has(hypothesis.entityType) &&
      !isCategoryOnlyPlaceName(hypothesis.name));
    return hypotheses.length > 0 ? [{ ...destination, hypotheses }] : [];
  });
  if (execution.outcome === 'PREMIUM_ACTIONABLE_RESULT' && destinations.length > 0) {
    return { ...execution, destinations };
  }
  return {
    ...execution,
    outcome: execution.outcome === 'PREMIUM_TECHNICAL_FAILURE'
      ? 'PREMIUM_TECHNICAL_FAILURE'
      : 'PREMIUM_NO_USEFUL_RESULT',
    chargeability: execution.outcome === 'PREMIUM_TECHNICAL_FAILURE'
      ? 'NON_CHARGEABLE_TECHNICAL_FAILURE'
      : 'NON_CHARGEABLE_NO_RESULT',
    destinations: [],
    failureCode: execution.failureCode ?? 'automatic_deep_no_specific_hypothesis',
  };
}

function hasUsableSourceEvidence(input: AnalyzeInput): boolean {
  return input.frames.length > 0 ||
    input.transcript.some((segment) => !!segment.text.trim()) ||
    input.ocr.some((segment) => !!segment.text.trim()) ||
    !!input.metadataTitle?.trim() ||
    !!input.metadataDescription?.trim() ||
    !!input.metadataLocation?.trim();
}

function aggregateRecovery(
  first: PremiumRecognitionExecution,
  recovery: PremiumRecognitionExecution,
  firstSpecificHypotheses: number,
  recoverySpecificHypotheses: number,
): PremiumRecognitionExecution {
  const firstUsage = first.telemetry.usage;
  const recoveryUsage = recovery.telemetry.usage;
  const add = (left: number | null, right: number | null): number | null =>
    left == null && right == null ? null : (left ?? 0) + (right ?? 0);
  const knownModelCostUsd = first.telemetry.knownModelCostUsd == null && recovery.telemetry.knownModelCostUsd == null
    ? null
    : (first.telemetry.knownModelCostUsd ?? 0) + (recovery.telemetry.knownModelCostUsd ?? 0);
  return {
    ...recovery,
    telemetry: {
      ...recovery.telemetry,
      usage: {
        input_tokens: add(firstUsage.input_tokens, recoveryUsage.input_tokens),
        cached_input_tokens: add(firstUsage.cached_input_tokens, recoveryUsage.cached_input_tokens),
        output_tokens: add(firstUsage.output_tokens, recoveryUsage.output_tokens),
        reasoning_tokens: add(firstUsage.reasoning_tokens, recoveryUsage.reasoning_tokens),
        total_tokens: add(firstUsage.total_tokens, recoveryUsage.total_tokens),
      },
      knownModelCostUsd,
      placesRequests: first.telemetry.placesRequests + recovery.telemetry.placesRequests,
      placesRequestTypes: [...first.telemetry.placesRequestTypes, ...recovery.telemetry.placesRequestTypes],
      timingsMs: {
        evidencePrep: first.telemetry.timingsMs.evidencePrep + recovery.telemetry.timingsMs.evidencePrep,
        sol: first.telemetry.timingsMs.sol + recovery.telemetry.timingsMs.sol,
        places: first.telemetry.timingsMs.places + recovery.telemetry.timingsMs.places,
        totalAfterEvidenceReady: first.telemetry.timingsMs.totalAfterEvidenceReady + recovery.telemetry.timingsMs.totalAfterEvidenceReady,
      },
      automaticRecovery: {
        invoked: true,
        attempts: 2,
        firstOutcome: first.outcome,
        firstSpecificHypotheses,
        recoveryOutcome: recovery.outcome,
        recoverySpecificHypotheses,
        recoveryFrameStrategy: recovery.telemetry.frameStrategy,
      },
    },
  };
}

function reviewSafe(execution: PremiumRecognitionExecution): PremiumRecognitionExecution {
  return {
    ...execution,
    destinations: execution.destinations.map((destination) => ({
      ...destination,
      decision: destination.decision === 'REJECT' ? 'REJECT' :
        destination.decision === 'NAMED_LEAD' ? 'NAMED_LEAD' : 'REVIEW',
      safetyReasons: [...new Set([
        ...destination.safetyReasons,
        'automatic_deep_review_required',
      ])],
    })),
  };
}

/** Normal/free provider -> specificity gate -> the exact shared Simple Sol
 * engine used by Premium. The wrapper contains no wallet/task/analytics code. */
class AutomaticDeepRecognitionModel implements ModelProvider {
  readonly name: string;

  constructor(
    private readonly inner: ModelProvider,
    private readonly cfg: WorkerConfig,
    private readonly runDeep: AutomaticDeepRecognitionRunner,
  ) {
    this.name = `${inner.name}+automatic-deep`;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const normal = await this.inner.analyze(input);
    if (input.targetPlace || !this.cfg.automaticDeepRecognitionEnabled) return normal;

    const specificity = evaluateNormalResultSpecificity(normal);
    const diagnostics: NonNullable<AnalyzeOutput['automaticDeep']> = {
      version: AUTOMATIC_DEEP_RECOGNITION_VERSION,
      needed: !specificity.specific,
      invoked: false,
      attempts: 0,
      recoveryInvoked: false,
      noUsableSourceEvidence: false,
      rejectionReason: specificity.rejectionReason,
      normalResultSpecificity: specificity.specific ? 'SPECIFIC_ACTIONABLE' : 'WEAK',
      normalCandidates: normal.evidence.places.slice(0, 3).map((place) => ({
        name: place.name.slice(0, 200),
        category: place.category,
        city: place.city,
        region: place.region,
        country: place.country,
      })),
      firstAttemptSpecificHypotheses: 0,
      recoverySpecificHypotheses: 0,
      top3Count: 0,
      specificResult: false,
    };
    if (specificity.specific) return { ...normal, automaticDeep: diagnostics };

    // With literally no extracted source evidence there is no defensible
    // hypothesis. This is a technical unresolved state (retry/back in the
    // client), never a fabricated candidate or manual-search fallback.
    if (!hasUsableSourceEvidence(input)) return {
      ...normal,
      evidence: { ...normal.evidence, places: [], insufficientEvidence: true },
      recognitionFailureClass: 'source_evidence_unavailable',
      automaticDeep: { ...diagnostics, noUsableSourceEvidence: true },
    };

    const frameSets = buildAutomaticFrameSets(
      input.frames,
      Math.min(this.cfg.vayrinFrameBudget, this.cfg.maxSelectedFrames),
      this.cfg.vayrinFrameStrategy,
    );
    const deepInput = {
      platform: input.platform,
      canonicalUrl: input.canonicalUrl,
      evidence: sourceEvidenceForPremium(input),
      evidenceReadyAt: input.evidenceReadyAt,
      evidencePrepMs: input.evidencePrepMs,
      premiumRequestId: null,
      shareJobId: input.shareJobId,
      evidenceReuseState: 'EVIDENCE_REGENERATED',
      googlePlacesApiKey: this.cfg.googlePlacesServerApiKey || null,
      webSearchEnabled: false,
      allowDistinctiveVisualAutoSave: false,
      signal: input.signal,
    } as const;
    const first = reviewSafe(await this.runDeep({ ...deepInput, frameSet: frameSets.F1 }));
    const firstSpecificHypotheses = specificHypothesisCount(first);
    let recoverySpecificHypotheses = 0;
    let execution = first;
    if (firstSpecificHypotheses === 0) {
      const recovery = reviewSafe(await this.runDeep({
        ...deepInput,
        frameSet: frameSets.F2,
        recognitionPass: 'ZERO_HYPOTHESIS_RECOVERY',
      }));
      recoverySpecificHypotheses = specificHypothesisCount(recovery);
      execution = aggregateRecovery(first, recovery, firstSpecificHypotheses, recoverySpecificHypotheses);
    }
    execution = specificOnly(execution);
    const evidence = premiumExecutionToEvidence(execution, input);
    const top3Count = execution.destinations.reduce(
      (count, destination) => count + Math.min(3, destination.hypotheses.length),
      0,
    );
    return {
      ...normal,
      provider: `${normal.provider}+simple-sol`,
      promptVersion: `${normal.promptVersion}+${execution.telemetry.promptVersion}`,
      evidence,
      modelName: execution.telemetry.model,
      modelRawPreview: undefined,
      recognitionFailureClass: execution.outcome === 'PREMIUM_TECHNICAL_FAILURE'
        ? 'model_provider_failure'
        : execution.outcome === 'PREMIUM_NO_USEFUL_RESULT'
        ? 'recovery_empty'
        : undefined,
      usage: {
        inputTokens: (normal.usage?.inputTokens ?? 0) + (execution.telemetry.usage.input_tokens ?? 0),
        outputTokens: (normal.usage?.outputTokens ?? 0) + (execution.telemetry.usage.output_tokens ?? 0),
        thinkingTokens: (normal.usage?.thinkingTokens ?? 0) + (execution.telemetry.usage.reasoning_tokens ?? 0),
        totalTokens: (normal.usage?.totalTokens ?? 0) + (execution.telemetry.usage.total_tokens ?? 0),
      },
      latencyMs: (normal.latencyMs ?? 0) + execution.telemetry.timingsMs.sol,
      automaticDeepRecognition: execution,
      automaticDeep: {
        ...diagnostics,
        invoked: true,
        attempts: firstSpecificHypotheses > 0 ? 1 : 2,
        recoveryInvoked: firstSpecificHypotheses === 0,
        firstAttemptSpecificHypotheses: firstSpecificHypotheses,
        recoverySpecificHypotheses,
        top3Count,
        specificResult: execution.outcome === 'PREMIUM_ACTIONABLE_RESULT' &&
          (firstSpecificHypotheses > 0 || recoverySpecificHypotheses > 0),
      },
    };
  }
}

export function withAutomaticDeepRecognition(
  inner: ModelProvider,
  cfg: WorkerConfig,
  runDeep: AutomaticDeepRecognitionRunner = runSimpleSolRecognition,
): ModelProvider {
  return cfg.automaticDeepRecognitionEnabled
    ? new AutomaticDeepRecognitionModel(inner, cfg, runDeep)
    : inner;
}

export { NORMAL_RESULT_SPECIFICITY_VERSION };
