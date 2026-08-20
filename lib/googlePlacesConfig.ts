/** Runtime adapter for the pure Google Places key-selection contract. */

import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { getEnvironmentInputs } from './appEnvironment';
import {
  resolveGooglePlacesConfig,
  type ResolvedGooglePlacesConfig,
} from './googlePlacesConfigCore';

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readExtra(key: string): string {
  const expoExtra = Constants?.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExpoConfig = trim(expoExtra?.[key]);
  if (fromExpoConfig) return fromExpoConfig;

  const manifestExtra =
    (Constants as unknown as { manifest?: { extra?: Record<string, unknown> } })?.manifest
      ?.extra ?? null;
  const fromManifest = trim(manifestExtra?.[key]);
  if (fromManifest) return fromManifest;

  return trim(
    (Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
    })?.manifest2?.extra?.expoClient?.extra?.[key],
  );
}

export function getGooglePlacesRuntimeConfig(): ResolvedGooglePlacesConfig {
  const environment = getEnvironmentInputs();
  return resolveGooglePlacesConfig({
    appEnvironment: environment.appEnv,
    backendEnvironment: environment.backendEnv,
    // Static dot notation is required for Expo's EXPO_PUBLIC_* inlining.
    envPlacesKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY,
    envMapsKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    extraPlacesKey: readExtra('googlePlacesKey'),
    extraPlacesKeySource: readExtra('googlePlacesKeySource'),
  });
}

export type GooglePlacesRuntimeDiagnostic = Omit<ResolvedGooglePlacesConfig, 'key'> & {
  present: boolean;
  fingerprint: string | null;
};

/** Development/preview-only, one-way diagnostic. Never returns key contents. */
export async function getGooglePlacesRuntimeDiagnostic(): Promise<GooglePlacesRuntimeDiagnostic> {
  const resolved = getGooglePlacesRuntimeConfig();
  let fingerprint: string | null = null;
  if (resolved.key && (resolved.appEnvironment === 'development' || resolved.appEnvironment === 'preview')) {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      resolved.key,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    fingerprint = digest.slice(0, 8);
  }
  const { key, ...safe } = resolved;
  return { ...safe, present: Boolean(key), fingerprint };
}
