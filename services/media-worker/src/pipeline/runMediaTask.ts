// services/media-worker/src/pipeline/runMediaTask.ts
//
// Orchestrates the full media pipeline for ONE claimed task and finalizes it
// through Nearr's EXISTING resolver. Guarantees temp cleanup on success,
// failure, cancellation, and timeout. Classifies errors into
// manual-fallback (terminal) vs retryable, and never double-saves (the Deno
// finalizer is idempotent).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config/env.js';
import { MediaError, isMediaError, type MediaTask, type TranscriptResult } from '../types/media.js';
import { createJobTemp } from '../util/tempDir.js';
import { sha256File } from '../util/hash.js';
import { log } from '../util/logger.js';
import { computeRetryDelaySeconds } from '../util/backoff.js';
import { selectResolver, type MediaResolver } from '../resolvers/MediaResolver.js';
import { inspectMedia } from './inspectMedia.js';
import { normalizeMedia } from './normalizeMedia.js';
import { extractAudio } from './extractAudio.js';
import { extractFrames } from './extractFrames.js';
import { deduplicateFrames } from './deduplicateFrames.js';
import {
  verifyPlaceEvidence,
  type FinalizeOutcome,
  type FinalizeResponse,
} from './verifyPlaceEvidence.js';
import { cleanupMedia } from './cleanupMedia.js';
import { persistEvidenceFrames, selectDurableEvidenceFrames } from './persistEvidenceFrames.js';
import {
  renewAiNoteRetryCycle,
  recordAiNoteEvidenceSnapshot,
  recordAiNoteFrameSnapshot,
  requeueAiNoteTask,
  setProgress,
  setTaskStatus,
  requeueTask,
} from '../db/tasks.js';
import type { TranscriptionProvider } from '../providers/transcription.js';
import {
  groundClaimedEvidence,
  type AnalyzeOutput,
  type ModelProvider,
} from '../providers/model.js';
import { type OcrProvider, deduplicateOcrSegments } from '../providers/ocr.js';
import { selectInstagramContentUrl } from '../resolvers/instagramUrl.js';
import { sourceDescriptionForModel } from '../util/sourceText.js';
import {
  buildDurableTargetEvidence,
  buildTargetedNoteContext,
  findTargetEvidenceHandoff,
  mergeTargetEvidence,
  sanitizeTargetEvidence,
  type TargetEvidenceHandoff,
} from './targetedNoteContext.js';
import {
  encodeRetainedFrameSnapshot,
  restoreRetainedFrameSnapshot,
} from './retainedFrameSnapshot.js';

export type TaskDeps = {
  cfg: WorkerConfig;
  client: SupabaseClient;
  resolvers: MediaResolver[];
  transcription: TranscriptionProvider;
  model: ModelProvider;
  ocr: OcrProvider;
};

type AiNoteTarget = {
  name: string;
  googlePlaceId: string | null;
  category: string | null;
  formattedAddress: string | null;
  handoff: TargetEvidenceHandoff | null;
};

function accumulateModelDiagnostics(
  diagnostics: Record<string, unknown>,
  output: AnalyzeOutput,
): void {
  diagnostics.modelCalls = (Number(diagnostics.modelCalls) || 0) + 1;
  diagnostics.modelLatencyMs = (Number(diagnostics.modelLatencyMs) || 0) +
    (Number(output.latencyMs) || 0);
  if (!output.usage) return;
  diagnostics.modelInputTokens = (Number(diagnostics.modelInputTokens) || 0) + output.usage.inputTokens;
  diagnostics.modelOutputTokens = (Number(diagnostics.modelOutputTokens) || 0) + output.usage.outputTokens;
  diagnostics.modelThinkingTokens = (Number(diagnostics.modelThinkingTokens) || 0) + output.usage.thinkingTokens;
  diagnostics.modelTotalTokens = (Number(diagnostics.modelTotalTokens) || 0) + output.usage.totalTokens;
}

