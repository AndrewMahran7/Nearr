/**
 * Helpers for opening a saved place in the user's external maps app.
 *
 * Prior versions stored `https://www.google.com/maps/place/?q=place_id:<ID>`
 * in `places.google_maps_url`. That URL pattern is treated as a free-text
 * search by Google Maps and reliably renders "No results found on Google
 * Maps." We therefore:
 *
 *   1. Detect that broken pattern and ignore it.
 *   2. Build a URL from lat/lng (+ google_place_id) using the official
 *      Maps URL scheme that Google actually documents:
 *        https://developers.google.com/maps/documentation/urls/get-started#search-action
 *   3. Fall back to a name/address text search.
 *   4. Last-resort: try Apple Maps on iOS if Google's URL refuses to open.
 */

import { Linking, Platform } from 'react-native';

import {
  buildAppleMapsUrl,
  buildExternalMapsUrl,
  hasFiniteCoords,
  type MapsTarget,
} from './externalMapsUrl';

// Re-exported for callers that only need the pure URL builder / type.
export { buildExternalMapsUrl } from './externalMapsUrl';
export type { MapsTarget } from './externalMapsUrl';

/**
 * Open the place in the system maps app. On iOS, if the Google URL fails
 * to open (e.g. user has no browser handler that takes maps URLs), we
 * silently retry with Apple Maps. Returns true if anything opened.
 */
export async function openExternalMaps(place: MapsTarget): Promise<boolean> {
  const url = buildExternalMapsUrl(place);
  if (!url) {
    console.warn('[maps] no URL could be built for place', {
      name: place.name,
      hasCoords: hasFiniteCoords(place),
    });
    return false;
  }

  console.debug('[maps] opening external maps', url);

  try {
    await Linking.openURL(url);
    return true;
  } catch (err) {
    console.warn('[maps] openURL failed', (err as Error)?.message);
    if (Platform.OS === 'ios') {
      const apple = buildAppleMapsUrl(place);
      if (apple) {
        console.debug('[maps] falling back to Apple Maps', apple);
        try {
          await Linking.openURL(apple);
          return true;
        } catch (err2) {
          console.warn('[maps] apple maps openURL failed', (err2 as Error)?.message);
        }
      }
    }
    return false;
  }
}
