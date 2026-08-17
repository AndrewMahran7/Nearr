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

/**
 * How much further a place may be than the next-nearest one purely because it
 * adds a category the row does not have yet. ~2 miles.
 *
 * This is the whole distance safeguard, and it is deliberately an ABSOLUTE
 * budget rather than a ratio: a ratio would let a 35-mile cafe displace a
 * 0.3-mile restaurant just because the multiplier looked reasonable at small
 * numbers. Beyond this budget, distance wins — always.
 */
export const ALSO_NEARBY_DIVERSITY_DETOUR_METERS = 3_200;

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
  options?: {
    limit?: number;
    maxMeters?: number;
    /**
     * Saved-place ids already shown elsewhere on the page — today, the
     * "From this video" siblings. They are excluded rather than repeated: the
     * same card appearing twice under two headings makes both look wrong.
     */
    excludeIds?: Iterable<string>;
    /**
     * Category for a candidate, when the caller has one. Supplying it turns on
     * the diversity preference below; omitting it keeps pure distance order.
     */
    categoryOf?: (item: T) => string | null | undefined;
    /** Detour budget for a diverse pick. Defaults to ~2 miles. */
    diversityDetourMeters?: number;
  },
): AlsoNearbyEntry<T>[] {
  const origin = coords(anchor);
  if (!origin || !anchor?.id || !Array.isArray(all)) return [];

  const limit = Math.max(0, Math.floor(options?.limit ?? ALSO_NEARBY_LIMIT));
  const maxMeters = Math.max(0, options?.maxMeters ?? ALSO_NEARBY_MAX_METERS);
  if (limit === 0) return [];

  const seen = new Set<string>([anchor.id]);
  for (const id of options?.excludeIds ?? []) {
    if (typeof id === 'string' && id) seen.add(id);
  }
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

  const categoryOf = options?.categoryOf;
  if (!categoryOf) return entries.slice(0, limit);

  return diversifyByCategory(entries, {
    limit,
    categoryOf,
    anchorCategory: categoryOf(anchor as T) ?? null,
    detourMeters: Math.max(0, options?.diversityDetourMeters ?? ALSO_NEARBY_DIVERSITY_DETOUR_METERS),
  });
}

/**
 * Fill the visible slots preferring categories the row does not have yet, then
 * fall back to plain distance order.
 *
 * This is NOT a recommendation engine and deliberately encodes no
 * category-to-category affinity — no "beach implies burger". It only avoids
 * spending all three visible cards on the same category when an equally nearby
 * saved alternative would say something new.
 *
 * The anchor's own category counts as already seen, so opening a beach leads
 * with what is around it rather than with three more beaches. Every pick is
 * still bounded by `detourMeters`: the moment diversity would cost real
 * distance, the nearest place wins. Deterministic — same input, same row.
 */
function diversifyByCategory<T extends NearbyCandidate>(
  ranked: readonly AlsoNearbyEntry<T>[],
  args: {
    limit: number;
    categoryOf: (item: T) => string | null | undefined;
    anchorCategory: string | null;
    detourMeters: number;
  },
): AlsoNearbyEntry<T>[] {
  const remaining = [...ranked];
  const picked: AlsoNearbyEntry<T>[] = [];
  const seenCategories = new Set<string>();
  if (args.anchorCategory) seenCategories.add(args.anchorCategory);

  while (picked.length < args.limit && remaining.length > 0) {
    const nearest = remaining[0];
    // The nearest candidate that adds a new category AND stays inside the
    // detour budget. When the nearest already adds one, this finds the nearest
    // itself, so the result is identical to distance order.
    const index = remaining.findIndex((entry) => {
      const category = args.categoryOf(entry.saved);
      if (!category || seenCategories.has(category)) return false;
      return entry.distanceMeters <= nearest.distanceMeters + args.detourMeters;
    });
    const chosenIndex = index === -1 ? 0 : index;
    const [chosen] = remaining.splice(chosenIndex, 1);
    const category = args.categoryOf(chosen.saved);
    if (category) seenCategories.add(category);
    picked.push(chosen);
  }

  return picked;
}

/**
 * Distance between two saved places, or null when either lacks usable
 * coordinates. Used by "From this video", where distance is a nice-to-have
 * detail rather than the ranking — a sibling with no coordinates is still a
 * sibling, it just shows no distance instead of a fabricated one.
 */
export function savedPlaceDistanceMeters(
  from: NearbyCandidate | null | undefined,
  to: NearbyCandidate | null | undefined,
): number | null {
  const origin = coords(from);
  const point = coords(to);
  if (!origin || !point) return null;
  const meters = distanceMeters(origin, point);
  return Number.isFinite(meters) ? meters : null;
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
