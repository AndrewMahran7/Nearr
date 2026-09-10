import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import type { OnboardingPermissionResult } from './onboardingV2Core';
import { normalizeOnboardingPermission } from './onboardingV2SecondHalfCore';

function normalizeLocation(response: Location.LocationPermissionResponse): OnboardingPermissionResult {
  return normalizeOnboardingPermission({ status: response.status, canAskAgain: response.canAskAgain });
}

export async function requestOnboardingForegroundLocation(): Promise<OnboardingPermissionResult> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === 'granted' || current.canAskAgain === false) return normalizeLocation(current);
    return normalizeLocation(await Location.requestForegroundPermissionsAsync());
  } catch {
    return 'error';
  }
}

export async function requestOnboardingBackgroundLocation(): Promise<OnboardingPermissionResult> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return normalizeLocation(foreground);
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted' || current.canAskAgain === false) return normalizeLocation(current);
    return normalizeLocation(await Location.requestBackgroundPermissionsAsync());
  } catch {
    return 'error';
  }
}

export async function requestOnboardingNotifications(): Promise<OnboardingPermissionResult> {
  try {
    const current = await Notifications.getPermissionsAsync();
    const currentProvisional = current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (current.status === 'granted' || currentProvisional || current.canAskAgain === false) {
      return normalizeOnboardingPermission({ status: current.status, canAskAgain: current.canAskAgain, provisional: currentProvisional });
    }
    const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    return normalizeOnboardingPermission({
      status: requested.status,
      canAskAgain: requested.canAskAgain,
      provisional: requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    });
  } catch {
    return 'error';
  }
}
