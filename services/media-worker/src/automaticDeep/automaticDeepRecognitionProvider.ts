import type { WorkerConfig } from '../config/env.js';
import type { AnalyzeInput, AnalyzeOutput, ModelProvider } from '../providers/model.js';
import { buildAutomaticFrameSets } from '../solParity/frames.js';
import {
  premiumExecutionToEvidence,
  sourceEvidenceForPremium,
} from '../premium/premiumRecognitionAdapter.js';
import { runSimpleSolRecognition } from '../premium/premiumRecognition.js';
import type { PremiumRecognitionExecution } from '../premium/premiumRecognitionTypes.js';
import {
  evaluateNormalResultSpecificity,
  NORMAL_RESULT_SPECIFICITY_VERSION,
} from './normalResultSpecificity.js';

export const AUTOMATIC_DEEP_RECOGNITION_VERSION = 'automatic-deep-recognition.v1';

export type AutomaticDeepRecognitionRunner = typeof runSimpleSolRecognition;

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
      needed: !specificity.specific,
      invoked: false,
      rejectionReason: specificity.rejectionReason,
      normalResultSpecificity: specificity.specific ? 'SPECIFIC_ACTIONABLE' : 'WEAK',
      top3Count: 0,
      specificResult: false,
    };
    if (specificity.specific) return { ...normal, automaticDeep: diagnostics };

    // Simple Sol is visual. With no frame there is no defensible basis for an
    // exact guess; retain a bounded low-confidence terminal state and never
    // send a generic descriptor into Places.
    if (input.frames.length === 0) return {
      ...normal,
      evidence: { ...normal.evidence, places: [], insufficientEvidence: true },
      automaticDeep: diagnostics,
    };

    const frameSet = buildAutomaticFrameSets(
      input.frames,
      Math.min(this.cfg.vayrinFrameBudget, this.cfg.maxSelectedFrames),
      this.cfg.vayrinFrameStrategy,
    ).F1;
    const execution = reviewSafe(await this.runDeep({
      frameSet,
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
    }));
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
        top3Count,
        specificResult: execution.outcome === 'PREMIUM_ACTIONABLE_RESULT' && top3Count > 0,
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
