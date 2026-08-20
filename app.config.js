// Dynamic Expo config. Reads native API keys + Supabase config from env so
// nothing sensitive is committed to app.json. See .env.example for the full
// list of variables.
//
// Loading order (Expo handles this automatically for `EXPO_PUBLIC_*`, but we
// also need plain `GOOGLE_MAPS_*` for the native config blocks):
//   .env.local > .env > process.env
//
// If you add new keys, document them in .env.example.

const GOOGLE_MAPS_IOS_KEY =
  process.env.GOOGLE_MAPS_IOS_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const GOOGLE_MAPS_ANDROID_KEY =
  process.env.GOOGLE_MAPS_ANDROID_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const GOOGLE_PLACES_REST_KEY =
  (process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY || '').trim() ||
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim() ||
  '';
const GOOGLE_PLACES_REST_KEY_SOURCE = (process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY || '').trim()
  ? 'dedicated_places_key'
  : (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim()
  ? 'maps_fallback'
  : 'missing';

// NOTE(ios-share-extension): Re-enabled in app.json after the first
// TestFlight build shipped as a single-target app. Before submitting a
// build that includes the extension, make sure:
//   1. App Group `group.com.nearr.ios` exists in the Apple Developer
//      portal and is attached to BOTH `com.nearr.ios` and
//      `com.nearr.ios.ShareExtension`.
//   2. EAS has provisioning profiles for BOTH bundle IDs
//      (`eas credentials` → iOS → add the extension bundle ID).
//   3. A dev build (`eas build --profile development --platform ios`) on
//      a real device successfully receives a shared URL.
// If App Store Connect upload fails again with a multi-target error,
// remove the `expo-share-extension` plugin entry from app.json to revert
// to a single-target build while you debug provisioning.

// ---------------------------------------------------------------------------
// Environment declaration (see docs/DEVELOPMENT_WORKFLOW.md)
// ---------------------------------------------------------------------------
//
// Two independent axes, both declared explicitly by the EAS environment or the
// eas.json build profile — never inferred from a URL:
//
//   EXPO_PUBLIC_APP_ENV      development | preview | production
//   EXPO_PUBLIC_BACKEND_ENV  development | production
//
// The authoritative ruleset lives in lib/appEnvironmentCore.ts and is enforced
// by `npm run verify:env` (which the deploy scripts run) and surfaced at
// runtime by lib/appEnvironment.ts. The guard below implements the rules that
// can be decided from config alone and
// must never reach a build:
//
//   a declared lane must not contradict itself or name the wrong Supabase project.
//
// An UNDECLARED build is never blocked here, so adopting this system does not
// break an existing `expo start`; under-declaration is caught by the deploy
// wrappers instead. Keep this in sync with appEnvironmentCore's Rules 2 and 3.

const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV || '').trim();
const BACKEND_ENV = (process.env.EXPO_PUBLIC_BACKEND_ENV || '').trim().toLowerCase();
const DEV_SUPABASE_HOST = 'qnfxnmvxpjzfydgudtvs.supabase.co';
const PRODUCTION_SUPABASE_HOST = 'rlqvxdwtetxsqxhqztkw.supabase.co';

