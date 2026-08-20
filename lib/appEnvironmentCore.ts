/**
 * lib/appEnvironmentCore.ts
 *
 * PURE, dependency-free environment classification + validation.
 *
 * Extracted from lib/appEnvironment.ts (same split as
 * featureFlagsCore/featureFlags) so the rules can be locked down by
 * scripts/testAppEnvironment.ts and re-used by scripts/checkEnvironment.ts at
 * config-generation time — without pulling in `expo-constants` or the React
 * Native runtime. No imports: safe from the iOS Share Extension target and
 * from ts-node.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until 2026-08-19 Nearr had exactly one lane: `eas update` with no arguments
 * published straight to the `production` channel, and the only EAS environment
 * holding real values was `production`. Nothing in the repo could tell a
 * development build apart from a production one, so nothing could stop an
 * experiment from pointing at real user data — or a production build from
 * shipping a development endpoint. This module is that missing declaration.
 *
 * THE CONTRACT
 * ------------
 * Two independent, explicitly declared axes:
 *
 *   EXPO_PUBLIC_APP_ENV      which *app* this is  (development|preview|production)
 *   EXPO_PUBLIC_BACKEND_ENV  which *backend* it talks to (development|production)
 *
 * Neither is inferred from a URL, and no project ref is hardcoded here — the
 * repo must never need editing when a project is created or a key rotated.
 * Whoever configures an EAS environment declares both; the rules below reject
 * the combinations that are known to be dangerous.
 */

export type AppEnvironmentName = 'development' | 'preview' | 'production';
export type BackendEnvironmentName = 'development' | 'production';

export const APP_ENVIRONMENT_NAMES: readonly AppEnvironmentName[] = [
  'development',
  'preview',
  'production',
];

/** Raw, unresolved environment declaration. Every field may be absent. */
export type EnvironmentInputs = {
  appEnv?: unknown;
  backendEnv?: unknown;
  supabaseUrl?: unknown;
  processShareLinkUrl?: unknown;
  createShareJobUrl?: unknown;
  /**
   * Conscious, temporary opt-in letting a non-production build talk to the
   * production backend. Required while no development Supabase project exists.
   * Irrelevant for APP_ENV=production, which uses production by definition.
   */
  allowProductionBackend?: unknown;
  demoMode?: unknown;
  devPasswordLogin?: unknown;
  debugLogs?: unknown;
};

export type EnvironmentViolation = {
  /** Stable machine code — asserted by tests, printed by the CLI guard. */
  code: string;
  message: string;
};

