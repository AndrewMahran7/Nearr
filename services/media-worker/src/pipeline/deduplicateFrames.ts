// services/media-worker/src/pipeline/deduplicateFrames.ts
//
// PURE perceptual dedup. Drop interior frames whose average-hash is within
// `threshold` Hamming distance of an already-kept frame. First/last endpoints
// are always kept for coverage. Prefers fewer high-value frames over dozens of
// near-duplicates.

import type { SelectedFrame } from '../types/media.js';
import { hammingDistanceHex } from '../util/hash.js';

export const DEFAULT_DEDUP_THRESHOLD = 6; // out of 64 bits

export function deduplicateFrames(
  frames: SelectedFrame[],
  threshold: number = DEFAULT_DEDUP_THRESHOLD,
): SelectedFrame[] {
  const kept: SelectedFrame[] = [];
  for (const f of frames) {
    const isEndpoint = f.reason === 'first' || f.reason === 'last';
    const isDup = kept.some((k) => hammingDistanceHex(k.aHash, f.aHash) <= threshold);
    if (isEndpoint || !isDup) kept.push(f);
  }
  return kept;
}
