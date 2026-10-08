/** Offline request-scheduling experiment. Real retained query workloads, fake
 * transport delays; this is not recognition or provider latency evidence. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createPlacesQuerySession, mapPlacesInOrder, type PlacesExecutionMode } from '../premium/placesQuerySession.js';
import type { PremiumRecognitionExecution, PremiumPlacesSearch } from '../premium/premiumRecognitionTypes.js';

const args = process.argv.slice(2);
const get = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const source = get('--source'); const out = get('--out');
if (!source || !out) throw new Error('Use --source retained-local-runtime.jsonl --out unused-result-directory');
const bytes = await readFile(source);
const rows = bytes.toString('utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as { case_id: string; execution: PremiumRecognitionExecution });
await mkdir(out, { recursive: true });
const modes: PlacesExecutionMode[] = ['serial', 'memoized', 'bounded'];
const records: Array<Record<string, unknown>> = [];
for (let repeat = 0; repeat < 5; repeat++) {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const calls = row.execution.destinations.flatMap((d) => d.hypotheses.flatMap((h) => h.canonicalizationCalls));
    const responses = new Map<string, ReturnType<PremiumPlacesSearch>>();
    // We replay result identity projections only. Full response fields were not
    // retained; do not manufacture a canonicalization/accuracy claim from them.
    const provider: PremiumPlacesSearch = async (query) => {
      const call = calls.find((c) => c.query === query)!;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return call.outcome === 'PROVIDER_FAILURE'
        ? { ok: false, reason: call.rejectionReason ?? 'recorded_failure' }
        : { ok: true, results: call.resultIds.map((id, i) => ({ googlePlaceId: id, name: call.resultNames[i] ?? '',
          formattedAddress: null, latitude: null, longitude: null, types: [] })) };
    };
    let baseline: unknown;
    const order = modes.slice(repeat % 3).concat(modes.slice(0, repeat % 3));
    const outputs: Array<{ mode: PlacesExecutionMode; value: unknown }> = [];
    for (const mode of order) {
      const session = createPlacesQuerySession({ mode, search: provider });
      const start = performance.now();
      const result = await mapPlacesInOrder(calls, mode === 'bounded' ? 3 : 1, (call) => session.search(call.query, 'offline-only'));
      const duration = performance.now() - start;
      outputs.push({ mode, value: result });
      if (mode === 'serial') baseline = result;
      const telemetry = session.telemetry();
      records.push({ caseId: row.case_id, repeat, mode, queryCount: calls.length, actualMockRequests: telemetry.actualRequests,
        avoidedRequests: telemetry.avoidedRequests, elapsedMs: duration, peakConcurrent: telemetry.peakActive,
        resultIdsHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'), paidUsd: 0 });
    }
    for (const result of outputs) assert.deepEqual(result.value, baseline, `response projection drift ${row.case_id} ${result.mode}`);
  }
}
const percentile = (v: number[], p: number) => { const a = [...v].sort((x, y) => x - y); if (!a.length) return null; const pos = (a.length - 1) * p; const i = Math.floor(pos); return a[i]! + ((a[i + 1] ?? a[i])! - a[i]!) * (pos - i); };
const summary = modes.map((mode) => {
  const selected = records.filter((r) => r.mode === mode);
  const values = selected.map((r) => Number(r.elapsedMs));
  const oneRepeat = selected.filter((r) => r.repeat === 0);
  return { mode, uniqueCases: rows.length, pairedObservations: selected.length, queries: oneRepeat.reduce((n, r) => n + Number(r.queryCount), 0),
    actualMockRequests: oneRepeat.reduce((n, r) => n + Number(r.actualMockRequests), 0), p50: percentile(values, .5), p75: percentile(values, .75), p90: percentile(values, .9), p95: percentile(values, .95) };
});
await writeFile(path.join(out, 'places-session-benchmark.json'), JSON.stringify({ boundary: 'REAL_QUERY_WORKLOAD_MOCK_TRANSPORT',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'), delayMs: 5, repetitions: 5, equality: 'ordered response identity projection; not complete provider response or recognition accuracy',
  providerCalls: 0, paidUsd: 0, summary, records }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
