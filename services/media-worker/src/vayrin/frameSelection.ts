// services/media-worker/src/vayrin/frameSelection.ts
//
// Which of the already-extracted frames to send to the expensive model.
//
// This is a SELECTION layer, not a second extraction pipeline. The worker has
// already done the hard part: `extractFrames` samples on a 1s cadence up to
// `MEDIA_MAX_SELECTED_FRAMES` (24), scales to 768px, and computes an
// average-hash per frame; `deduplicateFrames` then drops interior near-
// duplicates. Everything below reorders and thins that existing set, so no new
// ffmpeg work and no new computer-vision machinery is introduced.
//
// The question this exists to answer: what is the SMALLEST frame set that still
// carries the geographic variation a model needs? Image tokens dominate the
// cost of a visual-geolocation call, and near-duplicate frames of the same wall
// contribute cost without contributing evidence.

import type { SelectedFrame } from '../types/media.js';
import { hammingDistanceHex } from '../util/hash.js';

export type FrameStrategy =
  /** Evenly spaced across the clip by TIME. The neutral baseline. */
  | 'uniform'
  /** The worker's own post-dedup ordering, truncated. What production has today. */
  | 'pipeline'
  /** Temporal strata with visual-diversity selection inside each stratum. */
  | 'diverse'
  /** Everything the worker produced, capped only by `maxFrames`. */
  | 'all';

export type FrameSelectionResult = {
  strategy: FrameStrategy;
  frames: SelectedFrame[];
  /** Frames considered before selection. */
  consideredCount: number;
  /** Mean pairwise average-hash distance of the CHOSEN frames, 0..64. A rough
   *  read on whether the selection actually captured visual variation — a set
   *  averaging under ~8 is largely the same shot repeated. */
  meanPairwiseDistance: number;
  /** Bounded, content-free explanation for every chosen timestamp. This is
   * observability only; it is derived after selection and cannot affect it. */
  decisions: Array<{
    timestampSeconds: number;
    reason:
      | 'within_budget'
      | 'boundary_first'
      | 'boundary_last'
      | 'temporal_stratum_farthest_hash'
      | 'uniform_temporal_index'
      | 'pipeline_order'
      | 'all_within_budget';
  }>;
};

/** Chronological order. Timestamps are what let the model group scenes, so a
 *  selection is always re-sorted before it is sent. */
function chronological(frames: SelectedFrame[]): SelectedFrame[] {
  return [...frames].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

export function meanPairwiseDistance(frames: SelectedFrame[]): number {
  if (frames.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      total += hammingDistanceHex(frames[i]!.aHash, frames[j]!.aHash);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : Number((total / pairs).toFixed(2));
}

/** Evenly spaced by index across the chronological set, endpoints included. */
function uniformPick(frames: SelectedFrame[], maxFrames: number): SelectedFrame[] {
  const ordered = chronological(frames);
  if (ordered.length <= maxFrames) return ordered;
  if (maxFrames === 1) return [ordered[0]!];
  const picked: SelectedFrame[] = [];
  for (let i = 0; i < maxFrames; i += 1) {
    const idx = Math.round((i * (ordered.length - 1)) / (maxFrames - 1));
    const frame = ordered[idx];
    if (frame && !picked.includes(frame)) picked.push(frame);
  }
  return picked;
}

/**
 * Temporally stratified farthest-point selection on average-hash distance.
 *
 * Every time stratum receives one frame, preventing a visually busy later
 * scene from consuming nearly the whole budget and starving an earlier place.
 * Within each stratum we still choose the frame farthest from those already
 * selected, preserving the talking-head/window benefit of visual diversity.
 * The first and last frames are anchors so clip boundaries cannot disappear.
 */
function diversePick(frames: SelectedFrame[], maxFrames: number): SelectedFrame[] {
  const ordered = chronological(frames);
  if (ordered.length <= maxFrames) return ordered;

  const chosen: SelectedFrame[] = [];
  for (let bucket = 0; bucket < maxFrames; bucket += 1) {
    const start = Math.floor((bucket * ordered.length) / maxFrames);
    const endExclusive = Math.floor(((bucket + 1) * ordered.length) / maxFrames);
    const candidates = ordered.slice(start, Math.max(start + 1, endExclusive));
    if (candidates.length === 0) continue;

    if (bucket === 0) {
      chosen.push(ordered[0]!);
      continue;
    }
    if (bucket === maxFrames - 1) {
      chosen.push(ordered[ordered.length - 1]!);
      continue;
    }

    let best = candidates[0]!;
    let bestDistance = -1;
    for (const candidate of candidates) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const picked of chosen) {
        const d = hammingDistanceHex(picked.aHash, candidate.aHash);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    chosen.push(best);
  }

  return chronological(chosen);
}

/**
 * Default frame budget for a production visual-geolocation call.
 *
 * Set from the cost/benefit shape rather than a round number: image tokens
 * scale linearly with frame count while marginal geographic information falls
 * off sharply once the distinct SCENES are covered, and a short-form social
 * video has very few distinct scenes. The local comparison found six diverse
 * frames exact on the verified positive while 12 doubled input cost without
 * improving specificity. `MEDIA_MAX_SELECTED_FRAMES` (24) remains the hard
 * ceiling this can never exceed.
 */
export const DEFAULT_VAYRIN_FRAME_BUDGET = 6;

export function selectFramesForVayrin(
  frames: SelectedFrame[],
  strategy: FrameStrategy = 'diverse',
  maxFrames: number = DEFAULT_VAYRIN_FRAME_BUDGET,
): FrameSelectionResult {
  const budget = Math.max(1, Math.floor(maxFrames));
  const considered = frames.length;

  let picked: SelectedFrame[];
  switch (strategy) {
    case 'all':
      picked = chronological(frames).slice(0, budget);
      break;
    case 'pipeline':
      picked = chronological(frames.slice(0, budget));
      break;
    case 'uniform':
      picked = uniformPick(frames, budget);
      break;
    case 'diverse':
    default:
      picked = diversePick(frames, budget);
      break;
  }

  const decisions: FrameSelectionResult['decisions'] = picked.map((frame, index) => {
    if (considered <= budget) {
      return { timestampSeconds: frame.timestampSeconds, reason: 'within_budget' as const };
    }
    if (strategy === 'diverse') {
      if (index === 0) return { timestampSeconds: frame.timestampSeconds, reason: 'boundary_first' as const };
      if (index === picked.length - 1) {
        return { timestampSeconds: frame.timestampSeconds, reason: 'boundary_last' as const };
      }
      return { timestampSeconds: frame.timestampSeconds, reason: 'temporal_stratum_farthest_hash' as const };
    }
    if (strategy === 'uniform') {
      return { timestampSeconds: frame.timestampSeconds, reason: 'uniform_temporal_index' as const };
    }
    if (strategy === 'pipeline') {
      return { timestampSeconds: frame.timestampSeconds, reason: 'pipeline_order' as const };
    }
    return { timestampSeconds: frame.timestampSeconds, reason: 'all_within_budget' as const };
  });

  return {
    strategy,
    frames: picked,
    consideredCount: considered,
    meanPairwiseDistance: meanPairwiseDistance(picked),
    decisions,
  };
}
