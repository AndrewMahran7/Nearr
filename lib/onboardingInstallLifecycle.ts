import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';

import { sharedAuth } from '@/lib/sharedAuth';
import {
  classifyOnboardingInstallation,
  isSupabaseAuthStorageKey,
  ONBOARDING_INSTALL_MARKER_VERSION,
  type OnboardingInstallMarker,
} from '@/lib/onboardingInstallLifecycleCore';

export const ONBOARDING_INSTALL_MARKER_KEY = 'nearr:onboarding:installation:v1';

export const INSTALL_SCOPED_ANONYMOUS_KEYS = [
  'nearr:onboarding:v2:state',
  'nearr:onboarding:v2:funnel-id',
  'nearr:onboarding:v2:account-transfer',
  'nearr:onboarding:demo_completed:v1',
  'nearr:onboarding:existing-account-intent:v1',
  'nearr.pendingPremiumRequestJobId.v1',
  'nearr.sharedPlace.pending.v1',
  'nearr.sharedPlace.acquisition.v1',
  'nearr:auth:lastAuthenticatedUserId:v1',
  'nearr.devAuthEnabled',
] as const;

export type OnboardingInstallLifecycle = {
  installationId: string;
  nativeInstalledAtMs: number | null;
  isNewInstall: boolean;
  reason:
    | 'marker_missing'
    | 'marker_invalid'
    | 'native_install_changed'
    | 'marker_matches_native_install'
    | 'native_install_time_unavailable'
    | 'bootstrap_storage_failed';
  clearedKeys: string[];
  persistedAuthCleared: boolean;
};

let lifecyclePromise: Promise<OnboardingInstallLifecycle> | null = null;

async function nativeInstallationTimeMs(): Promise<number | null> {
  try {
    const installedAt = await Application.getInstallationTimeAsync();
    const value = installedAt.getTime();
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.warn('[onboarding-install] native_install_time_unavailable', error);
    return null;
  }
}

function newMarker(nativeInstalledAtMs: number | null): OnboardingInstallMarker {
  return {
    version: ONBOARDING_INSTALL_MARKER_VERSION,
    installationId: Crypto.randomUUID(),
    nativeInstalledAtMs,
    createdAt: new Date().toISOString(),
  };
}

async function clearFreshInstallAnonymousState(): Promise<string[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const keys = Array.from(new Set([
    ...INSTALL_SCOPED_ANONYMOUS_KEYS,
    ...allKeys.filter(isSupabaseAuthStorageKey),
  ]));
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  // The App Group can outlive ordinary app-sandbox state on iOS. It is never
  // an installation authority; remove only the bridged short-lived token.
  sharedAuth.clearToken();
  return keys;
}

async function bootstrapLifecycle(): Promise<OnboardingInstallLifecycle> {
  const installedAtMs = await nativeInstallationTimeMs();
  try {
    const markerRaw = await AsyncStorage.getItem(ONBOARDING_INSTALL_MARKER_KEY);
    const decision = classifyOnboardingInstallation({ markerRaw, nativeInstalledAtMs: installedAtMs });
    if (decision.kind === 'same_install') {
      return {
        installationId: decision.marker.installationId,
        nativeInstalledAtMs: installedAtMs,
        isNewInstall: false,
        reason: decision.reason,
        clearedKeys: [],
        persistedAuthCleared: true,
      };
    }

    const clearedKeys = await clearFreshInstallAnonymousState();
    const marker = newMarker(installedAtMs);
    // Marker is written last. If the process dies during cleanup, the next
    // launch safely repeats the idempotent reset instead of trusting stale state.
    await AsyncStorage.setItem(ONBOARDING_INSTALL_MARKER_KEY, JSON.stringify(marker));
    console.log(`[onboarding-install] ${decision.reason} action=welcome`);
    return {
      installationId: marker.installationId,
      nativeInstalledAtMs: installedAtMs,
      isNewInstall: true,
      reason: decision.reason,
      clearedKeys,
      persistedAuthCleared: true,
    };
  } catch (error) {
    // Storage failure can cost resume, but must never cost startup. Use a
    // process-scoped install identity and let onboarding fail safe to Welcome.
    const installationId = Crypto.randomUUID();
    sharedAuth.clearToken();
    console.warn('[onboarding-install] bootstrap_storage_failed action=welcome', error);
    return {
      installationId,
      nativeInstalledAtMs: installedAtMs,
      isNewInstall: true,
      reason: 'bootstrap_storage_failed',
      clearedKeys: [],
      persistedAuthCleared: false,
    };
  }
}

export function ensureOnboardingInstallLifecycle(): Promise<OnboardingInstallLifecycle> {
  lifecyclePromise ??= bootstrapLifecycle();
  return lifecyclePromise;
}

/** Test seam for deterministic process/reinstall simulations. */
export function resetOnboardingInstallLifecycleForTests(): void {
  lifecyclePromise = null;
}
