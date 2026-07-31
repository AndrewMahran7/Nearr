/**
 * lib/featureFlagsCore.ts
 *
 * PURE, dependency-free flag-resolution logic for lib/featureFlags.ts.
 *
 * Extracted so the "default OFF" contract can be locked down by a unit test
 * (scripts/testFeatureFlags.ts) without pulling in `expo-constants` or the
 * React Native runtime. No imports — safe from the iOS Share Extension target
 * and from ts-node.
 *
 * Contract:
 *   - A flag is ON only for an explicit truthy string ("true"/"1"/"yes"/"on").
 *   - Anything else — unset, empty, "false", "0", garbage — resolves OFF.
 *   - The build-time env value wins over the `extra` fallback.
 */

/** Truthy string test — accepts "true"/"1"/"yes"/"on" (case-insensitive). */
export function isTruthyFlag(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Resolve a boolean flag from a build-time env value with an `extra` fallback.
 * Env takes precedence when present (non-empty); otherwise the `extra` value
 * is consulted. Default OFF when neither is truthy.
 */
export function resolveBooleanFlag(envValue: unknown, extraValue: unknown): boolean {
  const env = typeof envValue === 'string' ? envValue.trim() : '';
  if (env) return isTruthyFlag(env);
  return isTruthyFlag(extraValue);
}