function assertEnvironmentIsCoherent() {
  if (!APP_ENV) return; // undeclared: advisory only, see note above
  if (APP_ENV === 'production' && BACKEND_ENV === 'development') {
    throw new Error(
      '[APP_ENV] Refusing to generate config: EXPO_PUBLIC_APP_ENV=production with ' +
        'EXPO_PUBLIC_BACKEND_ENV=development. A production build must never ship ' +
        'development endpoints. Fix the `production` EAS environment. ' +
        '(docs/DEVELOPMENT_WORKFLOW.md → Environment variables)',
    );
  }
  if (APP_ENV !== 'production' && BACKEND_ENV === 'production') {
    throw new Error(
      `[APP_ENV] Refusing to generate config: EXPO_PUBLIC_APP_ENV=${APP_ENV} with ` +
        'EXPO_PUBLIC_BACKEND_ENV=production. Experimental code must not reach real ' +
        'user data. Point this lane at Nearr-Dev. There is no production override. ' +
        '(docs/DEVELOPMENT_WORKFLOW.md → Environment variables)',
    );
  }
  if (/^(true|1|yes|on)$/i.test((process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND || '').trim())) {
    throw new Error(
      '[APP_ENV] EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND is retired. Remove it; ' +
        'development and preview builds may never reach production.',
    );
  }

  const rawSupabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  let configuredHost = '';
  try {
    configuredHost = new URL(rawSupabaseUrl).hostname.toLowerCase();
  } catch {
    // Empty/invalid is rejected below with the same fail-closed message.
  }
  const expectedHost =
    BACKEND_ENV === 'development' ? DEV_SUPABASE_HOST : PRODUCTION_SUPABASE_HOST;
  if (!configuredHost || configuredHost !== expectedHost) {
    throw new Error(
      `[APP_ENV] Refusing config: BACKEND_ENV=${BACKEND_ENV || '(unset)'} must use ` +
        `${expectedHost}, but EXPO_PUBLIC_SUPABASE_URL resolves to ` +
        `${configuredHost || '(missing/invalid)'}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Side-by-side dev app (APP_VARIANT=dev)
// ---------------------------------------------------------------------------
//
// OFF BY DEFAULT. Production output is byte-identical unless APP_VARIANT=dev.
//
// When enabled this produces a SEPARATE iOS app ("Nearr Dev",
// com.nearr.ios.dev) that installs alongside App Store Nearr instead of
// replacing it. Everything derived from the bundle identifier moves with it:
// expo-share-extension generates `com.nearr.ios.dev.ShareExtension` and the
// App Group `group.com.nearr.ios.dev` (see `getAppGroup` in the plugin).
//
// THIS REQUIRES ONE-TIME APPLE + SUPABASE SETUP BEFORE IT WILL BUILD OR SIGN.
// Do not enable it until the checklist in docs/DEVELOPMENT_WORKFLOW.md →
// "Side-by-side dev app" is done: the two bundle IDs and the App Group must
// exist in the Apple Developer portal, Sign in with Apple must accept the dev
// bundle ID, and `nearrdev://auth-callback` must be an allowed Supabase Auth
// redirect. The separate `scheme` is what stops iOS from arbitrarily handing a
// `nearr://` deep link to whichever of the two apps it feels like.
// SIMPLE MODE (2026-08-19): eas.json deliberately does NOT set APP_VARIANT on
// the development or preview profiles, so both build the existing identity and
// the dev build REPLACES App Store Nearr on the test device. Isolation comes
// from the EAS environment (which points at the Nearr-Dev Supabase project),
// not from the bundle identifier — requiring the Apple portal work below would
// have meant no development build at all.
//
// To restore side-by-side once that work is done, add
//   "env": { "APP_VARIANT": "dev" }
// back to those two build profiles. Everything below stays inert until then.
// Note: eas.json rejects unknown keys, so this note cannot live there.
const IS_DEV_VARIANT = (process.env.APP_VARIANT || '').trim().toLowerCase() === 'dev';

module.exports = ({ config }) => {
  assertEnvironmentIsCoherent();

  const variant = IS_DEV_VARIANT
    ? {
        name: 'Nearr Dev',
        scheme: 'nearrdev',
        iosBundleIdentifier: 'com.nearr.ios.dev',
        androidPackage: 'com.nearr.app.dev',
      }
    : {
        name: config.name,
        scheme: config.scheme,
        iosBundleIdentifier: config.ios && config.ios.bundleIdentifier,
        androidPackage: config.android && config.android.package,
      };

  return {
    ...config,
    name: variant.name,
    scheme: variant.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: variant.iosBundleIdentifier,
      config: {
        ...(config.ios && config.ios.config),
        googleMapsApiKey: GOOGLE_MAPS_IOS_KEY,
      },
    },
    android: {
      ...config.android,
      package: variant.androidPackage,
      config: {
        ...(config.android && config.android.config),
        googleMaps: {
          ...(config.android &&
            config.android.config &&
            config.android.config.googleMaps),
          apiKey: GOOGLE_MAPS_ANDROID_KEY,
        },
      },
    },
    extra: {
      ...config.extra,
      // 2026-08-19: which lane this build belongs to, and which backend it was
      // pointed at. Read via lib/appEnvironment.ts (process.env first, this
      // `extra` fallback second — same inlining caveat as the URLs below).
      // These are what the Settings "Build info" card renders, so a device can
      // always answer "which app/update am I actually looking at?".
      appEnv: APP_ENV,
      backendEnv: BACKEND_ENV,
      // Expose to runtime via Constants.expoConfig.extra.* as a fallback for
      // code paths that don't read process.env directly.
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      googlePlacesKey: GOOGLE_PLACES_REST_KEY,
      // Lets the device prove whether the slot contains the dedicated REST key
      // or the native Maps compatibility fallback without exposing the value.
      googlePlacesKeySource: GOOGLE_PLACES_REST_KEY_SOURCE,
      // 2026-05-26: surface PROCESS_SHARE_LINK_URL in extra too. The iOS
      // share extension and lib/shareExtractionBackend.ts both fall back
      // to Constants.expoConfig.extra.processShareLinkUrl when the env
      // var was not inlined at build time (EAS builds without
      // `eas env:create EXPO_PUBLIC_PROCESS_SHARE_LINK_URL ...`).
      processShareLinkUrl: process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL || '',
      // 2026-07-31: async share-jobs feature flag + create-share-job endpoint.
      // Default OFF. When disabled the app keeps the existing synchronous
      // share flow untouched. Read via lib/featureFlags.ts (process.env first,
      // this extra fallback second). Same inlining caveat as above: EAS builds
      // need `eas env:create EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED true` (and the
      // create-share-job URL) or the flag stays off at runtime.
      asyncShareJobsEnabled:
        process.env.EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED || '',
      createShareJobUrl: process.env.EXPO_PUBLIC_CREATE_SHARE_JOB_URL || '',
    },
  };
};
