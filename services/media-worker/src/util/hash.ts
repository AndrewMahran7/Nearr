// services/media-worker/src/util/hash.ts
//
// Content hashing (sha256 for media integrity) + a deterministic perceptual
// average-hash (aHash) used to deduplicate near-identical frames without any
// heavy image dependency. The 8x8 grayscale bytes are produced by ffmpeg.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Average-hash from a 64-pixel (8x8) grayscale buffer. Each output bit is 1 if
 * the pixel is >= the frame mean, else 0. Returned as 16 hex chars (64 bits).
 */
export function averageHashFromGray8x8(bytes: Uint8Array): string {
  const n = Math.min(bytes.length, 64);
  if (n === 0) return '0000000000000000';
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += bytes[i] ?? 0;
  const mean = sum / n;

  let hex = '';
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let v = 0;
    for (let bit = 0; bit < 4; bit += 1) {
      const idx = nibble * 4 + bit;
      const pixel = idx < n ? (bytes[idx] ?? 0) : 0;
      v = (v << 1) | (pixel >= mean ? 1 : 0);
    }
    hex += v.toString(16);
  }
  return hex;
}

const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) t[i] = (i & 1) + (t[i >> 1] ?? 0);
  return t;
})();

/** Hamming distance between two equal-length hex hash strings (0..64). */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let dist = 0;
  for (let i = 0; i < a.length; i += 1) {
    const xor = (parseInt(a[i] ?? '0', 16) ^ parseInt(b[i] ?? '0', 16)) & 0xf;
    dist += POPCOUNT[xor] ?? 0;
  }
  return dist;
}
