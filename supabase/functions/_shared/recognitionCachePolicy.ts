// Server-authoritative recognition answer-cache policy.
//
// A missing or malformed value intentionally suspends reads. Re-enabling is an
// explicit operational action: set RECOGNITION_CACHE_READS_ENABLED=true and
// restart/redeploy the Edge functions that import this module. Cache writes
// are deliberately independent and remain enabled in recognitionCache.ts.

export const RECOGNITION_CACHE_READS_FLAG = 'RECOGNITION_CACHE_READS_ENABLED';

export type RecognitionCachePolicy = Readonly<{
  readsEnabled: boolean;
  writesEnabled: true;
  cacheReadSuspended: boolean;
  source: 'explicit_true' | 'explicit_false' | 'default_suspended' | 'invalid_suspended';
}>;

type EnvReader = (name: string) => string | undefined;

export function resolveRecognitionCachePolicy(read: EnvReader): RecognitionCachePolicy {
  const raw = read(RECOGNITION_CACHE_READS_FLAG);
  const normalized = (raw ?? '').trim().toLowerCase();
  const readsEnabled = normalized === 'true';
  const source = readsEnabled
    ? 'explicit_true'
    : normalized === 'false'
    ? 'explicit_false'
    : normalized === ''
    ? 'default_suspended'
    : 'invalid_suspended';
  return Object.freeze({
    readsEnabled,
    writesEnabled: true as const,
    cacheReadSuspended: !readsEnabled,
    source,
  });
}

export function readRecognitionCachePolicy(): RecognitionCachePolicy {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  }).Deno;
  return resolveRecognitionCachePolicy((name) => deno?.env?.get?.(name));
}

export function forceFreshRecognitionSubmission(policy: RecognitionCachePolicy): boolean {
  return !policy.readsEnabled;
}

/** A source-only saved-place match is a historical answer, not place dedupe. */
export function reuseSavedPlaceBySourceOnly(policy: RecognitionCachePolicy): boolean {
  return policy.readsEnabled;
}

export function recognitionCacheDiagnostics(policy: RecognitionCachePolicy): Readonly<{
  recognitionCacheRead: false;
  cacheReadUsed: false;
  cacheReadSuspended: boolean;
  recognitionCacheWritesEnabled: true;
}> {
  return Object.freeze({
    recognitionCacheRead: false,
    cacheReadUsed: false,
    cacheReadSuspended: policy.cacheReadSuspended,
    recognitionCacheWritesEnabled: true,
  });
}

const logged = new Set<string>();

/** One bounded, content-free line per isolate/component. */
export function logRecognitionCachePolicy(
  component: string,
  policy: RecognitionCachePolicy,
): void {
  const key = `${component}:${policy.readsEnabled}:${policy.source}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.log(JSON.stringify({
    event: 'recognition_cache_policy',
    component: component.slice(0, 64),
    recognitionCacheReadsEnabled: policy.readsEnabled,
    recognitionCacheWritesEnabled: policy.writesEnabled,
    cacheReadSuspended: policy.cacheReadSuspended,
    source: policy.source,
  }));
}
