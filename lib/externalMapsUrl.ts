/**
 * lib/externalMapsUrl.ts
 *
 * PURE Google/Apple Maps URL builders, extracted from lib/externalMaps.ts so
 * they can be reused (e.g. by lib/placeShare.ts) and unit-tested from ts-node
 * WITHOUT pulling in the `react-native` `Linking`/`Platform` imports that the
 * opener (lib/externalMaps.ts) needs.
 *
 * No side effects, no RN imports.
 */

export type MapsTarget = {
  google_maps_url?: string | null;
  google_place_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  name?: string | null;
  formatted_address?: string | null;
};

/** True if the stored URL is the legacy `?q=place_id:<id>` pattern that
 *  Google Maps doesn't actually resolve. */
export function isBrokenPlaceIdUrl(url: string): boolean {
  // Matches both `q=place_id:` and an accidental bare `place_id:` query.
  return /[?&]q=place_id:|\/maps\/place\/\?q=place_id:/i.test(url);
}

export function hasFiniteCoords(p: MapsTarget): p is MapsTarget & {
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
export function buildAppleMapsUrl(place: MapsTarget): string | null {
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