async function loadRetainedHandoff(
  client: SupabaseClient,
  task: MediaTask,
  target: { name: string; googlePlaceId: string | null },
): Promise<TargetEvidenceHandoff | null> {
  const retained = sanitizeTargetEvidence(task.evidence_snapshot);
  if (retained.length) {
    return {
      evidence: retained,
      timestamps: [...new Set(retained
        .map((item) => item.timestampSeconds)
        .filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b),
    };
  }

  const source = task.canonical_url || task.source_url;
  const payloads: unknown[] = [];
  for (const field of ['canonical_url', 'source_url'] as const) {
    const { data } = await client
      .from('share_jobs')
      .select('candidate_payload')
      .eq('user_id', task.user_id)
      .eq(field, source)
      .order('created_at', { ascending: false })
      .limit(10);
    for (const row of data ?? []) payloads.push(row?.candidate_payload);
  }
  return findTargetEvidenceHandoff(payloads, target);
}

/** Re-read the authoritative final place before spending media/provider work.
 *  A note that arrived concurrently is a successful idempotent no-op. */
async function loadAiNoteTarget(
  client: SupabaseClient,
  task: MediaTask,
): Promise<AiNoteTarget | null> {
  if (task.task_kind !== 'ai_note_enrichment') return null;
  if (!task.saved_place_id) {
    await setTaskStatus(client, task.id, 'failed', {
      failure_code: 'ai_note_target_missing',
      ai_note_outcome: 'target_missing',
      frame_snapshot: null,
      frame_snapshot_timestamp_seconds: null,
      completed_at: new Date().toISOString(),
    });
    return null;
  }

  const { data, error } = await client
    .from('saved_places')
    .select('id,user_id,place_id,source_url,source_type,ai_note,category,place:places(name,google_place_id,formatted_address)')
    .eq('id', task.saved_place_id)
    .eq('user_id', task.user_id)
    .maybeSingle();
  if (error) throw new MediaError('provider_unavailable', 'ai_note_target_lookup_failed');

  const place = Array.isArray(data?.place) ? data.place[0] : data?.place;
  if (!data?.id || !place?.name) {
    await setTaskStatus(client, task.id, 'failed', {
      failure_code: 'ai_note_target_missing',
      ai_note_outcome: 'target_missing',
      frame_snapshot: null,
      frame_snapshot_timestamp_seconds: null,
      completed_at: new Date().toISOString(),
    });
    return null;
  }
  if (task.target_place_id && data.place_id !== task.target_place_id) {
    // A correction reset this reusable obligation while this stale claim was
    // running. Leave the freshly queued generation untouched.
    return null;
  }
  if (typeof data.ai_note === 'string' && data.ai_note.trim()) {
    await setTaskStatus(client, task.id, 'completed', {
      progress_stage: 'cleanup',
      failure_code: null,
      ai_note_outcome: 'already_present',
      frame_snapshot: null,
      frame_snapshot_timestamp_seconds: null,
      completed_at: new Date().toISOString(),
    });
    return null;
  }
  const representedSource = task.canonical_url || task.source_url;
  if (
    typeof data.source_url !== 'string' ||
    data.source_url !== representedSource ||
    (data.source_type ?? '').trim().toLowerCase() === 'manual'
  ) {
    // The trigger already completed or reset the reusable task row. This
    // worker owns an old snapshot and must not mutate the new obligation.
    return null;
  }

  const target: AiNoteTarget = {
    name: place.name,
    googlePlaceId: place.google_place_id ?? null,
    category: data.category ?? null,
    formattedAddress: place.formatted_address ?? null,
    handoff: null,
  };
  target.handoff = await loadRetainedHandoff(client, task, target);
  if (target.handoff?.evidence.length) {
    await recordAiNoteEvidenceSnapshot(client, task, target.handoff.evidence, false);
  }
  return target;
}

export type TaskFailurePlan =
  | { action: 'requeue'; delaySeconds: number }
  | { action: 'finalize'; outcome: 'unavailable' | 'failed' };

export function shouldRequeueAiNoteFinalizerFailure(
  media: MediaError,
  task: Pick<MediaTask, 'task_kind' | 'attempts' | 'max_attempts'>,
): boolean {
  return task.task_kind === 'ai_note_enrichment' &&
    media.code === 'finalizer_unavailable' &&
    task.attempts < task.max_attempts;
}

export function planTaskFailure(
  media: MediaError,
  task: Pick<MediaTask, 'attempts' | 'max_attempts'>,
  cfg: Pick<WorkerConfig, 'retryBaseSeconds' | 'retryMaxSeconds'>,
  random = Math.random,
): TaskFailurePlan {
  if (media.code === 'finalizer_unavailable') {
    return { action: 'finalize', outcome: 'failed' };
  }
  if (media.manualFallback || !media.retryable) {
    return { action: 'finalize', outcome: 'unavailable' };
  }
  if (task.attempts >= task.max_attempts) {
    return { action: 'finalize', outcome: 'failed' };
  }
  return {
    action: 'requeue',
    delaySeconds: computeRetryDelaySeconds(
      task.attempts,
      cfg.retryBaseSeconds,
      cfg.retryMaxSeconds,
      media.retryAfterSeconds,
      random,
    ),
  };
}

type FinalizeAttempt = () => Promise<FinalizeResponse>;
type Wait = (milliseconds: number) => Promise<void>;

const wait: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function finalizeWithRetry(
  attempt: FinalizeAttempt,
  waitForRetry: Wait = wait,
  maxAttempts = 3,
): Promise<FinalizeResponse> {
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      const response = await attempt();
      const transient = response.status === 429 || response.status >= 500;
      if (response.ok || !transient) return response;
      if (attemptNumber === maxAttempts) {
        throw new MediaError(
          'finalizer_unavailable',
          `verifying_place:finalize_http_${response.status}`,
          response.retryAfterSeconds,
        );
      }
      const delaySeconds = Math.min(response.retryAfterSeconds ?? 2 ** (attemptNumber - 1), 5);
      await waitForRetry(delaySeconds * 1000);
    } catch (error) {
      if (isMediaError(error)) throw error;
      if (attemptNumber === maxAttempts) {
        throw new MediaError('finalizer_unavailable', 'verifying_place:finalize_transport_error');
      }
      await waitForRetry(Math.min(2 ** (attemptNumber - 1), 5) * 1000);
    }
  }
  throw new MediaError('finalizer_unavailable', 'verifying_place:finalize_retry_exhausted');
}

