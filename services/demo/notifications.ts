/**
 * Demo notifications. No real OS permissions, no background task. Just an
 * in-app `Alert` that mimics what a nearby ping would look like, so the
 * developer can validate the UX path end to end.
 */

import { Alert } from 'react-native';

import { listDemoSavedPlaces } from './savedPlacesService';

/**
 * Pick one saved place (preferring those with notifications enabled) and
 * show an in-app alert as if the proximity watcher had fired. Returns the
 * id of the place that was "notified" for, or null if there's nothing to
 * notify on.
 */
export async function simulateDemoNearbyNotification(): Promise<string | null> {
  const list = await listDemoSavedPlaces();
  const candidates = list.filter((s) => s.notifications_enabled);
  const pick = (candidates[0] ?? list[0]) ?? null;
  if (!pick) {
    Alert.alert(
      'No demo places',
      'Add or reset demo places before simulating a nearby alert.',
    );
    return null;
  }

  console.log('[demo:notifications] simulating nearby for', pick.place.name);
  Alert.alert(
    `You\u2019re near ${pick.place.name}`,
    pick.place.formatted_address ?? 'A saved place is in range.',
  );
  return pick.id;
}
