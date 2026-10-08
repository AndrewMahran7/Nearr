import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { PremiumPlacesSearch } from './premiumRecognitionTypes.js';

export const PREMIUM_PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types';
export type PlacesExecutionMode = 'serial' | 'memoized' | 'bounded';
type Result = Awaited<ReturnType<PremiumPlacesSearch>>;
export type PlacesQueryRecord = {
  fingerprint: string;
  disposition: 'provider' | 'memoized' | 'coalesced' | 'cancelled';
  queueMs: number;
  latencyMs: number;
  resultCount: number | null;
  ok: boolean;
};

/** Invalid configuration must serialize work, never bypass the permit bound
 * (NaN comparisons are false) or make Array.from create zero workers. */
function normalizeConcurrency(value: number, upperBound: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(upperBound, Math.floor(value))) : 1;
}

/** One recognition execution owns this object. It is never a global answer
 * cache. Keep exact query text and provider semantics: case/diacritics and
 * geographic qualifiers are not interchangeable. No credentials are logged. */
export function createPlacesQuerySession(args: {
  search: PremiumPlacesSearch;
  mode: PlacesExecutionMode;
  concurrency?: number;
}) {
  const limit = args.mode === 'bounded' ? normalizeConcurrency(args.concurrency ?? 3, 3) : 1;
  let active = 0;
  let peakActive = 0;
  let actualRequests = 0;
  const waiting: Array<() => void> = [];
  const cache = new Map<string, { pending: boolean; promise: Promise<Result> }>();
  const signalIds = new WeakMap<AbortSignal, number>();
  let nextSignalId = 1;
  const records: PlacesQueryRecord[] = [];
  const search: PremiumPlacesSearch = async (query, apiKey, signal) => {
    const semantics = JSON.stringify({ endpoint: 'places:searchText.v1', query,
      fieldMask: PREMIUM_PLACES_FIELD_MASK, maxResultCount: 8 });
    const fingerprint = createHash('sha256').update(semantics).digest('hex');
    if (signal && !signalIds.has(signal)) signalIds.set(signal, nextSignalId++);
    // Key and cancellation ownership affect reuse, but never the exported fingerprint.
    const key = JSON.stringify([semantics, apiKey, signal ? signalIds.get(signal) : 0]);
    const started = performance.now();
    if (signal?.aborted) {
      records.push({ fingerprint, disposition: 'cancelled', queueMs: 0, latencyMs: 0, resultCount: null, ok: false });
      return { ok: false, reason: 'aborted' };
    }
    const cached = args.mode === 'serial' ? undefined : cache.get(key);
    if (cached) {
      const disposition = cached.pending ? 'coalesced' as const : 'memoized' as const;
      const response = await cached.promise;
      const result: Result = signal?.aborted ? { ok: false, reason: 'aborted' } : response;
      records.push({ fingerprint, disposition, queueMs: 0, latencyMs: performance.now() - started,
        resultCount: result.ok ? result.results.length : null, ok: result.ok });
      return structuredClone(result);
    }
    const entry: { pending: boolean; promise: Promise<Result> } = { pending: true, promise: undefined! };
    const execute = async (): Promise<Result> => {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      else active += 1;
      const queueMs = performance.now() - started;
      const providerStarted = performance.now();
      let result: Result;
      try {
        if (signal?.aborted) result = { ok: false, reason: 'aborted' };
        else {
          actualRequests += 1;
          peakActive = Math.max(peakActive, active);
          result = await args.search(query, apiKey, signal);
        }
      } catch {
        result = { ok: false, reason: signal?.aborted ? 'aborted' : 'places_transport_error' };
      } finally {
        const next = waiting.shift();
        if (next) next(); // transfer this permit without oversubscribing
        else active -= 1;
      }
      if (signal?.aborted) result = { ok: false, reason: 'aborted' };
      records.push({ fingerprint, disposition: result.ok || result.reason !== 'aborted' ? 'provider' : 'cancelled',
        queueMs, latencyMs: performance.now() - providerStarted, resultCount: result.ok ? result.results.length : null, ok: result.ok });
      entry.pending = false;
      // Transient failures must not poison retries in the same job.
      if (!result.ok) cache.delete(key);
      return result;
    };
    // Defer to a microtask so the entry exists even if a provider throws synchronously.
    entry.promise = Promise.resolve().then(execute);
    if (args.mode !== 'serial') cache.set(key, entry);
    return structuredClone(await entry.promise);
  };
  return { search, telemetry: () => ({ version: 'places-query-session.v1' as const,
    mode: args.mode, concurrencyLimit: limit, peakActive, actualRequests,
    requestedQueries: records.length, avoidedRequests: records.filter((r) => r.disposition === 'memoized' || r.disposition === 'coalesced').length,
    records: records.map((r) => ({ ...r })) }) };
}

/** Preserve input order while limiting asynchronous work. */
export async function mapPlacesInOrder<T, U>(values: readonly T[], concurrency: number, fn: (value: T, index: number) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(values.length);
  let cursor = 0;
  const limit = Math.min(values.length, normalizeConcurrency(concurrency, values.length));
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      out[index] = await fn(values[index]!, index);
    }
  }));
  return out;
}
