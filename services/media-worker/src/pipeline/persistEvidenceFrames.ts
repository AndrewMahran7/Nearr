import { readFile, stat } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { MediaPlaceEvidence } from '../types/evidence.js';
import type { MediaTask, SelectedFrame } from '../types/media.js';
import { log } from '../util/logger.js';

export const SHARE_EVIDENCE_BUCKET = 'share-evidence';
export const MAX_RETAINED_EVIDENCE_FRAMES = 5;
export const MAX_RETAINED_EVIDENCE_FRAME_BYTES = 786_432;

export type PersistedEvidenceFrame = {
  id: string;
  storagePath: string;
  timestampSeconds: number;
  width: number;
  height: number;
  relevance: 'vayrin_selected' | 'candidate_evidence' | 'analysis_coverage';
};

function finiteTimestamps(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  ))];
}

function nearestFrame(frames: readonly SelectedFrame[], timestamp: number): SelectedFrame | null {
  let best: SelectedFrame | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const next = Math.abs(frame.timestampSeconds - timestamp);
    if (next < distance) {
      best = frame;
      distance = next;
    }
  }
  return best;
}

/** Strongest/relevant first. When Vayrin reports the frames it actually sent,
 * only those frames are eligible; otherwise every supplied analysis frame is. */
export function selectDurableEvidenceFrames(args: {
  frames: readonly SelectedFrame[];
  evidence: MediaPlaceEvidence;
  vayrinSelectedTimestamps?: unknown;
}): Array<{ frame: SelectedFrame; relevance: PersistedEvidenceFrame['relevance'] }> {
  const selectedByVayrin = finiteTimestamps(args.vayrinSelectedTimestamps);
  const eligible = selectedByVayrin.length > 0
    ? selectedByVayrin.flatMap((timestamp) => nearestFrame(args.frames, timestamp) ?? [])
    : [...args.frames];
  const eligiblePaths = new Set(eligible.map((frame) => frame.path));
  const result: Array<{ frame: SelectedFrame; relevance: PersistedEvidenceFrame['relevance'] }> = [];
  const seen = new Set<string>();
  const add = (frame: SelectedFrame | null, relevance: PersistedEvidenceFrame['relevance']) => {
    if (!frame || !eligiblePaths.has(frame.path) || seen.has(frame.path) || result.length >= MAX_RETAINED_EVIDENCE_FRAMES) return;
    seen.add(frame.path);
    result.push({ frame, relevance });
  };

  // Candidate-grounded visual timestamps are the strongest comparison frames.
  for (const place of args.evidence.places) {
    for (const item of place.explicitEvidence) {
      if (item.source === 'frame' && typeof item.timestampSeconds === 'number') {
        add(nearestFrame(eligible, item.timestampSeconds), 'candidate_evidence');
      }
    }
  }
  for (const timestamp of selectedByVayrin) add(nearestFrame(eligible, timestamp), 'vayrin_selected');
  for (const frame of eligible) add(frame, selectedByVayrin.length > 0 ? 'vayrin_selected' : 'analysis_coverage');
  return result;
}

/** Best-effort private persistence. Recognition must still complete if Storage
 * is unavailable; the client then renders the honest missing-frame state. */
export async function persistEvidenceFrames(
  client: SupabaseClient,
  task: MediaTask,
  selected: readonly { frame: SelectedFrame; relevance: PersistedEvidenceFrame['relevance'] }[],
): Promise<PersistedEvidenceFrame[]> {
  if (!task.share_job_id || selected.length === 0) return [];
  const prefix = `${task.user_id}/${task.share_job_id}/${task.id}`;
  const bounded: Array<{ frame: SelectedFrame; relevance: PersistedEvidenceFrame['relevance'] }> = [];
  for (const item of selected.slice(0, MAX_RETAINED_EVIDENCE_FRAMES)) {
    try {
      const info = await stat(item.frame.path);
      if (info.size > 0 && info.size <= MAX_RETAINED_EVIDENCE_FRAME_BYTES) bounded.push(item);
    } catch {
      // A missing temp frame simply cannot become durable evidence.
    }
  }
  if (bounded.length === 0) return [];

  try {
    const bucket = client.storage.from(SHARE_EVIDENCE_BUCKET);
    const { data: previous, error: listError } = await bucket.list(prefix, { limit: 20 });
    if (listError) {
      log.warn('evidence_frame_list_failed', {
        taskId: task.id,
        jobId: task.share_job_id,
        message: listError.message.slice(0, 120),
      });
    }
    const stale = (previous ?? []).map((object) => `${prefix}/${object.name}`);
    if (stale.length > 0) {
      const { error: removeError } = await bucket.remove(stale);
      if (removeError) {
        log.warn('evidence_frame_stale_cleanup_failed', {
          taskId: task.id,
          jobId: task.share_job_id,
          count: stale.length,
          message: removeError.message.slice(0, 120),
        });
      }
    }

    const uploaded = await Promise.all(bounded.map(async ({ frame, relevance }, index) => {
      const timestampKey = Math.round(frame.timestampSeconds * 1000);
      const storagePath = `${prefix}/${String(index).padStart(2, '0')}-${timestampKey}.jpg`;
      const bytes = await readFile(frame.path);
      const { error } = await bucket.upload(storagePath, bytes, {
        contentType: 'image/jpeg',
        cacheControl: '86400',
        upsert: true,
      });
      if (error) {
        log.warn('evidence_frame_upload_failed', {
          taskId: task.id,
          jobId: task.share_job_id,
          index,
          message: error.message.slice(0, 120),
        });
        return null;
      }
      return {
        id: `${task.id}:${timestampKey}`,
        storagePath,
        timestampSeconds: frame.timestampSeconds,
        width: frame.width,
        height: frame.height,
        relevance,
      } satisfies PersistedEvidenceFrame;
    }));
    return uploaded.filter((frame): frame is PersistedEvidenceFrame => frame !== null);
  } catch (error) {
    log.warn('evidence_frame_persistence_failed', {
      taskId: task.id,
      jobId: task.share_job_id,
      message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    return [];
  }
}
