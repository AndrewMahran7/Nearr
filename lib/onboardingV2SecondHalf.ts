import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import type { OnboardingPermissionResult } from './onboardingV2Core';
import { normalizeOnboardingPermission } from './onboardingV2SecondHalfCore';

export type OnboardingPermissionAttempt = {
  result: OnboardingPermissionResult;
  requested: boolean;
  canAskAgain: boolean | null;
};

function normalizeLocation(response: Location.LocationPermissionResponse): OnboardingPermissionResult {
  return normalizeOnboardingPermission({ status: response.status, canAskAgain: response.canAskAgain });
}

export async function getOnboardingLocationPermissionSnapshot(): Promise<{
  foreground: OnboardingPermissionResult;
  background: OnboardingPermissionResult;
}> {
  try {
    const [foreground, background] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    return { foreground: normalizeLocation(foreground), background: normalizeLocation(background) };
  } catch {
    return { foreground: 'error', background: 'error' };
  }
}

export async function requestOnboardingForegroundLocation(): Promise<OnboardingPermissionAttempt> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === 'granted' || current.canAskAgain === false) {
      return { result: normalizeLocation(current), requested: false, canAskAgain: current.canAskAgain ?? null };
    }
    const response = await Location.requestForegroundPermissionsAsync();
    return { result: normalizeLocation(response), requested: true, canAskAgain: response.canAskAgain ?? null };
  } catch {
    return { result: 'error', requested: false, canAskAgain: null };
  }
}

export async function requestOnboardingBackgroundLocation(): Promise<OnboardingPermissionAttempt> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      return { result: normalizeLocation(foreground), requested: false, canAskAgain: foreground.canAskAgain ?? null };
    }
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted' || current.canAskAgain === false) {
      return { result: normalizeLocation(current), requested: false, canAskAgain: current.canAskAgain ?? null };
    }
    const response = await Location.requestBackgroundPermissionsAsync();
    return { result: normalizeLocation(response), requested: true, canAskAgain: response.canAskAgain ?? null };
  } catch {
    return { result: 'error', requested: false, canAskAgain: null };
  }
}

export async function requestOnboardingNotifications(): Promise<OnboardingPermissionAttempt> {
  try {
    const current = await Notifications.getPermissionsAsync();
    const currentProvisional = current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (current.status === 'granted' || currentProvisional || current.canAskAgain === false) {
      return { result: normalizeOnboardingPermission({ status: current.status, canAskAgain: current.canAskAgain, provisional: currentProvisional }), requested: false, canAskAgain: current.canAskAgain ?? null };
    }
    const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    return { result: normalizeOnboardingPermission({
      status: requested.status,
      canAskAgain: requested.canAskAgain,
      provisional: requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    }), requested: true, canAskAgain: requested.canAskAgain ?? null };
  } catch {
    return { result: 'error', requested: false, canAskAgain: null };
  }
}
