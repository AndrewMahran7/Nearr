/**
 * Pure presentation rules for saved-place map markers.
 *
 * This module deliberately has no React Native imports. Category identity,
 * zoom/density simplification, selection, photo fallback and accessibility can
 * therefore be regression-tested without mounting a native map.
 */

import {
  CATEGORY_LABELS,
  savedPlaceCategory,
  type NearrCategory,
} from './placeCategory';
import type { SavedPlaceWithPlace } from '@/types';

export type MapMarkerDetailLevel = 'dense' | 'compact' | 'local';

export type MarkerCategoryPresentation = {
  family: string;
  glyph: string;
};

/**
 * A deliberately small visual vocabulary over Nearr's full persisted
 * taxonomy. Similar categories share a symbol; high-memory categories such as
 * beach, hike, stay and coffee keep distinct symbols.
 */
export const MARKER_CATEGORY_PRESENTATIONS = {
  restaurant: { family: 'food', glyph: 'silverware-fork-knife' },
  cafe: { family: 'coffee', glyph: 'coffee-outline' },
  bakery: { family: 'coffee', glyph: 'coffee-outline' },
  bar: { family: 'drinks', glyph: 'glass-cocktail' },
  brewery: { family: 'drinks', glyph: 'glass-mug-variant' },
  winery: { family: 'drinks', glyph: 'glass-wine' },
  dessert: { family: 'coffee', glyph: 'cupcake' },
  hotel: { family: 'stay', glyph: 'bed-outline' },
  resort: { family: 'stay', glyph: 'bed-outline' },
  hiking_trail: { family: 'trail', glyph: 'hiking' },
  park: { family: 'nature', glyph: 'pine-tree' },
  beach: { family: 'water', glyph: 'waves' },
  waterfall: { family: 'water', glyph: 'waterfall' },
  lake: { family: 'water', glyph: 'waves' },
  marina: { family: 'water', glyph: 'sail-boat' },
  island: { family: 'water', glyph: 'island' },
  scenic_spot: { family: 'nature', glyph: 'image-filter-hdr' },
  attraction: { family: 'culture', glyph: 'camera-outline' },
  museum: { family: 'culture', glyph: 'bank-outline' },
  entertainment: { family: 'entertainment', glyph: 'ticket-outline' },
  shopping: { family: 'shopping', glyph: 'shopping-outline' },
  nightlife: { family: 'entertainment', glyph: 'music-note-outline' },
  sports: { family: 'active', glyph: 'basketball' },
  fitness: { family: 'active', glyph: 'dumbbell' },
  wellness: { family: 'wellness', glyph: 'spa-outline' },
  transportation: { family: 'utility', glyph: 'train-car' },
  education: { family: 'utility', glyph: 'school-outline' },
  service: { family: 'utility', glyph: 'information-outline' },
  other: { family: 'other', glyph: 'map-marker-outline' },
} as const satisfies Readonly<Record<NearrCategory, MarkerCategoryPresentation>>;

export const MAP_MARKER_DENSE_COUNT = 80;
export const MAP_MARKER_COMPACT_COUNT = 30;
export const MAP_MARKER_DENSE_LATITUDE_DELTA = 0.75;
export const MAP_MARKER_COMPACT_LATITUDE_DELTA = 0.18;

/**
 * Complexity only changes after a completed camera movement. Counts take
 * precedence over zoom: a tight viewport with 100 overlapping saves is still
 * visually dense and must use the least expensive marker.
 */
export function mapMarkerDetailLevel(input: {
  latitudeDelta: number | null | undefined;
  visibleCount: number;
}): MapMarkerDetailLevel {
  const latitudeDelta = Number.isFinite(input.latitudeDelta)
    ? Math.max(0, input.latitudeDelta as number)
    : Number.POSITIVE_INFINITY;
  const visibleCount = Math.max(0, Math.floor(input.visibleCount));

  if (
    visibleCount >= MAP_MARKER_DENSE_COUNT ||
    latitudeDelta >= MAP_MARKER_DENSE_LATITUDE_DELTA
  ) {
    return 'dense';
  }
  if (
    visibleCount >= MAP_MARKER_COMPACT_COUNT ||
    latitudeDelta >= MAP_MARKER_COMPACT_LATITUDE_DELTA
  ) {
    return 'compact';
  }
  return 'local';
}

export type SavedMarkerPresentation = {
  category: NearrCategory;
  categoryLabel: string;
  family: string;
  glyph: string;
  detailLevel: MapMarkerDetailLevel;
  selected: boolean;
  visual: 'category' | 'photo';
  photoUri: string | null;
  showLabel: boolean;
  accessibilityLabel: string;
};

export function savedMarkerAccessibilityLabel(
  saved: SavedPlaceWithPlace,
  selected: boolean,
): string {
  const category = savedPlaceCategory(saved);
  const prefix = selected ? 'Selected saved' : 'Saved';
  return `${prefix} ${CATEGORY_LABELS[category].toLowerCase()}, ${saved.place.name}`;
}

export function savedMarkerPresentation(
  saved: SavedPlaceWithPlace,
  input: {
    detailLevel: MapMarkerDetailLevel;
    selected: boolean;
    photoUri?: string | null;
    photoFailed?: boolean;
  },
): SavedMarkerPresentation {
  const category = savedPlaceCategory(saved);
  const categoryPresentation = MARKER_CATEGORY_PRESENTATIONS[category];
  const photoUri = input.photoUri?.trim() || null;
  const usePhoto = input.selected && !!photoUri && !input.photoFailed;

  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    family: categoryPresentation.family,
    glyph: categoryPresentation.glyph,
    detailLevel: input.detailLevel,
    selected: input.selected,
    visual: usePhoto ? 'photo' : 'category',
    photoUri: usePhoto ? photoUri : null,
    showLabel: input.selected,
    accessibilityLabel: savedMarkerAccessibilityLabel(saved, input.selected),
  };
}
