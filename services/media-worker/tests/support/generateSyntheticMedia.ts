// services/media-worker/tests/support/generateSyntheticMedia.ts
//
// Generate small SYNTHETIC test media locally with ffmpeg (lavfi sources — no
// fonts, no copyrighted content). Used by the gated integration test and the
// `fixtures:generate` script. Never commit real social videos.

import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { execBinary, binaryAvailable } from '../../src/util/exec.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

export type SyntheticSet = {
  dir: string;
  videoWithAudio: string;
  videoNoAudio: string;
  staticRepeated: string;
  corrupt: string;
};

async function ff(args: string[]): Promise<void> {
  const res = await execBinary(FFMPEG, args, { timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`ffmpeg failed: ${res.stderr.slice(-400)}`);
}

export async function ffmpegAvailable(): Promise<boolean> {
  return binaryAvailable(FFMPEG, '-version');
}

export async function generateSyntheticMedia(outDir: string): Promise<SyntheticSet> {
  await mkdir(outDir, { recursive: true });
  const p = (name: string) => path.join(outDir, name);

  const videoWithAudio = p('video_with_audio.mp4');
  const videoNoAudio = p('video_no_audio.mp4');
  const staticRepeated = p('static_repeated.mp4');
  const corrupt = p('corrupt.mp4');

  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=15:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    videoWithAudio,
  ]);

  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=15:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    videoNoAudio,
  ]);

  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:size=320x568:rate=15:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    staticRepeated,
  ]);

  // Corrupt/invalid media: random bytes with an .mp4 name.
  await writeFile(corrupt, randomBytes(2048));

  return { dir: outDir, videoWithAudio, videoNoAudio, staticRepeated, corrupt };
}

// Allow running directly: `node --import tsx tests/support/generateSyntheticMedia.ts [outDir]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] || path.join(process.cwd(), 'tests', 'fixtures');
  generateSyntheticMedia(outDir)
    .then((s) => {
      // eslint-disable-next-line no-console
      console.log(`Synthetic media written to ${s.dir}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
