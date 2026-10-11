import type { SelectedFrame } from '../types/media.js';
import { hammingDistanceHex } from '../util/hash.js';

/** Bounded source-time probes, not the first N retained frames. */
export function temporalProbeIndices(times: number[], maximum = 24): number[] {
  if (!times.length) return [];
  const count = Math.min(times.length, maximum);
  if (count === 1) return [0];
  const first = times[0]!, span = times[times.length - 1]! - first;
  return [...new Set(Array.from({ length: count }, (_, i) => {
    const target = first + span * i / (count - 1);
    return times.reduce((best, t, index) => Math.abs(t - target) < Math.abs(times[best]! - target) ? index : best, 0);
  }))];
}

export function selectAdaptiveFrames(probes: SelectedFrame[], maximum: number, sourceText: string) {
  if (!probes.length) return { frames: [], trace: { probe_count: 0, selected_budget: 0, reason: 'no_visual_input' } };
  const distances = probes.slice(1).map((f, i) => hammingDistanceHex(probes[i]!.aHash, f.aHash));
  const mean = distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const unique = new Set(probes.map((f) => f.aHash)).size;
  const transitions = distances.filter((d) => d >= 18).length;
  // A source hint only increases coverage; it never establishes multi-place truth.
  const multiHint = /\b(?:itinerary|road\s*trip|(?:top|these|visit)\s+\d+\s+(?:places|spots|beaches|waterfalls|cafes|restaurants)|day\s*[1-9])\b/i.test(sourceText);
  const desired = multiHint || transitions >= 4 || unique > 10 ? 24 : unique <= 3 && mean <= 8 ? 6 : 12;
  const budget = Math.min(maximum, probes.length, desired);
  const selected = new Set<number>([0]);
  if (budget > 1) selected.add(probes.length - 1);
  // Every temporal stratum contributes a frame; prefer a scene boundary within
  // the stratum, with both endpoints mandatory. No identity model is involved.
  for (let b = 0; b < budget - 2; b++) {
    const start = 1 + Math.floor(b * (probes.length - 2) / (budget - 2));
    const end = 1 + Math.floor((b + 1) * (probes.length - 2) / (budget - 2));
    let best = start;
    for (let i = start + 1; i < end; i++) if ((distances[i - 1] ?? 0) > (distances[best - 1] ?? 0)) best = i;
    selected.add(best);
  }
  const frames = [...selected].sort((a, b) => a - b).map((i) => probes[i]!);
  return { frames, trace: { probe_count: probes.length, unique_probe_hashes: unique,
    mean_adjacent_hamming: mean, transition_count: transitions, source_multi_hint: multiHint,
    selected_budget: budget, reason: multiHint ? 'source_multi_hint_coverage' : desired === 24 ? 'high_scene_diversity' : desired === 6 ? 'low_scene_diversity' : 'moderate_scene_diversity',
    limitation: 'At most 24 temporal probes; sub-probe transients can be missed. Bounded perceptual-hash selection, not learned landmark, OCR or embedding salience.' } };
}
