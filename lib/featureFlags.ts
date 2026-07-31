/**
 * lib/featureFlags.ts
 *
 * Runtime feature flags for Nearr. Currently just the async share-jobs
 * rollout switch, plus the `create-share-job` Edge Function URL resolver.
 *
 * Resolution mirrors lib/shareEnvDiagnostics.ts exactly (process.env first,
 * then expoConfig.extra, then the legacy manifest shapes) so a build where
 * EXPO_PUBLIC_* was not inlined still picks up the value written into
 * `extra` by app.config.js.
 *
 * DEPENDENCY RULE: keep this file importable from the iOS Share Extension
 * target — only `expo-constants`, no `lib/supabase`, no `lib/shareAgent/*`.
 *
 * Flag is DEFAULT OFF. When off, the app keeps the existing synchronous
 * share flow untouched (see docs/ASYNC_SHARE_JOBS.md → Feature flag).
 */

import Constants from 'expo-constants';

import { resolveBooleanFlag } from '@/lib/featureFlagsCore';

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Read a single `extra` key across every runtime config shape. */
function readExtra(key: string): string {
  const fromExpoConfig = trim(
    (Constants?.expoConfig?.extra as Record<string, unknown> | undefined)?.[key],
  );
  if (fromExpoConfig) return fromExpoConfig;

  const manifestExtra =
    (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } })?.manifest
      ?.extra ?? null;
  const fromManifest = trim(manifestExtra?.[key]);
  if (fromManifest) return fromManifest;

  const manifest2Extra =
    (Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
    })?.manifest2?.extra?.expoClient?.extra ?? null;
  return trim(manifest2Extra?.[key]);
}

/**
 * True when the async share-job flow should be used. Default OFF.
 *
 * Enable per build with:
 *   eas env:create EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED --value true
 */
export function isAsyncShareJobsEnabled(): boolean {
  return resolveBooleanFlag(
    process.env.EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED,
    readExtra('asyncShareJobsEnabled'),
  );
}

/**
 * Resolve the `create-share-job` Edge Function URL. Empty string when not
 * configured — callers MUST treat empty as "async disabled / fall back".
 */
export function resolveCreateShareJobUrl(): string {
  const fromEnv = trim(process.env.EXPO_PUBLIC_CREATE_SHARE_JOB_URL);
  if (fromEnv) return fromEnv;
  return readExtra('createShareJobUrl');
}
