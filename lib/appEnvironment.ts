/**
 * lib/appEnvironment.ts
 *
 * Runtime side of the environment contract. Resolves the declaration written
 * by app.config.js and applies lib/appEnvironmentCore.ts.
 *
 * Resolution mirrors lib/featureFlags.ts exactly (process.env first, then
 * expoConfig.extra, then the legacy manifest shapes) so a build where the
 * EXPO_PUBLIC_* values were not inlined still picks up what app.config.js
 * wrote into `extra`.
 *
 * DEPENDENCY RULE: keep this file importable from the iOS Share Extension
 * target — only `expo-constants` and the pure core. No `lib/supabase`, no
 * `expo-updates`, no React Native modules.
 *
 * The real enforcement happens at BUILD time (scripts/checkEnvironment.ts and
 * the app.config.js guard). This module exists so the running app can *show*
 * which lane it is in — see the Settings build-info card — because the
 * 2026-08-18 incident was made much worse by nobody being able to tell which
 * JS a device was actually running.
 */

import Constants from 'expo-constants';

import {
  blockingViolations,
  formatEnvironmentSummary,
  resolveEnvironment,
  validateEnvironment,
  type AppEnvironmentName,
  type EnvironmentInputs,
  type EnvironmentViolation,
  type ResolvedEnvironment,
} from './appEnvironmentCore';

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

function pick(envValue: unknown, extraKey: string): string {
  const fromEnv = trim(envValue);
  if (fromEnv) return fromEnv;
  return readExtra(extraKey);
}

/** The declaration this build was compiled with. */
export function getEnvironmentInputs(): EnvironmentInputs {
  return {
    appEnv: pick(process.env.EXPO_PUBLIC_APP_ENV, 'appEnv'),
    backendEnv: pick(process.env.EXPO_PUBLIC_BACKEND_ENV, 'backendEnv'),
    supabaseUrl: pick(process.env.EXPO_PUBLIC_SUPABASE_URL, 'supabaseUrl'),
    processShareLinkUrl: pick(
      process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL,
      'processShareLinkUrl',
    ),
    createShareJobUrl: pick(
      process.env.EXPO_PUBLIC_CREATE_SHARE_JOB_URL,
      'createShareJobUrl',
    ),
    allowProductionBackend: pick(
      process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND,
      'allowProductionBackend',
    ),
    demoMode: trim(process.env.EXPO_PUBLIC_DEMO_MODE),
    devPasswordLogin: trim(process.env.EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN),
    debugLogs: trim(process.env.EXPO_PUBLIC_DEBUG_LOGS),
  };
}

// Resolve once at module load — the declaration is fixed at build time.
const RESOLVED: ResolvedEnvironment = resolveEnvironment(getEnvironmentInputs());
const VIOLATIONS: EnvironmentViolation[] = validateEnvironment(getEnvironmentInputs());

/** Which lane this build belongs to. */
export function getAppEnvironment(): AppEnvironmentName {
  return RESOLVED.appEnv;
}

export function isProductionEnvironment(): boolean {
  return RESOLVED.appEnv === 'production';
}

/**
 * True when developer-facing affordances (the Settings build-info card, the
 * Testing section) should be visible.
 *
 * Deliberately NOT `__DEV__`: an OTA published to the development channel is a
 * production-mode JS bundle, so `__DEV__` is false while running the dev app
 * from a dev-channel update — which is precisely when the build-info card is
 * most useful. Anything gated only on `__DEV__` disappears exactly when you
 * need it to tell you which update you are looking at.
 *
 * FAIL-CLOSED: this requires an EXPLICIT development/preview declaration. A
 * build that never declared APP_ENV shows nothing extra, so shipping this
 * cannot reveal developer affordances in the current App Store binary (whose
 * environment predates the declaration).
 */
export function areDeveloperToolsVisible(): boolean {
  return !RESOLVED.appEnvWasDefaulted && RESOLVED.appEnv !== 'production';
}

export function getResolvedEnvironment(): ResolvedEnvironment {
  return RESOLVED;
}

/** Violations detected at runtime. Empty in a correctly configured build. */
export function getEnvironmentViolations(): EnvironmentViolation[] {
  return VIOLATIONS;
}

/**
 * Only the violations that must stop a build or a submission.
 *
 * Used by the iOS Share Extension, which is configured entirely at build time
 * (it excludes expo-updates and expo-dev-client, so it never gets an OTA and
 * never attaches to Metro). It fails CLOSED on these rather than posting a job
 * into a backend it cannot prove is the right one.
 */
export function getBlockingEnvironmentViolations(): EnvironmentViolation[] {
  return blockingViolations(VIOLATIONS);
}

/** One-line, secret-free summary. Safe to log and to render. */
export function describeEnvironment(): string {
  return formatEnvironmentSummary(getEnvironmentInputs());
}

// Log the resolved lane once at startup, exactly like lib/supabase.ts logs
// [ENV_VALIDATION_SUCCESS]. Hosts only — never a key, never a token.
const blocking = blockingViolations(VIOLATIONS);
if (blocking.length > 0) {
  console.warn(
    '[APP_ENV] UNSAFE CONFIGURATION — ' +
      describeEnvironment() +
      ' violations=' +
      blocking.map((v) => v.code).join(','),
  );
  for (const v of blocking) console.warn('[APP_ENV] ' + v.code + ': ' + v.message);
} else {
  console.log('[APP_ENV] ' + describeEnvironment());
}
