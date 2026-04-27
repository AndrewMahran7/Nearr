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

type MapsTarget = {
  google_maps_url?: string | null;
  google_place_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  name?: string | null;
  formatted_address?: string | null;
};

/** True if the stored URL is the legacy `?q=place_id:<id>` pattern that
 *  Google Maps doesn't actually resolve. */
function isBrokenPlaceIdUrl(url: string): boolean {
  // Matches both `q=place_id:` and an accidental bare `place_id:` query.
  return /[?&]q=place_id:|\/maps\/place\/\?q=place_id:/i.test(url);
}

function hasFiniteCoords(p: MapsTarget): p is MapsTarget & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof p.latitude === 'number' &&
    Number.isFinite(p.latitude) &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.longitude)
  );
}

/**
 * Build the best Google Maps URL we can for this place.
 *
 * Order of preference:
 *   A. `google_maps_url` if present and not the broken `place_id:` pattern.
 *   B. lat/lng (+ optional `query_place_id`) via the documented Maps URL.
 *   C. Encoded name/address text search.
 *   D. `null` — caller should bail.
 */
export function buildExternalMapsUrl(place: MapsTarget): string | null {
  if (place.google_maps_url && !isBrokenPlaceIdUrl(place.google_maps_url)) {
    return place.google_maps_url;
  }

  if (hasFiniteCoords(place)) {
    const params = new URLSearchParams({
      api: '1',
      query: `${place.latitude},${place.longitude}`,
    });
    if (place.google_place_id) {
      params.set('query_place_id', place.google_place_id);
    }
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  const text = (place.name ?? place.formatted_address ?? '').trim();
  if (text) {
    const params = new URLSearchParams({ api: '1', query: text });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return null;
}

/** iOS-only Apple Maps fallback. */
function buildAppleMapsUrl(place: MapsTarget): string | null {
  if (hasFiniteCoords(place)) {
    const params = new URLSearchParams({
      ll: `${place.latitude},${place.longitude}`,
    });
    const label = (place.name ?? '').trim();
    if (label) params.set('q', label);
    return `https://maps.apple.com/?${params.toString()}`;
  }
  const text = (place.name ?? place.formatted_address ?? '').trim();
  if (text) {
    return `https://maps.apple.com/?${new URLSearchParams({ q: text }).toString()}`;
  }
  return null;
}

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
