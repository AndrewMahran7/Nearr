import { readFile, writeFile } from 'node:fs/promises';
import type { SelectedFrame } from '../types/media.js';

export const MAX_RETAINED_FRAME_BYTES = 512 * 1024;

export type RetainedFrameSnapshot = {
  postgresBytea: string;
  timestampSeconds: number;
};

/** Keep one relevant JPEG only. The database constraint repeats this byte cap;
 * oversized frames are skipped rather than turning task rows into media blobs. */
export async function encodeRetainedFrameSnapshot(
  frames: readonly SelectedFrame[],
): Promise<RetainedFrameSnapshot | null> {
  for (const frame of frames) {
    try {
      const bytes = await readFile(frame.path);
      if (bytes.length === 0 || bytes.length > MAX_RETAINED_FRAME_BYTES) continue;
      return {
        postgresBytea: `\\x${bytes.toString('hex')}`,
        timestampSeconds: frame.timestampSeconds,
      };
    } catch {
      // Try the next relevant frame; unreadable temp files are not durable.
    }
  }
  return null;
}

function decodeBytea(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) return value.length ? Buffer.from(value) : null;
  if (typeof value !== 'string') return null;
  const hex = value.startsWith('\\x') ? value.slice(2) : '';
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = Buffer.from(hex, 'hex');
  return bytes.length > 0 && bytes.length <= MAX_RETAINED_FRAME_BYTES ? bytes : null;
}

export async function restoreRetainedFrameSnapshot(args: {
  value: unknown;
  timestampSeconds: unknown;
  outputPath: string;
}): Promise<SelectedFrame | null> {
  const bytes = decodeBytea(args.value);
  const timestampSeconds = Number(args.timestampSeconds);
  if (!bytes || !Number.isFinite(timestampSeconds) || timestampSeconds < 0) return null;
  await writeFile(args.outputPath, bytes);
  return {
    path: args.outputPath,
    timestampSeconds,
    width: 0,
    height: 0,
    aHash: '0000000000000000',
    reason: 'interval',
  };
}
