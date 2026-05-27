/**
 * lib/shareEnvDiagnostics.ts
 *
 * Single source of truth for resolving the `process-share-link` Edge
 * Function URL across every runtime location we care about, and for
 * formatting that information for on-screen diagnostics in the host
 * app and the iOS Share Extension.
 *
 * Why it exists (2026-05-26): TestFlight builds were repeatedly
 * shipping with `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` not inlined,
 * which caused the mobile app to silently fall back to the legacy
 * client-side heuristic and never invoke the Edge Function. The
 * remote tester proved the backend works; the mobile bug was purely
 * a runtime routing/config gap. This module gives both surfaces
 * (host app + share extension) one predictable resolver and one
 * shape we can show on-screen in production builds.
 *
 * Keep dependency-free except `expo-constants`. No imports from
 * `lib/shareAgent/*` or `lib/supabase` — this must be safe to import
 * from the share-extension target too.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type ShareEnvSource =
  | 'process_env'
  | 'expo_config_extra'
  | 'manifest_extra'
  | 'manifest2_extra'
  | 'none';

export type ShareEnvResolution = {
  /** The trimmed URL. Empty string if no source had a value. */
  url: string;
  /** First source that produced the URL. `none` when unconfigured. */
  source: ShareEnvSource;
  /** Per-source presence flags — useful for diagnostics. */
  sources: Record<Exclude<ShareEnvSource, 'none'>, boolean>;
};

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the Edge Function URL from every location it could live in
 * on a built EAS app:
 *   1. `process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` (inlined at
 *      build time by EAS when `eas env:create EXPO_PUBLIC_*` was
 *      configured for the build profile).
 *   2. `Constants.expoConfig?.extra?.processShareLinkUrl` (modern
 *      Expo SDK runtime config — written by app.config.js).
 *   3. `Constants.manifest?.extra?.processShareLinkUrl` (legacy
 *      Expo Go / classic builds).
 *   4. `Constants.manifest2?.extra?.expoClient?.extra?.processShareLinkUrl`
 *      (EAS Update modern manifest shape).
 *
 * Returns the FIRST non-empty hit and a presence map for the rest.
 */
export function resolveProcessShareLinkUrl(): ShareEnvResolution {
  const fromEnv = trim(process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL);
  const fromExpoConfig = trim(
    (Constants?.expoConfig?.extra as Record<string, unknown> | undefined)?.processShareLinkUrl,
  );
  // Older RN/Expo runtimes typed `manifest` loosely; cast through any
  // so we can still introspect without depending on deprecated types.
  const manifestExtra =
    (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } })?.manifest
      ?.extra ?? null;
  const fromManifest = trim(manifestExtra?.processShareLinkUrl);
  const manifest2Extra =
    (Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
    })?.manifest2?.extra?.expoClient?.extra ?? null;
  const fromManifest2 = trim(manifest2Extra?.processShareLinkUrl);

  const sources = {
    process_env: !!fromEnv,
    expo_config_extra: !!fromExpoConfig,
    manifest_extra: !!fromManifest,
    manifest2_extra: !!fromManifest2,
  };
  let url = '';
  let source: ShareEnvSource = 'none';
  if (fromEnv) { url = fromEnv; source = 'process_env'; }
  else if (fromExpoConfig) { url = fromExpoConfig; source = 'expo_config_extra'; }
  else if (fromManifest) { url = fromManifest; source = 'manifest_extra'; }
  else if (fromManifest2) { url = fromManifest2; source = 'manifest2_extra'; }

  return { url, source, sources };
}

/** Best-effort hostname for a URL. Returns null for empty/invalid input.
 *  Used for diagnostics — we deliberately never display the full URL
 *  (it can contain query strings / tokens in dev environments). */
export function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    // RN's URL polyfill is reliable in app code, but fall back to a
    // regex slice just in case (e.g. share-extension cold start).
    const m = url.match(/^https?:\/\/([^/?#]+)/i);
    return m?.[1] ?? null;
  }
}

export type AppBuildDiagnostics = {
  version: string | null;
  buildNumber: string | null;
  platform: typeof Platform.OS;
  channel: string | null;
};

/** Build/version info that's safe to show on screen. */
export function getAppBuildDiagnostics(): AppBuildDiagnostics {
  const expoConfig = Constants?.expoConfig as
    | { version?: string; ios?: { buildNumber?: string }; android?: { versionCode?: number } }
    | undefined;
  const ios = (expoConfig?.ios?.buildNumber ?? null) as string | null;
  const android =
    typeof expoConfig?.android?.versionCode === 'number'
      ? String(expoConfig?.android?.versionCode)
      : null;
  const channel =
    (Constants as unknown as { expoConfig?: { updates?: { channel?: string } } })
      ?.expoConfig?.updates?.channel ?? null;
  return {
    version: trim(expoConfig?.version) || null,
    buildNumber: Platform.OS === 'ios' ? ios : android,
    platform: Platform.OS,
    channel,
  };
}
