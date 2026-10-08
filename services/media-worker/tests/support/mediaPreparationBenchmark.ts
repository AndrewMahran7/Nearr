// Local causal scheduling control. Fixed 1000ms ASR delay is simulated, not a
// measurement of any transcription provider. All audio/frame work is real.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/env.js';
import { prepareMediaEvidence } from '../../src/pipeline/prepareMediaEvidence.js';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { sha256File } from '../../src/util/hash.js';
import { generateSyntheticMedia } from './generateSyntheticMedia.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = path.join(root, '.tmp', 'media-preparation');
await mkdir(scratch, { recursive: true });
const input = await generateSyntheticMedia(path.join(scratch, 'inputs'));
const cfg = { ...loadConfig(), maxSelectedFrames: 24, frameIntervalSeconds: 1 };
const signal = new AbortController().signal;
const probe = await inspectMedia(cfg, input.videoWithAudio, signal);
const variants = [
  { id: 'baseline_repaired', frameExtractionStrategy: 'legacy' as const, parallelMediaPreparation: false },
  { id: 'batched_hash', frameExtractionStrategy: 'batched_hash' as const, parallelMediaPreparation: false },
  { id: 'parallel_media', frameExtractionStrategy: 'legacy' as const, parallelMediaPreparation: true },
  { id: 'batch_parallel', frameExtractionStrategy: 'batched_hash' as const, parallelMediaPreparation: true },
];
const rows: Array<Record<string, unknown>> = [];
for (let repeat = 0; repeat < 3; repeat++) {
  for (const variant of repeat % 2 ? [...variants].reverse() : variants) {
    const work = await mkdtemp(path.join(scratch, 'job-'));
    const spans: Record<string, number> = {};
    let audioSha256: string | null = null;
    try {
      const prepared = await prepareMediaEvidence({ cfg: { ...cfg, ...variant }, probe,
        media: { canonicalUrl: 'https://example.invalid/control', localFilePath: input.videoWithAudio,
          mimeType: 'video/mp4', sizeBytes: 0, source: 'synthetic_control', warnings: [] },
        playable: input.videoWithAudio, platform: 'synthetic_control', workDir: work, signal,
        progress: async () => {}, measure: async (stage, _provider, run) => {
          const start = performance.now(); const result = await run(); spans[stage] = performance.now() - start; return result;
        },
        transcription: { name: 'local_scheduling_control', transcribe: async (request) => {
          audioSha256 = request.audioPath ? await sha256File(request.audioPath) : null;
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          return { provider: 'local_scheduling_control', segments: [{ startSeconds: 0, endSeconds: 1, text: 'CONTROL ASR RESULT' }], language: 'en', status: 'success' };
        } },
      });
      const fingerprint = { audioSha256, transcript: prepared.transcript, frames: await Promise.all(prepared.frames.map(async (f) => ({
        time: f.timestampSeconds, hash: f.aHash, sha256: await sha256File(f.path), reason: f.reason,
      }))) };
      const row = { variant: variant.id, repeat, wallMs: prepared.wallMs, spans, fingerprint, providerCalls: 0, simulatedAsrDelayMs: 1000 };
      rows.push(row); console.log(JSON.stringify({ variant: variant.id, repeat, wallMs: Math.round(prepared.wallMs) }));
    } finally { await rm(work, { recursive: true, force: true }); }
  }
}
const expected = JSON.stringify(rows[0]?.fingerprint);
for (const row of rows) row.evidenceParity = JSON.stringify(row.fingerprint) === expected;
const out = path.join(root, 'artifacts', 'recognition-optimization-2026-10-08', 'media_preparation_controls.json');
await writeFile(out, JSON.stringify({ scope: 'Synthetic causal scheduling controls, no recognition ground truth and no provider latency measurement', rows }, null, 2) + '\n', { flag: 'wx' });
if (rows.some((row) => !row.evidenceParity)) throw new Error('evidence_parity_failed');
