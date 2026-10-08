import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/env.js';
import { extractFramesWithStrategy } from '../../src/pipeline/extractFrames.js';
import { deduplicateFrames } from '../../src/pipeline/deduplicateFrames.js';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { execBinary, binaryAvailable } from '../../src/util/exec.js';
import { sha256File } from '../../src/util/hash.js';

test('batched hashing preserves JPEGs, timestamps and scene evidence on CFR, VFR, and duplicate images', async (t) => {
  const cfg = { ...loadConfig(), maxSelectedFrames: 12, frameIntervalSeconds: 0.5 };
  if (!(await binaryAvailable(cfg.ffmpegPath)) || !(await binaryAvailable(cfg.ffprobePath))) {
    t.skip('ffmpeg/ffprobe unavailable'); return;
  }
  const work = await mkdtemp(path.join(tmpdir(), 'nearr-frame-parity-'));
  const signal = new AbortController().signal;
  try {
    for (const kind of ['cfr', 'vfr', 'static'] as const) {
      const input = path.join(work, `${kind}.mp4`);
      const source = kind === 'static' ? 'color=blue:size=320x568:rate=15:duration=4' : 'testsrc2=size=320x568:rate=15:duration=4';
      const filter = kind === 'vfr' ? "select='if(lt(t,2),1,not(mod(n,3)))'" : "drawbox=x=0:y=0:w=160:h=280:color=red:t=fill:enable='between(t,1.5,2.5)'";
      const created = await execBinary(cfg.ffmpegPath, ['-y', '-f', 'lavfi', '-i', source,
        '-vf', filter, '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input], { timeoutMs: 20_000 });
      assert.equal(created.code, 0, created.stderr.slice(-500));
      const probe = await inspectMedia(cfg, input, signal);
      const representations = [];
      for (const strategy of ['legacy', 'batched_hash'] as const) {
        const dir = path.join(work, `${kind}-${strategy}`); await mkdir(dir);
        const frames = await extractFramesWithStrategy(cfg, probe, input, dir, signal, strategy);
        assert.ok(frames.every((frame) => /^[0-9a-f]{16}$/.test(frame.aHash)), `${kind}/${strategy}: every synthetic frame must hash`);
        representations.push({ images: await Promise.all(frames.map(async (frame) => ({
          time: frame.timestampSeconds, reason: frame.reason, hash: frame.aHash, sha256: await sha256File(frame.path),
        }))), survivors: deduplicateFrames(frames).map((f) => f.timestampSeconds) });
      }
      assert.deepEqual(representations[1], representations[0], kind);
      assert.ok(representations[0]!.images.length >= 7, 'coverage cannot disappear');
      assert.equal(representations[0]!.images[0]?.reason, 'first');
      assert.equal(representations[0]!.images.at(-1)?.reason, 'last');
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});
