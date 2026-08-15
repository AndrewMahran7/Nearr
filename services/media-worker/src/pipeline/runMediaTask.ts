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
import { setProgress, setTaskStatus, requeueTask } from '../db/tasks.js';
import type { TranscriptionProvider } from '../providers/transcription.js';
import type { ModelProvider } from '../providers/model.js';
import { type OcrProvider, deduplicateOcrSegments } from '../providers/ocr.js';

export type TaskDeps = {
  cfg: WorkerConfig;
  client: SupabaseClient;
  resolvers: MediaResolver[];
  transcription: TranscriptionProvider;
  model: ModelProvider;
  ocr: OcrProvider;
};

export type TaskFailurePlan =
  | { action: 'requeue'; delaySeconds: number }
  | { action: 'finalize'; outcome: 'unavailable' | 'failed' };

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

export async function runMediaTask(deps: TaskDeps, task: MediaTask): Promise<void> {
  const { cfg, client } = deps;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.jobTimeoutMs);
  const jobTemp = await createJobTemp(cfg.tempDir, task.id);
  const startedAt = Date.now();
  const diagnostics: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // 1. Retrieve public media to the isolated temp dir.
    await setProgress(client, task, 'retrieving_media');
    const rawUrl = task.canonical_url || task.source_url;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new MediaError('unsupported_url', 'bad_url');
    }
    const resolver = selectResolver(deps.resolvers, { platform: task.platform, url: parsedUrl });
    if (!resolver) throw new MediaError('unsupported_platform', task.platform);
    diagnostics.resolverName = resolver.name;

    const media = await resolver.resolve({
      jobId: task.share_job_id,
      sourceUrl: task.source_url,
      canonicalUrl: task.canonical_url ?? undefined,
      workDir: jobTemp.dir,
      signal: controller.signal,
    });
    warnings.push(...media.warnings);

    const sha = await sha256File(media.localFilePath);
    await client
      .from('share_media_tasks')
      .update({ resolver_name: resolver.name, media_size_bytes: media.sizeBytes, media_sha256: sha })
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
    if (transcript.status === 'failed') warnings.push('transcription_failed');

    // 4. Frames + perceptual dedup.
    await setProgress(client, task, 'extracting_frames');
    const rawFrames = await extractFrames(cfg, probe, playable, jobTemp.dir, controller.signal);
    const frames = deduplicateFrames(rawFrames);
    diagnostics.frameCount = frames.length;

    // 5. Visible text (OCR provider; default noop → model reads frames).
    await setProgress(client, task, 'extracting_visible_text');
    const ocr = deduplicateOcrSegments(await deps.ocr.extract({ frames, signal: controller.signal }));
    diagnostics.ocrSegmentCount = ocr.length;

    // 6. Analyze → propose structured place evidence.
    await setProgress(client, task, 'analyzing_evidence');
    const analysis = await deps.model.analyze({
      platform: task.platform,
      canonicalUrl: media.canonicalUrl,
      transcript: transcript.segments,
      ocr,
      frames,
      metadataTitle: media.metadataTitle,
      metadataDescription: media.metadataDescription,
      signal: controller.signal,
    });
    diagnostics.modelProvider = analysis.provider;
    diagnostics.promptVersion = analysis.promptVersion;
    if (analysis.modelRawPreview) diagnostics.modelOutput = analysis.modelRawPreview;
    warnings.push(...analysis.evidence.warnings);
    diagnostics.durationMs = Date.now() - startedAt;
    diagnostics.warnings = warnings.slice(0, 24);
    diagnostics.errors = errors.slice(0, 24);

    // 7. Verify through Nearr's EXISTING resolver + safeToAutoSave + save path.
    await setProgress(client, task, 'verifying_place');
    const hasEvidence = !analysis.evidence.insufficientEvidence && analysis.evidence.places.length > 0;
    const outcome: FinalizeOutcome = hasEvidence ? 'evidence' : 'insufficient_evidence';
    const fin = await finalizeWithRetry(() =>
      verifyPlaceEvidence(cfg, {
        taskId: task.id,
        outcome,
        evidence: hasEvidence ? analysis.evidence : undefined,
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
    log.info('task_finalized', {
      taskId: task.id,
      jobId: task.share_job_id,
      platform: task.platform,
      outcome,
      route: fin.route,
      frameCount: diagnostics.frameCount,
      durationMs: diagnostics.durationMs,
    });
  } catch (err) {
    errors.push(isMediaError(err) ? err.code : 'unknown_error');
    diagnostics.warnings = warnings.slice(0, 24);
    diagnostics.errors = errors.slice(0, 24);
    await handleTaskError(deps, task, err, diagnostics);
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
): Promise<void> {
  const { cfg, client } = deps;
  const media = isMediaError(err) ? err : new MediaError('download_failed', 'unknown');
  log.warn('task_error', {
    taskId: task.id,
    jobId: task.share_job_id,
    code: media.code,
    detail: media.detail,
    attempts: task.attempts,
    max: task.max_attempts,
  });

  const plan = planTaskFailure(media, task, cfg);
  if (plan.action === 'requeue') {
    await requeueTask(client, task.id, plan.delaySeconds, media.code);
    return;
  }
  await safeFinalize(cfg, client, task, plan.outcome, diagnostics, media.code);
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
): Promise<void> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15_000);
  try {
    const fin = await verifyPlaceEvidence(cfg, { taskId: task.id, outcome, diagnostics, signal: c.signal });
    if (!fin.ok) throw new Error(`finalize_http_${fin.status}`);
  } catch {
    // Finalize endpoint unreachable — mark the task terminal locally. The
    // parent's parked lease still guarantees the metadata claim rescues it.
    await setTaskStatus(client, task.id, outcome === 'unavailable' ? 'needs_help' : 'failed', {
      failure_code: code,
      completed_at: new Date().toISOString(),
    });
  } finally {
    clearTimeout(t);
  }
}