export type ResolvedEnvironment = {
  appEnv: AppEnvironmentName;
  backendEnv: BackendEnvironmentName;
  /** True when the value was absent/invalid and the safe default was applied. */
  appEnvWasDefaulted: boolean;
  backendEnvWasDefaulted: boolean;
  allowProductionBackend: boolean;
  /** Host of each configured backend URL, or null when unset/unparseable. */
  supabaseHost: string | null;
  processShareLinkHost: string | null;
  createShareJobHost: string | null;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truthy(value: unknown): boolean {
  const v = str(value).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Host of a URL without depending on a URL polyfill. Null when unparseable. */
export function hostOf(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(raw);
  if (!match) return null;
  const authority = match[1];
  // Strip userinfo and port; keep the bare host.
  const afterUserInfo = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  const host = afterUserInfo.replace(/:\d+$/, '');
  return host.toLowerCase() || null;
}

export function isAppEnvironmentName(value: unknown): value is AppEnvironmentName {
  return APP_ENVIRONMENT_NAMES.includes(str(value) as AppEnvironmentName);
}

/**
 * Classify a raw declaration.
 *
 * The defaults are deliberately asymmetric:
 *   - APP_ENV defaults to `development` — an UNLABELLED build is treated as an
 *     experiment, never as production. Forgetting the variable must not
 *     silently promote something into the production lane.
 *   - BACKEND_ENV defaults to `production` — an UNLABELLED backend is assumed
 *     to be the real one, so Rule 3 fires and the build stops.
 * A completely unconfigured build therefore fails validation instead of
 * quietly doing the most dangerous thing.
 */
export function resolveEnvironment(inputs: EnvironmentInputs): ResolvedEnvironment {
  const rawAppEnv = str(inputs.appEnv);
  const appEnvWasDefaulted = !isAppEnvironmentName(rawAppEnv);
  const appEnv: AppEnvironmentName = appEnvWasDefaulted
    ? 'development'
    : (rawAppEnv as AppEnvironmentName);

  const rawBackendEnv = str(inputs.backendEnv).toLowerCase();
  const backendEnvWasDefaulted =
    rawBackendEnv !== 'development' && rawBackendEnv !== 'production';
  const backendEnv: BackendEnvironmentName = backendEnvWasDefaulted
    ? 'production'
    : (rawBackendEnv as BackendEnvironmentName);

  return {
    appEnv,
    backendEnv,
    appEnvWasDefaulted,
    backendEnvWasDefaulted,
    allowProductionBackend: truthy(inputs.allowProductionBackend),
    supabaseHost: hostOf(inputs.supabaseUrl),
    processShareLinkHost: hostOf(inputs.processShareLinkUrl),
    createShareJobHost: hostOf(inputs.createShareJobUrl),
  };
}

/**
 * Apply the safety rules. Returns every violation found.
 * An empty array means the combination is one we are willing to build or ship.
 *
 * Pure and total: never throws, never reads process.env, never does I/O.
 */
export function validateEnvironment(inputs: EnvironmentInputs): EnvironmentViolation[] {
  const r = resolveEnvironment(inputs);
  const violations: EnvironmentViolation[] = [];

  // ---- Rule 1: every lane must say out loud which lane it is. -----------
  if (r.appEnvWasDefaulted) {
    violations.push({
      code: 'APP_ENV_MISSING',
      message:
        'EXPO_PUBLIC_APP_ENV is unset or not one of development|preview|production. ' +
        'Treating this build as `development`. Declare it explicitly in the EAS ' +
        'environment (or the eas.json build profile `env`) for every lane.',
    });
  }

  if (r.backendEnvWasDefaulted) {
    violations.push({
      code: 'BACKEND_ENV_MISSING',
      message:
        'EXPO_PUBLIC_BACKEND_ENV is unset or not one of development|production. ' +
        'Assuming `production` so a mismatch is caught rather than hidden.',
    });
  }

  // ---- Rule 2: a PROD app must not ship a DEV backend. (Phase 16) -------
  if (r.appEnv === 'production' && r.backendEnv === 'development') {
    violations.push({
      code: 'PROD_APP_DEV_BACKEND',
      message:
        'APP_ENV=production is configured against BACKEND_ENV=development. A ' +
        'production build must never ship development endpoints. Fix the ' +
        '`production` EAS environment before building or updating.',
    });
  }

  // ---- Rule 3: a DEV app must not silently use the PROD backend. (Ph 15)
  if (r.appEnv !== 'production' && r.backendEnv === 'production') {
    if (!r.allowProductionBackend) {
      violations.push({
        code: 'DEV_APP_PROD_BACKEND',
        message:
          `APP_ENV=${r.appEnv} is configured against BACKEND_ENV=production. ` +
          'Experimental code must not reach real user data. Point this lane at a ' +
          'development backend, or — if you genuinely intend to test against ' +
          'production with a dedicated test account — set ' +
          'EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND=true so the choice is recorded.',
      });
    }
    // When the opt-in IS set the pairing is deliberate, so it is not a
    // violation. It stays visible because describeEnvironment() reports it and
    // the Settings build-info card renders it.
  }

  // ---- Rule 4: the three backend URLs must agree. -----------------------
  // Catches a half-repointed environment (Supabase moved, share URLs not),
  // which would post jobs to one project and read results from another.
  const hosts = [r.supabaseHost, r.processShareLinkHost, r.createShareJobHost].filter(
    (h): h is string => typeof h === 'string',
  );
  const distinct = Array.from(new Set(hosts));
  if (distinct.length > 1) {
    violations.push({
      code: 'BACKEND_HOST_MISMATCH',
      message:
        'Supabase URL, process-share-link URL and create-share-job URL do not all ' +
        `point at the same host (${distinct.join(', ')}). One of them was left ` +
        'behind when the environment was repointed.',
    });
  }

  // ---- Rule 5: a production build needs a backend at all. ---------------
  if (r.appEnv === 'production' && !r.supabaseHost) {
    violations.push({
      code: 'PROD_SUPABASE_MISSING',
      message:
        'APP_ENV=production but EXPO_PUBLIC_SUPABASE_URL is empty. This build ' +
        'would boot straight to the "reinstall the build" error screen.',
    });
  }

  // ---- Rule 6: developer-only switches must never reach production. -----
  if (r.appEnv === 'production') {
    if (truthy(inputs.demoMode)) {
      violations.push({
        code: 'PROD_DEMO_MODE',
        message: 'EXPO_PUBLIC_DEMO_MODE is enabled in a production build.',
      });
    }
    if (truthy(inputs.devPasswordLogin)) {
      violations.push({
        code: 'PROD_DEV_PASSWORD_LOGIN',
        message:
          'EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN is enabled in a production build.',
      });
    }
    if (truthy(inputs.debugLogs)) {
      violations.push({
        code: 'PROD_DEBUG_LOGS',
        message: 'EXPO_PUBLIC_DEBUG_LOGS is enabled in a production build.',
      });
    }
  }

  return violations;
}

/**
 * Violations that must HARD FAIL a build or config generation.
 *
 * A missing declaration is reported everywhere but only blocks once it
 * produces a genuinely unsafe pairing — otherwise adopting this system would
 * break every existing local `expo start`, and a guard nobody can run is a
 * guard nobody keeps.
 */
const BLOCKING_CODES: ReadonlySet<string> = new Set([
  'PROD_APP_DEV_BACKEND',
  'DEV_APP_PROD_BACKEND',
  'BACKEND_HOST_MISMATCH',
  'PROD_SUPABASE_MISSING',
  'PROD_DEMO_MODE',
  'PROD_DEV_PASSWORD_LOGIN',
  'PROD_DEBUG_LOGS',
]);

export function blockingViolations(
  violations: readonly EnvironmentViolation[],
): EnvironmentViolation[] {
  return violations.filter((v) => BLOCKING_CODES.has(v.code));
}

/** One-line, secret-free summary for logs, the CLI guard, and Settings. */
export function formatEnvironmentSummary(inputs: EnvironmentInputs): string {
  const r = resolveEnvironment(inputs);
  return [
    `app=${r.appEnv}${r.appEnvWasDefaulted ? '(defaulted)' : ''}`,
    `backend=${r.backendEnv}${r.backendEnvWasDefaulted ? '(defaulted)' : ''}`,
    `supabaseHost=${r.supabaseHost ?? 'none'}`,
    r.allowProductionBackend ? 'allowProductionBackend=true' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
