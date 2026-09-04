import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SelectedFrame } from '../types/media.js';
import { selectFramesForVayrin } from '../vayrin/frameSelection.js';
import type { FrameSet } from './types.js';

export function buildAutomaticFrameSets(frames: SelectedFrame[], currentBudget: number, currentStrategy: 'uniform' | 'pipeline' | 'diverse' | 'all'): { F1: FrameSet; F2: FrameSet } {
  const f1 = selectFramesForVayrin(frames, currentStrategy, Math.max(1, currentBudget));
  const f2 = selectFramesForVayrin(frames, 'diverse', 15);
  return {
    F1: { arm: 'F1', strategy: `current_nearr_${f1.strategy}_${currentBudget}`, considered_count: f1.consideredCount, mean_pairwise_distance: f1.meanPairwiseDistance, frames: f1.frames },
    F2: { arm: 'F2', strategy: 'broad_temporal_diverse_up_to_15', considered_count: f2.consideredCount, mean_pairwise_distance: f2.meanPairwiseDistance, frames: f2.frames },
  };
}

const MANUAL_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function loadManualFrameSet(directory: string): Promise<FrameSet | null> {
  let names: string[];
  try { names = await readdir(directory); } catch { return null; }
  const imageNames = names.filter((name) => MANUAL_EXTENSIONS.has(path.extname(name).toLowerCase())).sort();
  if (imageNames.length === 0) return null;
  const frames: SelectedFrame[] = [];
  for (let index = 0; index < imageNames.length; index += 1) {
    const name = imageNames[index]!;
    const filePath = path.join(directory, name);
    const bytes = await readFile(filePath);
    const leadingNumber = /^(\d+(?:\.\d+)?)/.exec(name);
    frames.push({
      path: filePath,
      timestampSeconds: leadingNumber ? Number(leadingNumber[1]) : index,
      width: 0,
      height: 0,
      aHash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      reason: index === 0 ? 'first' : index === imageNames.length - 1 ? 'last' : 'interval',
    });
  }
  return { arm: 'F3', strategy: 'founder_supplied_exact_files', considered_count: frames.length, mean_pairwise_distance: null, frames };
}
