/**
 * lib/featureFlags.ts
 *
 * Runtime feature flags for Nearr, plus the `create-share-job` Edge Function
 * URL resolver.
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

import { resolveBooleanFlag } from './featureFlagsCore';

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

/** True when the validated Place Recommendations V1 surface is enabled. */
export function isPlaceRecommendationsEnabled(): boolean {
  return resolveBooleanFlag(
    process.env.EXPO_PUBLIC_PLACE_RECOMMENDATIONS_ENABLED,
    readExtra('placeRecommendationsEnabled'),
  );
}

/**
 * Saved-place identity markers default on through app config. An explicit
 * false in a newly built/published bundle selects the legacy marker path. No
 * EAS environment is changed by defining this reader.
 */
export function isMapPinRedesignEnabled(): boolean {
  return resolveBooleanFlag(
    process.env.EXPO_PUBLIC_MAP_PIN_REDESIGN_ENABLED,
    readExtra('mapPinRedesignEnabled'),
  );
}

/** Enable the user-facing Vayrin presentation without changing recognition. */
export function isVayrinProductUiEnabled(): boolean {
  return resolveBooleanFlag(
    process.env.EXPO_PUBLIC_VAYRIN_PRODUCT_UI_ENABLED,
    readExtra('vayrinProductUiEnabled'),
  );
}

/**
 * Onboarding V2 is intentionally default OFF until the isolated lane is
 * integrated and its real social links pass the physical device matrix.
 */
export function isOnboardingV2Enabled(): boolean {
  return resolveBooleanFlag(
    process.env.EXPO_PUBLIC_ONBOARDING_V2_ENABLED,
    readExtra('onboardingV2Enabled'),
  );
}

/**
 * Production safety boundary for the initial V2 rollout. Phase 1 only is the
 * fail-safe default: Phase 2 can run only after an explicit `false` value is
 * shipped in a later product release.
 */
export function isOnboardingV2Phase1Only(): boolean {
  const raw = trim(
    process.env.EXPO_PUBLIC_ONBOARDING_V2_PHASE1_ONLY ||
      readExtra('onboardingV2Phase1Only'),
  ).toLowerCase();
  return raw !== 'false' && raw !== '0';
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