function logFinalizeResult(
  task: MediaTask,
  outcome: FinalizeOutcome,
  response: FinalizeResponse,
): void {
  log.info('finalize_result', {
    taskId: task.id,
    jobId: task.share_job_id,
    taskKind: task.task_kind,
    outcome,
    status: response.status,
    route: response.route,
    enriched: response.enriched,
    reason: response.reason,
    disposition: response.disposition,
  });
}

export async function runMediaTask(deps: TaskDeps, task: MediaTask): Promise<void> {
  const { cfg, client } = deps;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.jobTimeoutMs);
  const jobTemp = await createJobTemp(cfg.tempDir, task.id);
  const startedAt = Date.now();
  const diagnostics: Record<string, unknown> = {};
  let analysisAttempted = false;
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const aiNoteTarget = await loadAiNoteTarget(client, task);
    if (task.task_kind === 'ai_note_enrichment' && !aiNoteTarget) return;
    if (task.task_kind === 'ai_note_enrichment') {
      log.info('ai_note_task_context', {
        taskId: task.id,
        savedPlaceId: task.saved_place_id,
        platform: task.platform,
        attempt: task.attempts,
        targetLoaded: !!aiNoteTarget,
        sourcePresent: !!(task.canonical_url || task.source_url),
        retainedEvidenceCount: Array.isArray(task.evidence_snapshot) ? task.evidence_snapshot.length : 0,
        retainedFramePresent: !!task.frame_snapshot,
        mediaAcquiredOnce: task.media_acquired_once === true,
      });
    }

    // Cheapest post-save path: ask for a cue from the bounded place-specific
    // observations already retained by recognition. Only if this cannot support
    // a useful cue do we reacquire media and inspect scene-scoped frames.
    if (
      task.task_kind === 'ai_note_enrichment' &&
      task.ai_note_outcome !== 'retry_after_generation' &&
      aiNoteTarget?.handoff?.evidence.length
    ) {
      await setProgress(client, task, 'analyzing_evidence');
      const preflight = await deps.model.analyze({
        platform: task.platform,
        canonicalUrl: task.canonical_url || task.source_url,
        transcript: [],
        ocr: [],
        ocrExtracted: false,
        frames: [],
        metadataTitle: null,
        metadataDescription: null,
        targetPlace: {
          name: aiNoteTarget.name,
          category: aiNoteTarget.category,
          formattedAddress: aiNoteTarget.formattedAddress,
        },
        retainedEvidence: aiNoteTarget.handoff.evidence,
        signal: controller.signal,
      });
      const preflightHasCue = preflight.evidence.places.some(
        (place) => !!place.memoryCue?.trim() && place.memoryCueEvidence.length > 0,
      );
      accumulateModelDiagnostics(diagnostics, preflight);
      diagnostics.noteStructuredEvidencePreflight = true;
      diagnostics.noteGenerationPasses = 1;
      diagnostics.noteSceneScoped = true;
      diagnostics.noteInputFrameCount = 0;
      diagnostics.noteInputEvidenceCount = aiNoteTarget.handoff.evidence.length;
      diagnostics.modelProvider = preflight.provider;
      diagnostics.modelName = preflight.modelName;
      diagnostics.promptVersion = preflight.promptVersion;
      if (preflightHasCue) {
        diagnostics.durationMs = Date.now() - startedAt;
        const fin = await finalizeWithRetry(() => verifyPlaceEvidence(cfg, {
          taskId: task.id,
          targetPlaceId: task.target_place_id ?? null,
          targetSourceUrl: task.canonical_url || task.source_url,
          outcome: 'evidence',
          analysisAttempted: true,
          evidence: preflight.evidence,
          diagnostics,
          signal: controller.signal,
        }));
        if (!fin.ok) {
          throw new MediaError('download_failed', `verifying_place:finalize_http_${fin.status}`, fin.retryAfterSeconds);
        }
        logFinalizeResult(task, 'evidence', fin);
        return;
      }
      diagnostics.noteStructuredEvidenceInsufficient = true;
    }

    // A single bounded frame survives only while this exact note obligation is
    // unresolved. It rescues visual-only saves when the provider was down and
    // the public source disappeared before the next cooled retry.
    if (task.task_kind === 'ai_note_enrichment' && aiNoteTarget && task.frame_snapshot) {
      const retainedFrame = await restoreRetainedFrameSnapshot({
        value: task.frame_snapshot,
        timestampSeconds: task.frame_snapshot_timestamp_seconds,
        outputPath: jobTemp.file('retained-ai-note-frame.jpg'),
      });
      if (retainedFrame) {
        await setProgress(client, task, 'analyzing_evidence');
        const retainedFrameAnalysis = await deps.model.analyze({
          platform: task.platform,
          canonicalUrl: task.canonical_url || task.source_url,
          transcript: [],
          ocr: [],
          ocrExtracted: false,
          frames: [retainedFrame],
          metadataTitle: null,
          metadataDescription: null,
          targetPlace: {
            name: aiNoteTarget.name,
            category: aiNoteTarget.category,
            formattedAddress: aiNoteTarget.formattedAddress,
          },
          retainedEvidence: aiNoteTarget.handoff?.evidence ?? [],
          signal: controller.signal,
        });
        accumulateModelDiagnostics(diagnostics, retainedFrameAnalysis);
        const retainedFrameHasCue = retainedFrameAnalysis.evidence.places.some(
          (place) => !!place.memoryCue?.trim() && place.memoryCueEvidence.length > 0,
        );
        diagnostics.noteRetainedFrameAttempt = true;
        diagnostics.noteGenerationPasses = (Number(diagnostics.noteGenerationPasses) || 0) + 1;
        diagnostics.noteInputFrameCount = 1;
        diagnostics.noteInputEvidenceCount = aiNoteTarget.handoff?.evidence.length ?? 0;
        diagnostics.modelProvider = retainedFrameAnalysis.provider;
        diagnostics.modelName = retainedFrameAnalysis.modelName;
        diagnostics.promptVersion = retainedFrameAnalysis.promptVersion;
        if (retainedFrameHasCue) {
          diagnostics.durationMs = Date.now() - startedAt;
          const fin = await finalizeWithRetry(() => verifyPlaceEvidence(cfg, {
            taskId: task.id,
            targetPlaceId: task.target_place_id ?? null,
            targetSourceUrl: task.canonical_url || task.source_url,
            outcome: 'evidence',
            analysisAttempted: true,
            evidence: retainedFrameAnalysis.evidence,
            diagnostics,
            signal: controller.signal,
          }));
          if (!fin.ok) {
            throw new MediaError('download_failed', `verifying_place:finalize_http_${fin.status}`, fin.retryAfterSeconds);
          }
          logFinalizeResult(task, 'evidence', fin);
          return;
        }
        warnings.push('retained_frame_insufficient');
      }
    }

    // 1. Retrieve public media to the isolated temp dir.
    await setProgress(client, task, 'retrieving_media');
    const rawUrl = task.canonical_url || task.source_url;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new MediaError('unsupported_url', 'bad_url');
    }
    let resolver = selectResolver(deps.resolvers, { platform: task.platform, url: parsedUrl });
    // A poisoned Instagram canonical URL is not supported by the strict
    // Instagram resolver. Give the original source content identity one
    // defense-in-depth chance before declaring the platform unsupported.
    if (!resolver && task.platform.toLowerCase() === 'instagram') {
      const safeInstagramUrl = selectInstagramContentUrl(task.source_url, task.canonical_url);
      if (!safeInstagramUrl) throw new MediaError('unsupported_url', 'invalid_instagram_content_url');
      parsedUrl = new URL(safeInstagramUrl);
      resolver = selectResolver(deps.resolvers, { platform: task.platform, url: parsedUrl });
    }
    if (!resolver) throw new MediaError('unsupported_platform', task.platform);
    diagnostics.resolverName = resolver.name;

    const media = await resolver.resolve({
      jobId: task.share_job_id ?? task.id,
      sourceUrl: task.source_url,
      canonicalUrl: task.canonical_url ?? undefined,
      workDir: jobTemp.dir,
      signal: controller.signal,
    });
    warnings.push(...media.warnings);
    if (media.acquisition) {
      diagnostics.mediaAcquisitionProvider = media.acquisition.provider;
      if (media.acquisition.primaryAcquisitionResult) {
        diagnostics.primaryAcquisitionResult = media.acquisition.primaryAcquisitionResult;
      }
      if (media.acquisition.primaryFailureCode) diagnostics.primaryFailureCode = media.acquisition.primaryFailureCode;
      if (media.acquisition.scrapeCreatorsInvoked !== undefined) {
        diagnostics.scrapeCreatorsInvoked = media.acquisition.scrapeCreatorsInvoked;
      }
      if (media.acquisition.scrapeCreatorsResult) diagnostics.scrapeCreatorsResult = media.acquisition.scrapeCreatorsResult;
      if (media.acquisition.identityMatch !== undefined) diagnostics.identityMatch = media.acquisition.identityMatch;
      if (media.acquisition.finalAcquisitionProvider) {
        diagnostics.finalAcquisitionProvider = media.acquisition.finalAcquisitionProvider;
      }
      if (media.acquisition.fallbackReason) diagnostics.fallbackReason = media.acquisition.fallbackReason;
      if (media.acquisition.canonicalTikTokId) diagnostics.canonicalTikTokId = media.acquisition.canonicalTikTokId;
      if (media.acquisition.canonicalInstagramId) {
        diagnostics.canonicalInstagramId = media.acquisition.canonicalInstagramId;
      }
      if (media.acquisition.providerPostId) diagnostics.providerPostId = media.acquisition.providerPostId;
      if (media.acquisition.canonicalFacebookId) {
        diagnostics.canonicalFacebookId = media.acquisition.canonicalFacebookId;
      }
      if (media.acquisition.sourceUrlClass) diagnostics.sourceUrlClass = media.acquisition.sourceUrlClass;
      if (media.acquisition.providerLatencyMs !== undefined) {
        diagnostics.providerLatencyMs = media.acquisition.providerLatencyMs;
      }
      if (media.acquisition.providerMediaBytes !== undefined) {
        diagnostics.providerMediaBytes = media.acquisition.providerMediaBytes;
      }
      if (media.acquisition.providerResult) diagnostics.providerResult = media.acquisition.providerResult;
      if (media.acquisition.providerCredits !== undefined) {
        diagnostics.providerCredits = media.acquisition.providerCredits;
      }
    }

    const sha = await sha256File(media.localFilePath);
    const persistedResolverName = media.acquisition?.provider === 'scrapecreators'
      ? `${task.platform}/scrapecreators`
      : resolver.name;
    diagnostics.resolverName = persistedResolverName;
    await client
      .from('share_media_tasks')
      .update({ resolver_name: persistedResolverName, media_size_bytes: media.sizeBytes, media_sha256: sha })
      .eq('id', task.id);

    // 2. Inspect (ffprobe) + normalize only if required.
    await setProgress(client, task, 'inspecting_media');
    const probe = await inspectMedia(cfg, media.localFilePath, controller.signal);
    diagnostics.mediaDurationSeconds = probe.durationSeconds;
    await client
      .from('share_media_tasks')
      .update({ media_duration_seconds: probe.durationSeconds })
      .eq('id', task.id);
    const playable = await normalizeMedia(cfg, media.localFilePath, probe, jobTemp.dir, controller.signal);

    // 3. Transcript hierarchy: (1) platform captions when the resolver
    //    already obtained them — skip paying for audio + speech-to-text
    //    entirely; (2) otherwise extract audio and use the transcription
    //    provider (non-fatal if it fails or there is no audio); (3) no usable
    //    speech is a normal evidence-limited outcome, not a failure — visual
    //    frames still carry the analysis forward.
    await setProgress(client, task, 'extracting_audio');
    let transcript: TranscriptResult;
    if (media.captionsTranscript && media.captionsTranscript.length > 0) {
      transcript = {
        provider: media.captionsSource ?? 'platform_captions',
        segments: media.captionsTranscript,
        language: media.captionsLanguage ?? null,
        status: 'success',
      };
      await setProgress(client, task, 'transcribing_audio');
    } else {
      const audioPath = await extractAudio(cfg, playable, probe, jobTemp.dir, controller.signal);
      await setProgress(client, task, 'transcribing_audio');
      transcript = await deps.transcription.transcribe({
        audioPath,
        hasAudio: probe.hasAudio,
        signal: controller.signal,
        sourceUrl: media.canonicalUrl,
        platform: task.platform,
      });
    }
    diagnostics.transcriptionProvider = transcript.provider;
    diagnostics.transcriptSegmentCount = transcript.segments.length;
    diagnostics.metadataTextPresent = !!media.metadataTitle || !!media.metadataDescription;
    if (transcript.status === 'failed') warnings.push('transcription_failed');

    // 4. Frames + perceptual dedup.
    await setProgress(client, task, 'extracting_frames');
    const rawFrames = await extractFrames(cfg, probe, playable, jobTemp.dir, controller.signal);
    const frames = deduplicateFrames(rawFrames);
    diagnostics.framesExtracted = rawFrames.length;
    diagnostics.framesConsidered = frames.length;
    diagnostics.frameCount = frames.length;

    // 5. Visible text (OCR provider; default noop → model reads frames).
    await setProgress(client, task, 'extracting_visible_text');
    const ocr = deduplicateOcrSegments(await deps.ocr.extract({ frames, signal: controller.signal }));
    diagnostics.ocrSegmentCount = ocr.length;

    // 6. Analyze → propose structured place evidence.
    await setProgress(client, task, 'analyzing_evidence');
    analysisAttempted = true;
    diagnostics.analysisAttempted = true;
    if (media.acquisition?.provider === 'scrapecreators') {
      diagnostics.modelPipelineReached = true;
      log.info('scrapecreators_model_pipeline_reached', {
        taskId: task.id,
        jobId: task.share_job_id,
        canonicalTikTokId: media.acquisition.canonicalTikTokId,
        canonicalInstagramId: media.acquisition.canonicalInstagramId,
        canonicalFacebookId: media.acquisition.canonicalFacebookId,
        platform: task.platform,
        modelPipelineReached: true,
      });
    }
    let primaryContext = task.task_kind === 'ai_note_enrichment'
      ? buildTargetedNoteContext({
          frames,
          transcript: transcript.segments,
          ocr,
          handoff: aiNoteTarget?.handoff,
          expanded: task.ai_note_outcome === 'retry_after_generation',
          maxFrames: cfg.maxSelectedFrames,
        })
      : {
          frames,
          transcript: transcript.segments,
          ocr,
          evidence: [],
          sceneScoped: false,
        };
    if (task.task_kind === 'ai_note_enrichment') {
      primaryContext = {
        ...primaryContext,
        evidence: buildDurableTargetEvidence({
          current: primaryContext.evidence,
          transcript: primaryContext.transcript,
          transcriptSource: media.captionsTranscript?.length ? 'caption' : 'speech',
          ocr: primaryContext.ocr,
          metadataTitle: media.metadataTitle,
          metadataDescription: media.metadataDescription,
          includeMetadata: !primaryContext.sceneScoped,
        }),
      };
      const acquired = frames.length > 0 || transcript.segments.length > 0 || ocr.length > 0 ||
        !!media.metadataTitle || !!media.metadataDescription || primaryContext.evidence.length > 0;
      await recordAiNoteEvidenceSnapshot(client, task, primaryContext.evidence, acquired);
      const frameSnapshot = await encodeRetainedFrameSnapshot(primaryContext.frames, {
        ffmpegPath: cfg.ffmpegPath,
        workDir: jobTemp.dir,
        signal: controller.signal,
      });
      if (frameSnapshot) await recordAiNoteFrameSnapshot(client, task, frameSnapshot);
    }
    const analyzeTarget = async (context: typeof primaryContext) => {
      const analyzeInput = {
        platform: task.platform,
        canonicalUrl: media.canonicalUrl,
        transcript: context.transcript,
        ocr: context.ocr,
        ocrExtracted: deps.ocr.extractsVisibleText,
        frames: context.frames,
        metadataTitle: context.sceneScoped ? null : media.metadataTitle,
        metadataDescription: context.sceneScoped
          ? null
          : sourceDescriptionForModel(media.metadataDescription),
        metadataLocation: context.sceneScoped ? null : media.metadataLocation,
        targetPlace: aiNoteTarget
          ? {
              name: aiNoteTarget.name,
              category: aiNoteTarget.category,
              formattedAddress: aiNoteTarget.formattedAddress,
            }
          : null,
        retainedEvidence: context.evidence,
        signal: controller.signal,
      };
      const rawAnalysis = await deps.model.analyze(analyzeInput);
      return {
        ...rawAnalysis,
        evidence: groundClaimedEvidence(rawAnalysis.evidence, analyzeInput),
      };
    };
    let analysis = await analyzeTarget(primaryContext);
    accumulateModelDiagnostics(diagnostics, analysis);
    diagnostics.noteGenerationPasses = (Number(diagnostics.noteGenerationPasses) || 0) + 1;
    diagnostics.noteSceneScoped = primaryContext.sceneScoped;
    diagnostics.noteQualityRetryExpanded = task.ai_note_outcome === 'retry_after_generation';
    diagnostics.noteInputFrameCount = primaryContext.frames.length;
    diagnostics.noteInputEvidenceCount = primaryContext.evidence.length;

    const focusedCueMissing = task.task_kind === 'ai_note_enrichment' &&
      !analysis.evidence.places.some(
        (place) => !!place.memoryCue?.trim() && place.memoryCueEvidence.length > 0,
      );
    if (focusedCueMissing) {
      let expandedContext = buildTargetedNoteContext({
        frames,
        transcript: transcript.segments,
        ocr,
        handoff: aiNoteTarget?.handoff,
        expanded: true,
        maxFrames: cfg.maxSelectedFrames,
      });
      const widened = expandedContext.frames.length > primaryContext.frames.length ||
        expandedContext.transcript.length > primaryContext.transcript.length ||
        expandedContext.ocr.length > primaryContext.ocr.length;
      if (widened) {
        expandedContext = {
          ...expandedContext,
          evidence: buildDurableTargetEvidence({
            current: expandedContext.evidence,
            transcript: expandedContext.transcript,
            transcriptSource: media.captionsTranscript?.length ? 'caption' : 'speech',
            ocr: expandedContext.ocr,
            metadataTitle: media.metadataTitle,
            metadataDescription: media.metadataDescription,
            includeMetadata: !expandedContext.sceneScoped,
          }),
        };
        await recordAiNoteEvidenceSnapshot(client, task, expandedContext.evidence, true);
        analysis = await analyzeTarget(expandedContext);
        accumulateModelDiagnostics(diagnostics, analysis);
        diagnostics.noteGenerationPasses = (Number(diagnostics.noteGenerationPasses) || 0) + 1;
        diagnostics.noteInputFrameCount = expandedContext.frames.length;
        diagnostics.noteInputEvidenceCount = expandedContext.evidence.length;
        warnings.push('target_scene_expanded');
      }
    }

    if (task.task_kind === 'ai_note_enrichment' && aiNoteTarget) {
      const generated = analysis.evidence.places
        .filter((place) => place.name.trim().toLowerCase() === aiNoteTarget.name.trim().toLowerCase())
        .flatMap((place) => [...place.explicitEvidence, ...place.memoryCueEvidence]);
      const retained = mergeTargetEvidence(primaryContext.evidence, generated);
      await recordAiNoteEvidenceSnapshot(client, task, retained, true);
    }
    diagnostics.modelProvider = analysis.provider;
    diagnostics.modelName = analysis.modelName;
    diagnostics.promptVersion = analysis.promptVersion;
    if (analysis.modelRawPreview) diagnostics.modelOutput = analysis.modelRawPreview;
    // Structured validation outcome. Answers "did the model emit places, and
    // did our own schema drop any?" from the persisted run alone — the question
    // the 500-char raw preview could not answer during the cohort audit.
    if (analysis.parseDiagnostics) {
      diagnostics.modelPlacesEmitted = analysis.parseDiagnostics.emitted;
      diagnostics.modelPlacesValid = analysis.parseDiagnostics.accepted;
      diagnostics.modelPlacesRejected = analysis.parseDiagnostics.rejected;
      if (analysis.parseDiagnostics.rejectionPaths.length > 0) {
        diagnostics.evidenceRejectionPaths = analysis.parseDiagnostics.rejectionPaths;
      }
    }
    if (analysis.vayrin) {
      diagnostics.vayrin = analysis.vayrin;
      const v = analysis.vayrin as Record<string, unknown>;
      log.info('vayrin_invocation', {
        jobId: task.share_job_id,
        taskId: task.id,
        videoDurationSeconds: probe.durationSeconds,
        framesExtracted: rawFrames.length,
        framesConsidered: frames.length,
        invoked: v.invoked,
        triggerReason: v.triggerReason,
        baselineModel: v.baselineModel,
        baselineResultClass: v.baselineResultClass,
        baselineFrameCount: v.baselineFrameCount,
        frameBudget: v.frameBudget,
        selectedFrameCount: v.selectedFrameCount,
        selectedTimestampsSeconds: v.selectedTimestampsSeconds,
        selectionStrategy: v.frameStrategy,
        selectionDecisions: v.selectionDecisions,
        model: v.model,
        sentFrameCount: v.sentFrameCount,
        sentTimestampsSeconds: v.sentTimestampsSeconds,
        latencyMs: v.latencyMs,
        estimatedCostUsd: v.estimatedCostUsd,
        usageAvailable: !!v.usage,
      });
    }
    warnings.push(...analysis.evidence.warnings);
    diagnostics.durationMs = Date.now() - startedAt;
    diagnostics.warnings = warnings.slice(0, 24);
    diagnostics.errors = errors.slice(0, 24);

    // 7. Verify through Nearr's EXISTING resolver + safeToAutoSave + save path.
    await setProgress(client, task, 'verifying_place');
    const hasEvidence = task.task_kind === 'ai_note_enrichment'
      ? analysis.evidence.places.some(
          (place) => !!place.memoryCue?.trim() && place.memoryCueEvidence.length > 0,
        )
      : !analysis.evidence.insufficientEvidence && analysis.evidence.places.length > 0;
    const outcome: FinalizeOutcome = hasEvidence ? 'evidence' : 'insufficient_evidence';
    const durableEvidenceFrames = task.task_kind === 'ai_note_enrichment' || !hasEvidence
      ? []
      : await persistEvidenceFrames(
          client,
          task,
          selectDurableEvidenceFrames({
            frames: primaryContext.frames,
            evidence: analysis.evidence,
            vayrinSelectedTimestamps: analysis.vayrin?.selectedTimestampsSeconds,
          }),
        );
    diagnostics.evidenceFramesRetained = durableEvidenceFrames.length;
    const fin = await finalizeWithRetry(() =>
      verifyPlaceEvidence(cfg, {
        taskId: task.id,
        targetPlaceId: task.target_place_id ?? null,
        targetSourceUrl: task.canonical_url || task.source_url,
        outcome,
        failureCode: outcome === 'insufficient_evidence' ? 'insufficient_evidence' : undefined,
        analysisAttempted,
        evidence: hasEvidence ? analysis.evidence : undefined,
        evidenceFrames: durableEvidenceFrames,
        // Already fetched during retrieval — no additional round trip.
        sourceMetadata: {
          title: media.metadataTitle,
          description: media.metadataDescription,
          creatorHandle: media.metadataCreatorHandle,
          postId: media.metadataPostId,
          sourceId: media.sourceId,
          creatorName: media.metadataCreatorName,
          creatorId: media.metadataCreatorId,
          location: media.metadataLocation,
        },
        canonicalUrl: media.canonicalUrl,
        diagnostics,
        signal: controller.signal,
      }),
    );
    if (!fin.ok) {
      throw new MediaError(
        'download_failed',
        `verifying_place:finalize_http_${fin.status}`,
        fin.retryAfterSeconds,
      );
    }
    logFinalizeResult(task, outcome, fin);
    log.info('task_finalized', {
      taskId: task.id,
      jobId: task.share_job_id,
      taskKind: task.task_kind,
      platform: task.platform,
      outcome,
      route: fin.route,
      enriched: fin.enriched,
      reason: fin.reason,
      disposition: fin.disposition,
      frameCount: diagnostics.frameCount,
      durationMs: diagnostics.durationMs,
    });
  } catch (err) {
    errors.push(isMediaError(err) ? err.code : 'unknown_error');
    diagnostics.warnings = warnings.slice(0, 24);
    diagnostics.errors = errors.slice(0, 24);
    await handleTaskError(deps, task, err, diagnostics, analysisAttempted);
  } finally {
    clearTimeout(timer);
    await cleanupMedia(jobTemp, task.id);
  }
}

