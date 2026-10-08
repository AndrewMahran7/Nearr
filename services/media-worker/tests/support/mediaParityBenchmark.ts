// Offline only. No provider client, database, environment credentials or network.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/env.js';
import { inspectMedia } from '../../src/pipeline/inspectMedia.js';
import { extractFramesWithStrategy, type FrameExtractionMetrics } from '../../src/pipeline/extractFrames.js';
import { deduplicateFrames } from '../../src/pipeline/deduplicateFrames.js';
import { sha256File } from '../../src/util/hash.js';
import { singleDecodeFrames } from './singleDecodeFrames.js';
import type { MediaProbe } from '../../src/types/media.js';

type Source = { id: string; kind: string; license: string; pageUrl: string };
type Item = Source & { file: string; sha256: string; group: string; split: string; probe: MediaProbe; bytes: number };
const args = process.argv.slice(2);
const arg = (key: string, fallback = '') => args[args.indexOf(key) + 1] && args.includes(key) ? args[args.indexOf(key) + 1]! : fallback;
const out = path.resolve(arg('--out', '../../artifacts/recognition-optimization-2026-10-08'));
const mediaRoot = path.resolve(arg('--media-root'));
const manifestFile = path.join(out, 'media_manifest.json');
const signal = new AbortController().signal;
const cfg = { ...loadConfig(), maxSelectedFrames: 24, frameIntervalSeconds: 1 };
await mkdir(out, { recursive: true });
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

if (args.includes('--freeze')) {
  const catalog = JSON.parse(await readFile(path.resolve(arg('--catalog')), 'utf8')) as { sources: Source[] };
  const items: Item[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const source of catalog.sources.filter((s) => s.kind === 'video')) {
    const file = `${source.id}.webm`;
    try {
      const full = path.join(mediaRoot, file);
      const bytes = (await stat(full)).size;
      if (bytes > cfg.maxDownloadBytes) { excluded.push({ id: source.id, reason: 'file_too_large' }); continue; }
      const probe = await inspectMedia(cfg, full, signal);
      items.push({ ...source, file, sha256: await sha256File(full), bytes, probe,
        group: source.id.replace(/_(a|b)_video$/, '_video'), split: '' });
    } catch (error) { excluded.push({ id: source.id, reason: error instanceof Error ? error.message : 'unavailable' }); }
  }
  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => digest(`media-parity-v1:${a}`).localeCompare(digest(`media-parity-v1:${b}`)));
  for (const item of items) {
    const i = groups.indexOf(item.group);
    item.split = i < Math.ceil(groups.length * 0.6) ? 'development' : i < Math.ceil(groups.length * 0.8) ? 'calibration' : 'held_out';
  }
  await writeFile(manifestFile, JSON.stringify({ schemaVersion: 1, plan: 'MEDIA_BENCHMARK_PLAN.json', items, excluded }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ frozen: items.length, groups: groups.length, excluded, bySplit: Object.fromEntries(['development', 'calibration', 'held_out'].map((s) => [s, items.filter((i) => i.split === s).length])) }));
} else {
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString()) as { items: Item[] };
  const split = arg('--split', 'development');
  const variants = arg('--variants', 'baseline_repaired,batched_hash,single_decode_eval').split(',');
  const repeats = Number(arg('--repeats', '1'));
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats_out_of_bounds');
  if (variants.some((v) => !['baseline_repaired', 'batched_hash', 'single_decode_eval'].includes(v))) throw new Error('unknown_variant');
  if (!variants.includes('baseline_repaired')) throw new Error('paired_baseline_required');
  const rows: unknown[] = [];
  const scratchRoot = fileURLToPath(new URL('../../../../.tmp/media-parity/', import.meta.url));
  await mkdir(scratchRoot, { recursive: true });
  for (const item of manifest.items.filter((i) => i.split === split)) {
    const full = path.join(mediaRoot, item.file);
    if (await sha256File(full) !== item.sha256) throw new Error(`source_hash_changed:${item.id}`);
    for (let repeat = 0; repeat < repeats; repeat++) {
      const data: Array<Record<string, unknown>> = [];
      const order = repeat % 2 ? [...variants].reverse() : variants;
      for (const variant of order) {
        const work = await mkdtemp(path.join(scratchRoot, `${item.id}-`));
        try {
          const start = performance.now();
          const metrics: FrameExtractionMetrics = { processCount: 0, cpuMs: 0, peakChildRssKiB: 0 };
          const frames = variant === 'single_decode_eval'
            ? await singleDecodeFrames(cfg, item.probe, full, work, signal)
            : await extractFramesWithStrategy(cfg, item.probe, full, work, signal, variant === 'batched_hash' ? 'batched_hash' : 'legacy', metrics);
          const durationMs = performance.now() - start;
          const evidence = await Promise.all(frames.map(async (frame) => ({
            timestampSeconds: frame.timestampSeconds, reason: frame.reason, aHash: frame.aHash,
            jpegSha256: await sha256File(frame.path),
          })));
          const survivors = deduplicateFrames(frames).map((f) => f.timestampSeconds);
          data.push({ id: item.id, sourceSha256: item.sha256, split, repeat, variant, durationMs,
            rawCount: frames.length, keptCount: survivors.length, evidence, survivors,
            metrics: variant === 'single_decode_eval' ? null : metrics, failure: null });
        } catch (error) {
          data.push({ id: item.id, split, repeat, variant, failure: error instanceof Error ? error.message : 'unknown', durationMs: null });
        } finally { await rm(work, { recursive: true, force: true }); }
      }
      const baseline = data.find((r) => r.variant === 'baseline_repaired')!;
      for (const row of data) {
        row.exactEvidenceParity = !row.failure && !baseline.failure && JSON.stringify(row.evidence) === JSON.stringify(baseline.evidence);
        row.dedupParity = !row.failure && !baseline.failure && JSON.stringify(row.survivors) === JSON.stringify(baseline.survivors);
        rows.push(row);
        console.log(JSON.stringify({ id: row.id, split, repeat, variant: row.variant, ms: Math.round(Number(row.durationMs)), parity: row.exactEvidenceParity, failure: row.failure }));
      }
    }
  }
  const output = arg('--name', `media_${split}_results.json`);
  await writeFile(path.join(out, output), JSON.stringify({ manifestSha256: digest(manifestBytes.toString()), split, variants, repeats,
    scope: 'Local frame evidence parity/timing, no model inference or recognition accuracy', rows }, null, 2) + '\n', { flag: 'wx' });
}
