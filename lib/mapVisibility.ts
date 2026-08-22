/**
 * lib/mapVisibility.ts
 *
 * PURE rules for what the map shows. Two concerns, both presentation-only:
 *
 *   1. Category visibility — which saved places render as markers.
 *   2. Zone circles — when a place's reminder radius is drawn.
 *
 * NOTHING here mutates a saved place, touches reminder/geofence semantics, or
 * changes stored categories. Filtering is a view over the array the map
 * already holds, so changing a filter costs one pass and never re-queries.
 *
 * Grouping reuses CATEGORY_BROWSE_SECTIONS — the SAME presentation grouping
 * the Saved Places library sheet already uses — so the map and the list speak
 * one vocabulary and there is no second taxonomy to keep in sync.
 */

import {
  CATEGORY_BROWSE_SECTIONS,
  savedPlaceCategory,
  type NearrCategory,
} from './placeCategory';
import type { SavedPlaceWithPlace } from '@/types';

/** `all`, or one of the browse-section ids. */
export type MapVisibilityFilter = string;

export const MAP_FILTER_ALL: MapVisibilityFilter = 'all';

export type MapFilterOption = {
  id: MapVisibilityFilter;
  label: string;
  /** How many currently-mappable places this option would show. */
  count: number;
};

type CategorySource = Parameters<typeof savedPlaceCategory>[0];

function sectionForCategory(category: NearrCategory): string {
  for (const section of CATEGORY_BROWSE_SECTIONS) {
    if ((section.categories as readonly string[]).includes(category)) return section.id;
  }
  // CATEGORY_BROWSE_SECTIONS covers every NearrCategory; `other` is the
  // documented home for anything unmapped, so an unknown value is not a crash.
  return 'other';
}

/** Which filter group a saved place belongs to. Never throws. */
export function mapFilterGroupForPlace(saved: CategorySource): string {
  try {
    return sectionForCategory(savedPlaceCategory(saved));
  } catch {
    return 'other';
  }
}

export function mapFilterLabel(filter: MapVisibilityFilter): string {
  if (filter === MAP_FILTER_ALL) return 'All places';
  return CATEGORY_BROWSE_SECTIONS.find((s) => s.id === filter)?.label ?? 'All places';
}

export function isMapFilterActive(filter: MapVisibilityFilter): boolean {
  return filter !== MAP_FILTER_ALL && CATEGORY_BROWSE_SECTIONS.some((s) => s.id === filter);
}

/**
 * The filter chips to offer, in browse-section order, with counts.
 *
 * Only groups the user actually has places in are returned, so a 5-save map
 * shows two or three chips and a 200-save map still shows at most eight. `All`
 * is always first. An empty collection yields no chips at all — the map has
 * nothing to filter.
 */
export function mapFilterOptions(
  places: readonly SavedPlaceWithPlace[] | null | undefined,
  includeEmptyFilterIds: readonly string[] = [],
): MapFilterOption[] {
  if (!Array.isArray(places)) return [];
  const required = new Set(includeEmptyFilterIds);
  if (places.length === 0 && required.size === 0) return [];

  const counts = new Map<string, number>();
  for (const saved of places) {
    if (!saved) continue;
    const group = mapFilterGroupForPlace(saved);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const options: MapFilterOption[] = [
    { id: MAP_FILTER_ALL, label: mapFilterLabel(MAP_FILTER_ALL), count: places.length },
  ];
  for (const section of CATEGORY_BROWSE_SECTIONS) {
    const count = counts.get(section.id) ?? 0;
    if (count === 0 && !required.has(section.id)) continue;
    options.push({ id: section.id, label: section.label, count });
  }
  // A single group means filtering can only ever be a no-op — don't offer it.
  // Phase 2 may keep selected production groups visible at zero so Practice
  // users learn the real map controls; normal map behavior is unchanged.
  return options.length > 2 || required.size > 0 ? options : [];
}

/**
 * The places the map should render.
 *
 * `alwaysVisibleId` is the currently selected / deep-linked place: it stays on
 * the map even when it does not match the active filter, so focusing a place
 * can never leave the user staring at a selection they cannot see.
 */
export function filterPlacesForMap(
  places: readonly SavedPlaceWithPlace[] | null | undefined,
  filter: MapVisibilityFilter,
  alwaysVisibleId?: string | null,
): SavedPlaceWithPlace[] {
  if (!Array.isArray(places)) return [];
  if (!isMapFilterActive(filter)) return [...places];
  return places.filter(
    (saved) =>
      (alwaysVisibleId != null && saved?.id === alwaysVisibleId) ||
      mapFilterGroupForPlace(saved) === filter,
  );
}

/** Consumer-facing empty state for a filter that matches nothing. */
export function mapFilterEmptyMessage(filter: MapVisibilityFilter): string {
  if (!isMapFilterActive(filter)) return 'No saved places yet';
  return `Nothing saved under ${mapFilterLabel(filter).toLowerCase()} yet`;
}

// ---------------------------------------------------------------------------
// Zone circles
// ---------------------------------------------------------------------------

/**
 * Above this many visible places, drawing every reminder radius turns the map
 * into overlapping orange wash. Small collections keep the zone-bubble look
 * that gives Nearr its identity; large ones stay readable.
 */
export const ZONE_CIRCLE_DENSITY_LIMIT = 12;

/**
 * Whether to draw a place's reminder radius.
 *
 * Purely visual — reminder radius, geofences and notification behavior are
 * untouched. The selected place ALWAYS shows its zone (that is the emphasis
 * that makes a selection legible), and while something is selected the other
 * zones stand down so the focused one reads clearly.
 */
export function shouldRenderZoneCircle(args: {
  isSelected: boolean;
  hasSelection: boolean;
  isArchived: boolean;
  visibleCount: number;
}): boolean {
  if (args.isArchived) return false;
  if (args.isSelected) return true;
  if (args.hasSelection) return false;
  return args.visibleCount <= ZONE_CIRCLE_DENSITY_LIMIT;
}
