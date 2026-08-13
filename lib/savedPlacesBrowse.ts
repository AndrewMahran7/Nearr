import { categoryMatchesFilter, savedPlaceCategory, type CategoryFilterGroup } from './placeCategory';
import type { SavedPlaceWithPlace } from '@/types';

export type SavedBrowseSort = 'recent' | 'nearby';

export type SavedBrowseFilters = {
  category: CategoryFilterGroup | null;
  hasVideo: boolean;
};

export function hasOriginalVideo(saved: SavedPlaceWithPlace): boolean {
  return (saved.source_type === 'instagram' || saved.source_type === 'tiktok') && !!saved.source_url?.trim();
}

export function filterSavedPlaces(
  places: readonly SavedPlaceWithPlace[],
  filters: SavedBrowseFilters,
): SavedPlaceWithPlace[] {
  return places.filter((place) => {
    if (filters.category && !categoryMatchesFilter(savedPlaceCategory(place), filters.category)) return false;
    if (filters.hasVideo && !hasOriginalVideo(place)) return false;
    return true;
  });
}

export function sortSavedPlaces(
  places: readonly SavedPlaceWithPlace[],
  sort: SavedBrowseSort,
): SavedPlaceWithPlace[] {
  return [...places].sort((left, right) => {
    if (sort === 'recent') {
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    }
    const leftDistance = Number((left as SavedPlaceWithPlace & { distanceMeters?: number }).distanceMeters);
    const rightDistance = Number((right as SavedPlaceWithPlace & { distanceMeters?: number }).distanceMeters);
    if (Number.isFinite(leftDistance) && Number.isFinite(rightDistance)) return leftDistance - rightDistance;
    if (Number.isFinite(leftDistance)) return -1;
    if (Number.isFinite(rightDistance)) return 1;
    return left.place.name.localeCompare(right.place.name);
  });
}

export function browseFilterCount(filters: SavedBrowseFilters): number {
  return Number(!!filters.category) + Number(filters.hasVideo);
}
