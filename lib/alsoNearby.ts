/**
 * lib/alsoNearby.ts
 *
 * "Also nearby" = the user's OWN other saved places closest to the one they
 * are looking at. Never Google discovery, never sponsored businesses, never an
 * unsaved POI — the whole point is "what else have *I* saved around here?".
 *
 * PURE — no React Native, no I/O, no provider calls. Unit-tested from ts-node.
 */

// Relative (not '@/lib/geo') so the ts-node unit tests can load this module
// without the Metro path alias.
import { distanceMeters } from './geo';

/** Minimal shape needed to rank a saved place by distance. */
type NearbyCandidate = {
  id: string;
  place?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export type AlsoNearbyEntry<T> = {
  saved: T;
  /** Great-circle distance from the anchor, in meters. */
  distanceMeters: number;
};

/** Nothing further away than this is "also nearby" in any useful sense. */
export const ALSO_NEARBY_MAX_METERS = 80_000; // ~50 miles
/** Bounded so the row never turns into an unscrollable wall of cards. */
export const ALSO_NEARBY_LIMIT = 6;

function coords(candidate: NearbyCandidate | null | undefined) {
  const lat = candidate?.place?.latitude;
  const lng = candidate?.place?.longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * The user's other saved places nearest `anchor`, closest first.
 *
 * Excludes the anchor itself by exact `saved_places.id` (never by name and
 * never by coordinate), drops rows without usable coordinates rather than
 * guessing at a location, and caps both the radius and the count. Returns an
 * empty array when there is nothing genuinely nearby — the caller omits the
 * section entirely rather than rendering an empty shell.
 */
export function selectAlsoNearby<T extends NearbyCandidate>(
  anchor: T | null | undefined,
  all: readonly T[] | null | undefined,
  options?: { limit?: number; maxMeters?: number },
): AlsoNearbyEntry<T>[] {
  const origin = coords(anchor);
  if (!origin || !anchor?.id || !Array.isArray(all)) return [];

  const limit = Math.max(0, Math.floor(options?.limit ?? ALSO_NEARBY_LIMIT));
  const maxMeters = Math.max(0, options?.maxMeters ?? ALSO_NEARBY_MAX_METERS);
  if (limit === 0) return [];

  const seen = new Set<string>([anchor.id]);
  const entries: AlsoNearbyEntry<T>[] = [];

  for (const candidate of all) {
    if (!candidate?.id || seen.has(candidate.id)) continue;
    const point = coords(candidate);
    if (!point) continue; // no usable location — never invent one
    seen.add(candidate.id);
    const meters = distanceMeters(origin, point);
    if (!Number.isFinite(meters) || meters > maxMeters) continue;
    entries.push({ saved: candidate, distanceMeters: meters });
  }

  entries.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return entries.slice(0, limit);
}

/** Compact distance copy for a card: "0.4 mi", "1.2 mi", "320 ft". */
export function formatNearbyDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  const miles = meters / 1609.344;
  if (miles < 0.1) {
    const feet = Math.round(meters * 3.28084);
    return `${Math.max(1, feet)} ft`;
  }
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