async function handleTaskError(
  deps: TaskDeps,
  task: MediaTask,
  err: unknown,
  diagnostics: Record<string, unknown>,
  analysisAttempted: boolean,
): Promise<void> {
  const { cfg, client } = deps;
  const media = isMediaError(err) ? err : new MediaError('download_failed', 'unknown');
  log.warn('task_error', {
    taskId: task.id,
    jobId: task.share_job_id,
    taskKind: task.task_kind,
    code: media.code,
    detail: media.detail,
    attempts: task.attempts,
    max: task.max_attempts,
  });

  // The place save already succeeded. A transient finalizer outage must not
  // turn a valid generated cue into a terminal blank; reuse the same bounded
  // queue backoff as provider/download failures. Recognition keeps its existing
  // behavior unchanged.
  if (shouldRequeueAiNoteFinalizerFailure(media, task)) {
    await requeueAiNoteTask(
      client,
      task,
      computeRetryDelaySeconds(
        task.attempts,
        cfg.retryBaseSeconds,
        cfg.retryMaxSeconds,
        media.retryAfterSeconds,
      ),
      media.code,
    );
    return;
  }

  const plan = planTaskFailure(media, task, cfg);
  if (plan.action === 'requeue') {
    if (task.task_kind === 'ai_note_enrichment') {
      await requeueAiNoteTask(client, task, plan.delaySeconds, media.code);
    } else {
      await requeueTask(client, task.id, plan.delaySeconds, media.code);
    }
    return;
  }
  await safeFinalize(cfg, client, task, plan.outcome, diagnostics, media.code, analysisAttempted);
}

