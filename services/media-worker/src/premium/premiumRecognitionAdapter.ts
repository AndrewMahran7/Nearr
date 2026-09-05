import type { WorkerConfig } from '../config/env.js';
import type { AnalyzeInput, AnalyzeOutput, ModelProvider } from '../providers/model.js';
import { buildAutomaticFrameSets } from '../solParity/frames.js';
import type { SourceEvidence } from '../solParity/types.js';
import type { EvidenceItem, MediaPlaceEvidence, PlaceCandidateEvidence } from '../types/evidence.js';
import { runPremiumRecognition } from './premiumRecognition.js';
import type { PremiumRecognitionExecution, PremiumRuntimeHypothesis } from './premiumRecognitionTypes.js';

function clean(value: string | null | undefined, max: number): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, max) : null;
}

export function sourceEvidenceForPremium(input: AnalyzeInput): SourceEvidence {
  return {
    caption: clean([input.metadataTitle, input.metadataDescription].filter(Boolean).join('\n'), 8_000),
    transcript: input.transcript,
    ocr: input.ocr,
    source_location_context: clean(input.metadataLocation, 500),
    creator_handle: clean(input.metadataCreatorHandle, 200),
    creator_name: clean(input.metadataCreatorName, 200),
  };
}

function confidence(value: PremiumRuntimeHypothesis['confidence']): number {
  return value === 'HIGH' ? 0.9 : value === 'MEDIUM' ? 0.65 : 0.35;
}

function directEvidence(hypothesis: PremiumRuntimeHypothesis, input: AnalyzeInput): EvidenceItem[] {
  const identity = hypothesis.name.toLowerCase();
  const ocr = input.ocr.find((item) => item.text.toLowerCase().includes(identity));
  if (ocr) return [{ source: 'visible_text', value: ocr.text.slice(0, 400), timestampSeconds: ocr.timestampSeconds }];
  const transcript = input.transcript.find((item) => item.text.toLowerCase().includes(identity));
  if (transcript) return [{ source: 'speech', value: transcript.text.slice(0, 400), timestampSeconds: transcript.startSeconds }];
  const caption = [input.metadataTitle, input.metadataDescription].filter(Boolean).join(' ');
  if (caption.toLowerCase().includes(identity)) return [{ source: 'caption', value: caption.slice(0, 400), timestampSeconds: null }];
  if (hypothesis.evidenceBasis === 'DISTINCTIVE_VISUAL_MATCH' && hypothesis.supportingClues.length > 0) {
    return hypothesis.supportingClues.slice(0, 3).map((value, index) => ({
      source: 'frame' as const,
      value: value.slice(0, 400),
      timestampSeconds: hypothesis.timestamps[index] ?? hypothesis.timestamps[0] ?? null,
    }));
  }
  return [];
}

export function premiumExecutionToEvidence(execution: PremiumRecognitionExecution, input: AnalyzeInput): MediaPlaceEvidence {
  const places: PlaceCandidateEvidence[] = [];
  for (const destination of execution.destinations) {
    for (let index = 0; index < destination.hypotheses.length; index += 1) {
      const hypothesis = destination.hypotheses[index]!;
      places.push({
        logicalPlaceId: destination.logicalDestinationId,
        identityEvidenceKind: hypothesis.evidenceBasis === 'CONTEXTUAL_OR_MEMORY_PRIOR' ? 'model_prior' : 'observable',
        hypothesisRank: index,
        momentTimestamps: hypothesis.timestamps,
        distinctPlaceSignals: [],
        name: hypothesis.canonical?.name ?? hypothesis.name,
        category: null,
        categoryConfidence: 0,
        categoryEvidenceTags: [],
        address: hypothesis.canonical?.formattedAddress ?? null,
        city: hypothesis.city,
        region: hypothesis.region,
        country: hypothesis.country,
        coordinates: hypothesis.canonical?.latitude != null && hypothesis.canonical.longitude != null
          ? { lat: hypothesis.canonical.latitude, lng: hypothesis.canonical.longitude }
          : null,
        role: index === 0 ? 'primary' : 'secondary',
        confidence: confidence(hypothesis.confidence),
        explicitEvidence: directEvidence(hypothesis, input),
        inferredEvidence: hypothesis.supportingClues.slice(0, 8).map((value, clueIndex) => ({
          source: 'frame' as const,
          value: value.slice(0, 400),
          timestampSeconds: hypothesis.timestamps[clueIndex] ?? null,
        })),
        memoryCue: null,
        memoryCueEvidence: [],
      });
    }
  }
  return {
    places,
    partialPlaces: [],
    multipleIntentionalPlaces: execution.destinationIntent === 'MULTIPLE_DESTINATIONS',
    insufficientEvidence: execution.outcome !== 'PREMIUM_ACTIONABLE_RESULT',
    warnings: execution.destinations.flatMap((destination) => destination.safetyReasons).slice(0, 24),
  };
}

class PremiumRecognitionModel implements ModelProvider {
  readonly name = 'premium-sol';
  constructor(private readonly cfg: WorkerConfig) {}

  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const frameSet = buildAutomaticFrameSets(
      input.frames,
      Math.min(this.cfg.vayrinFrameBudget, this.cfg.maxSelectedFrames),
      this.cfg.vayrinFrameStrategy,
    ).F1;
    const execution = await runPremiumRecognition({
      frameSet,
      platform: input.platform,
      canonicalUrl: input.canonicalUrl,
      evidence: sourceEvidenceForPremium(input),
      requestedAt: input.premiumRequestedAt,
      evidenceReadyAt: input.evidenceReadyAt,
      evidencePrepMs: input.evidencePrepMs,
      premiumRequestId: input.premiumRequestId,
      shareJobId: input.shareJobId,
      evidenceReuseState: 'EVIDENCE_REGENERATED',
      googlePlacesApiKey: this.cfg.googlePlacesServerApiKey || null,
      webSearchEnabled: this.cfg.premiumSolWebSearchEnabled,
      allowDistinctiveVisualAutoSave: this.cfg.premiumDistinctiveVisualAutoSaveEnabled,
      signal: input.signal,
    });
    return {
      provider: this.name,
      modelName: execution.telemetry.model,
      promptVersion: execution.telemetry.promptVersion,
      evidence: premiumExecutionToEvidence(execution, input),
      premium: execution,
      modelInput: {
        model: execution.telemetry.model,
        frameCount: execution.telemetry.frameTimestampsSeconds.length,
        timestampsSeconds: execution.telemetry.frameTimestampsSeconds,
        textContextCategories: ['caption', 'transcript', 'ocr', 'source_location_context', 'creator'],
      },
      usage: {
        inputTokens: execution.telemetry.usage.input_tokens ?? 0,
        outputTokens: execution.telemetry.usage.output_tokens ?? 0,
        thinkingTokens: execution.telemetry.usage.reasoning_tokens ?? 0,
        totalTokens: execution.telemetry.usage.total_tokens ?? 0,
      },
      latencyMs: execution.telemetry.timingsMs.sol,
      recognitionFailureClass: execution.outcome === 'PREMIUM_TECHNICAL_FAILURE'
        ? 'model_provider_failure'
        : execution.outcome === 'PREMIUM_NO_USEFUL_RESULT'
        ? 'recovery_empty'
        : undefined,
    };
  }
}

export function createPremiumRecognitionModel(cfg: WorkerConfig): ModelProvider {
  return new PremiumRecognitionModel(cfg);
}
