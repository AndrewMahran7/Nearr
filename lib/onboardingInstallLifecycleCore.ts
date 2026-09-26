export const ONBOARDING_INSTALL_MARKER_VERSION = 1 as const;
export const INSTALL_TIME_TOLERANCE_MS = 1_000;

export type OnboardingInstallMarker = {
  version: typeof ONBOARDING_INSTALL_MARKER_VERSION;
  installationId: string;
  nativeInstalledAtMs: number | null;
  createdAt: string;
};

export type InstallMarkerDecision =
  | { kind: 'same_install'; marker: OnboardingInstallMarker; reason: 'marker_matches_native_install' | 'native_install_time_unavailable' }
  | { kind: 'new_install'; reason: 'marker_missing' | 'marker_invalid' | 'native_install_changed' };

export type InstallCheckpointDecision =
  | { kind: 'resume'; reason: 'current_install_checkpoint' }
  | {
      kind: 'welcome';
      reason:
        | 'fresh_install_stale_onboarding_discarded'
        | 'checkpoint_installation_mismatch'
        | 'checkpoint_version_mismatch'
        | 'checkpoint_missing';
    };

export function decodeOnboardingInstallMarker(raw: string | null | undefined): OnboardingInstallMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingInstallMarker>;
    if (
      parsed.version !== ONBOARDING_INSTALL_MARKER_VERSION ||
      typeof parsed.installationId !== 'string' ||
      parsed.installationId.length < 16 ||
      (parsed.nativeInstalledAtMs !== null &&
        (typeof parsed.nativeInstalledAtMs !== 'number' || !Number.isFinite(parsed.nativeInstalledAtMs))) ||
      typeof parsed.createdAt !== 'string'
    ) return null;
    return parsed as OnboardingInstallMarker;
  } catch {
    return null;
  }
}

export function classifyOnboardingInstallation(input: {
  markerRaw: string | null | undefined;
  nativeInstalledAtMs: number | null;
  toleranceMs?: number;
}): InstallMarkerDecision {
  if (!input.markerRaw) return { kind: 'new_install', reason: 'marker_missing' };
  const marker = decodeOnboardingInstallMarker(input.markerRaw);
  if (!marker) return { kind: 'new_install', reason: 'marker_invalid' };
  if (input.nativeInstalledAtMs == null || marker.nativeInstalledAtMs == null) {
    return { kind: 'same_install', marker, reason: 'native_install_time_unavailable' };
  }
  if (
    Math.abs(input.nativeInstalledAtMs - marker.nativeInstalledAtMs) >
    (input.toleranceMs ?? INSTALL_TIME_TOLERANCE_MS)
  ) {
    return { kind: 'new_install', reason: 'native_install_changed' };
  }
  return { kind: 'same_install', marker, reason: 'marker_matches_native_install' };
}

export function decideInstallCheckpoint(input: {
  isNewInstall: boolean;
  currentInstallationId: string;
  checkpointInstallationId: string | null | undefined;
  checkpointVersionSupported: boolean;
  checkpointExists: boolean;
}): InstallCheckpointDecision {
  if (input.isNewInstall) {
    return { kind: 'welcome', reason: 'fresh_install_stale_onboarding_discarded' };
  }
  if (!input.checkpointExists) return { kind: 'welcome', reason: 'checkpoint_missing' };
  if (!input.checkpointVersionSupported) {
    return { kind: 'welcome', reason: 'checkpoint_version_mismatch' };
  }
  if (input.checkpointInstallationId !== input.currentInstallationId) {
    return { kind: 'welcome', reason: 'checkpoint_installation_mismatch' };
  }
  return { kind: 'resume', reason: 'current_install_checkpoint' };
}

export function isSupabaseAuthStorageKey(key: string): boolean {
  return /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?$/i.test(key);
}
