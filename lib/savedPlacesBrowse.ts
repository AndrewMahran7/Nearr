import { CATEGORY_LABELS, savedPlaceCategory, type NearrCategory } from './placeCategory';
import { getSavedPlaceShareTarget } from './placeShare';
import { splitPlaceAddress } from './sharePhase1Ui';
import type { SavedPlaceWithPlace } from '@/types';

export type SavedBrowseSort = 'recent' | 'nearby';

export const SAVED_CATEGORY_FILTERS = [
  { id: 'restaurants', label: 'Restaurants', categories: ['restaurant'] },
  { id: 'cafes', label: 'Cafes', categories: ['cafe'] },
  { id: 'bakeries', label: 'Bakeries', categories: ['bakery'] },
  { id: 'bars_nightlife', label: 'Bars & Nightlife', categories: ['bar', 'nightlife'] },
  { id: 'hotels', label: 'Hotels', categories: ['hotel'] },
  { id: 'outdoors', label: 'Outdoors', categories: ['park', 'hiking_trail', 'beach', 'scenic_spot'] },
  { id: 'attractions', label: 'Attractions', categories: ['attraction', 'museum'] },
  { id: 'shopping', label: 'Shopping', categories: ['shopping'] },
  { id: 'fitness_wellness', label: 'Fitness & Wellness', categories: ['fitness', 'wellness'] },
  { id: 'entertainment', label: 'Entertainment', categories: ['entertainment'] },
  { id: 'other', label: 'Other', categories: ['transportation', 'education', 'service', 'other'] },
] as const satisfies readonly {
  id: string;
  label: string;
  categories: readonly NearrCategory[];
}[];

export type SavedCategoryFilter = (typeof SAVED_CATEGORY_FILTERS)[number]['id'];

export type SavedBrowseFilters = {
  categories: readonly SavedCategoryFilter[];
  hasVideo: boolean;
};

export type SavedBrowsePlace = SavedPlaceWithPlace & { distanceMeters?: number };

export function currentSavedPlaces(
  places: readonly SavedPlaceWithPlace[],
): SavedPlaceWithPlace[] {
  const seen = new Set<string>();
  return places.filter((saved) => {
    if (saved.archived_at || seen.has(saved.id)) return false;
    seen.add(saved.id);
    return true;
  });
}

function filterDefinition(id: SavedCategoryFilter) {
  return SAVED_CATEGORY_FILTERS.find((item) => item.id === id);
}

export function hasOriginalVideo(saved: SavedPlaceWithPlace): boolean {
  return getSavedPlaceShareTarget(saved).kind === 'original_post';
}

export function filterSavedPlaces(
  places: readonly SavedPlaceWithPlace[],
  filters: SavedBrowseFilters,
): SavedPlaceWithPlace[] {
  const selectedCategories = new Set<NearrCategory>(
    filters.categories.flatMap((id) => [...(filterDefinition(id)?.categories ?? [])]),
  );
  return places.filter((place) => {
    if (selectedCategories.size > 0 && !selectedCategories.has(savedPlaceCategory(place))) return false;
    if (filters.hasVideo && !hasOriginalVideo(place)) return false;
    return true;
  });
}

function normalizedSearchValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

export function searchSavedPlaces(
  places: readonly SavedPlaceWithPlace[],
  query: string,
): SavedPlaceWithPlace[] {
  const needle = normalizedSearchValue(query);
  if (!needle) return [...places];
  return places.filter((saved) => {
    const locality = splitPlaceAddress(saved.place.formatted_address).locality;
    const category = CATEGORY_LABELS[savedPlaceCategory(saved)];
    return [saved.place.name, locality, category, saved.notes]
      .some((value) => normalizedSearchValue(value).includes(needle));
  });
}

function timestamp(value: string | null | undefined): number {
  const parsed = new Date(value ?? '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortSavedPlaces(
  places: readonly SavedBrowsePlace[],
  sort: SavedBrowseSort,
): SavedBrowsePlace[] {
  return [...places].sort((left, right) => {
    if (sort === 'recent') {
      return timestamp(right.created_at) - timestamp(left.created_at) || left.id.localeCompare(right.id);
    }
    const leftDistance = Number(left.distanceMeters);
    const rightDistance = Number(right.distanceMeters);
    if (Number.isFinite(leftDistance) && Number.isFinite(rightDistance)) {
      return leftDistance - rightDistance || timestamp(right.created_at) - timestamp(left.created_at);
    }
    if (Number.isFinite(leftDistance)) return -1;
    if (Number.isFinite(rightDistance)) return 1;
    return timestamp(right.created_at) - timestamp(left.created_at);
  });
}

export function browseFilterCount(filters: SavedBrowseFilters): number {
  return filters.categories.length + Number(filters.hasVideo);
}

export function savedPlaceNotePreview(saved: SavedPlaceWithPlace): {
  text: string;
  kind: 'user' | 'post';
} | null {
  const userNote = saved.notes?.trim().replace(/\s+/g, ' ');
  if (userNote) return { text: userNote, kind: 'user' };
  const postNote = saved.ai_note?.trim().replace(/\s+/g, ' ');
  return postNote ? { text: postNote, kind: 'post' } : null;
}

export function formatBrowseDistance(distanceMeters: number | null | undefined): string | null {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  const miles = distanceMeters / 1609.344;
  if (miles < 0.1) return '<0.1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function buildSavedPlacesBrowseResults(args: {
  places: readonly SavedPlaceWithPlace[];
  nearbyPlaces?: readonly SavedBrowsePlace[];
  nearbyReady?: boolean;
  query: string;
  filters: SavedBrowseFilters;
  sort: SavedBrowseSort;
}): SavedBrowsePlace[] {
  const current = currentSavedPlaces(args.places);
  const distanceById = new Map(
    (args.nearbyPlaces ?? []).map((saved) => [saved.id, saved.distanceMeters]),
  );
  const withDistances: SavedBrowsePlace[] = current.map((saved) => {
    const distanceMeters = distanceById.get(saved.id);
    return typeof distanceMeters === 'number' ? { ...saved, distanceMeters } : saved;
  });
  const filtered = filterSavedPlaces(withDistances, args.filters);
  const searched = searchSavedPlaces(filtered, args.query) as SavedBrowsePlace[];
  const effectiveSort = args.sort === 'nearby' && args.nearbyReady ? 'nearby' : 'recent';
  return sortSavedPlaces(searched, effectiveSort);
}
