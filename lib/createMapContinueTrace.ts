import { areDeveloperToolsVisible } from './appEnvironment';

type TraceScalar = string | number | boolean | null | undefined;

/** Stable, non-reversible-enough correlation label; never logs the raw auth id. */
export function hashCreateMapTraceId(value: string | null | undefined): string | null {
  if (!value) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `u_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Development-lane runtime evidence. Callers pass enums, booleans, and hashes only. */
export function traceCreateMapContinue(
  event: string,
  fields: Record<string, TraceScalar>,
): void {
  if (!areDeveloperToolsVisible()) return;
  const bounded = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.slice(0, 160) : value ?? null,
    ]),
  );
  console.log('[create-map-continue]', { event, ...bounded });
}