// Finalize with a FRESH signal (the job-timeout controller may already be
// aborted), so a timed-out task still transitions its parent safely.
async function safeFinalize(
  cfg: WorkerConfig,
  client: SupabaseClient,
  task: MediaTask,
  outcome: FinalizeOutcome,
  diagnostics: Record<string, unknown>,
  code: string,
  analysisAttempted: boolean,
): Promise<void> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15_000);
  try {
    const fin = await verifyPlaceEvidence(cfg, {
      taskId: task.id,
      targetPlaceId: task.target_place_id ?? null,
      targetSourceUrl: task.canonical_url || task.source_url,
      outcome,
      failureCode: code,
      analysisAttempted,
      diagnostics: { ...diagnostics, analysisAttempted },
      signal: c.signal,
    });
    if (!fin.ok) throw new Error(`finalize_http_${fin.status}`);
  } catch {
    // A note obligation survives a finalizer outage on a long retry cycle.
    // Recognition retains its original terminal/recovery behavior.
    if (task.task_kind === 'ai_note_enrichment') {
      await renewAiNoteRetryCycle(client, task, code);
    } else {
      await setTaskStatus(client, task.id, outcome === 'unavailable' ? 'needs_help' : 'failed', {
        failure_code: code,
        completed_at: new Date().toISOString(),
      });
    }
  } finally {
    clearTimeout(t);
  }
}
