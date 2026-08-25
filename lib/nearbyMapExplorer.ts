/**
 * Pure data and camera decisions for the Nearby Map Explorer.
 *
 * The explorer projects data already owned by Place Detail. It performs no
 * provider calls, does not save anything, and feeds the existing production
 * filter -> Supercluster -> viewport -> marker path through a lightweight
 * SavedPlaceWithPlace adapter.
 */

import { distanceMeters } from './geo';
import { isSameCanonicalPlace } from './placeCanonicalization';
import { savedPlaceCategory, type NearrCategory } from './placeCategory';
import type { PlaceRecommendation } from './placeRecommendations';
import type { PlaceCandidate } from '../services/placesService';
import type { SavedPlaceWithPlace } from '../types';

export type NearbyMapExplorerSourceType = 'anchor' | 'saved_nearby' | 'also_nearby';
export type NearbyMapExplorerSavedState = 'saved' | 'unsaved';

export type NearbyMapExplorerItem = {
  /** Stable marker/card identity for the life of an explorer session. */
  id: string;
  placeId: string | null;
  savedPlaceId: string | null;
  providerPlaceId: string | null;
  name: string;
  category: NearrCategory;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  address: string | null;
  /** One bounded thumbnail for the card/selected pin. */
  photoUrl: string | null;
  /** URL metadata only; images are mounted by the current detail on demand. */
  photoUrls: string[];
  savedState: NearbyMapExplorerSavedState;
  sourceType: NearbyMapExplorerSourceType;
  googleMapsUrl: string | null;
  rawTypes: string[];
  primaryType: string | null;
  primaryTypeDisplayName: string | null;
  googleMapsTypeLabel: string | null;
  shortFormattedAddress: string | null;
  businessStatus: string | null;
  recommendationRank: number | null;
};

export type NearbyMapExplorerSavedInput = {
  saved: SavedPlaceWithPlace;
  distanceMeters: number;
};

export type NearbyMapExplorerPayload = {
  anchor: SavedPlaceWithPlace;
  savedNearby: readonly NearbyMapExplorerSavedInput[];
  alsoNearby: readonly PlaceRecommendation[];
  /** Lets the map join the current in-flight cached request if necessary. */
  recommendationsPending?: boolean;
};

export type ExplorerRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function clean(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next || null;
}

function stableId(input: {
  providerPlaceId?: string | null;
  placeId?: string | null;
  savedPlaceId?: string | null;
  name: string;
  latitude: number;
  longitude: number;
}): string {
  const provider = clean(input.providerPlaceId);
  if (provider) return `explorer:provider:${provider}`;
  const place = clean(input.placeId);
  if (place) return `explorer:place:${place}`;
  const saved = clean(input.savedPlaceId);
  if (saved) return `explorer:saved:${saved}`;
  const name = input.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `explorer:fallback:${name}:${input.latitude.toFixed(5)}:${input.longitude.toFixed(5)}`;
}

function fromSaved(
  saved: SavedPlaceWithPlace,
  sourceType: 'anchor' | 'saved_nearby',
  distance: number | null,
): NearbyMapExplorerItem {
  const providerPlaceId = clean(saved.place.google_place_id);
  return {
    id: stableId({
      providerPlaceId,
      placeId: saved.place.id,
      savedPlaceId: saved.id,
      name: saved.place.name,
      latitude: saved.place.latitude,
      longitude: saved.place.longitude,
    }),
    placeId: clean(saved.place.id),
    savedPlaceId: clean(saved.id),
    providerPlaceId,
    name: saved.place.name,
    category: savedPlaceCategory(saved),
    latitude: saved.place.latitude,
    longitude: saved.place.longitude,
    distanceMeters: distance,
    address: clean(saved.place.formatted_address),
    photoUrl: null,
    photoUrls: [],
    savedState: 'saved',
    sourceType,
    googleMapsUrl: clean(saved.place.google_maps_url),
    rawTypes: saved.place.google_types ?? [],
    primaryType: clean(saved.place.google_primary_type),
    primaryTypeDisplayName: clean(saved.place.google_type_label),
    googleMapsTypeLabel: clean(saved.place.google_type_label),
    shortFormattedAddress: clean(saved.place.short_formatted_address),
    businessStatus: clean(saved.place.business_status),
    recommendationRank: null,
  };
}

function fromRecommendation(
  recommendation: PlaceRecommendation,
  rank: number,
): NearbyMapExplorerItem {
  const providerPlaceId = clean(recommendation.googlePlaceId);
  return {
    id: stableId({
      providerPlaceId,
      name: recommendation.name,
      latitude: recommendation.latitude,
      longitude: recommendation.longitude,
    }),
    placeId: null,
    savedPlaceId: null,
    providerPlaceId,
    name: recommendation.name,
    category: recommendation.nearrCategory,
    latitude: recommendation.latitude,
    longitude: recommendation.longitude,
    distanceMeters: recommendation.distanceMeters,
    address: clean(recommendation.formattedAddress),
    photoUrl: clean(recommendation.photoUrl),
    photoUrls: (recommendation.photoUrls ?? []).filter((url): url is string => !!url?.trim()).slice(0, 5),
    savedState: 'unsaved',
    sourceType: 'also_nearby',
    googleMapsUrl: clean(recommendation.googleMapsUrl),
    rawTypes: recommendation.rawTypes ?? [],
    primaryType: clean(recommendation.primaryType),
    primaryTypeDisplayName: clean(recommendation.primaryTypeDisplayName),
    googleMapsTypeLabel: clean(recommendation.googleMapsTypeLabel),
    shortFormattedAddress: clean(recommendation.shortFormattedAddress),
    businessStatus: clean(recommendation.businessStatus),
    recommendationRank: rank,
  };
}

function canonicalCandidate(item: NearbyMapExplorerItem) {
  return {
    googlePlaceId: item.providerPlaceId,
    name: item.name,
    formattedAddress: item.address,
    latitude: item.latitude,
    longitude: item.longitude,
  };
}

function canonicalExisting(item: NearbyMapExplorerItem) {
  return {
    google_place_id: item.providerPlaceId,
    name: item.name,
    formatted_address: item.address,
    latitude: item.latitude,
    longitude: item.longitude,
  };
}

export function sameNearbyExplorerPlace(
  left: NearbyMapExplorerItem,
  right: NearbyMapExplorerItem,
): boolean {
  if (left.savedPlaceId && left.savedPlaceId === right.savedPlaceId) return true;
  if (left.placeId && left.placeId === right.placeId) return true;
  return isSameCanonicalPlace(canonicalCandidate(left), canonicalExisting(right));
}

function mergeDuplicate(
  first: NearbyMapExplorerItem,
  duplicate: NearbyMapExplorerItem,
): NearbyMapExplorerItem {
  return {
    ...first,
    placeId: first.placeId ?? duplicate.placeId,
    savedPlaceId: first.savedPlaceId ?? duplicate.savedPlaceId,
    providerPlaceId: first.providerPlaceId ?? duplicate.providerPlaceId,
    photoUrl: first.photoUrl ?? duplicate.photoUrl,
    photoUrls: first.photoUrls.length > 0 ? first.photoUrls : duplicate.photoUrls,
    address: first.address ?? duplicate.address,
    googleMapsUrl: first.googleMapsUrl ?? duplicate.googleMapsUrl,
    savedState:
      first.savedState === 'saved' || duplicate.savedState === 'saved' ? 'saved' : 'unsaved',
  };
}

/**
 * Semantic dedupe uses the production canonical rule: exact provider id, or
 * (only with no provider identity) exact normalized name + exact normalized
 * address + coordinates within 40 m. Proximity or substring names never merge.
 */
export function dedupeNearbyMapExplorerItems(
  input: readonly NearbyMapExplorerItem[],
): NearbyMapExplorerItem[] {
  const output: NearbyMapExplorerItem[] = [];
  for (const item of input) {
    if (
      !item.name.trim() ||
      !Number.isFinite(item.latitude) ||
      !Number.isFinite(item.longitude) ||
      Math.abs(item.latitude) > 90 ||
      Math.abs(item.longitude) > 180
    ) continue;
    const duplicateIndex = output.findIndex((current) => sameNearbyExplorerPlace(current, item));
    if (duplicateIndex >= 0) {
      output[duplicateIndex] = mergeDuplicate(output[duplicateIndex]!, item);
    } else {
      output.push(item);
    }
  }
  return output;
}

/** Anchor first, then current saved-nearby order, then current recommendation rank. */
export function buildNearbyMapExplorerItems(
  payload: NearbyMapExplorerPayload,
): NearbyMapExplorerItem[] {
  return dedupeNearbyMapExplorerItems([
    fromSaved(payload.anchor, 'anchor', 0),
    ...payload.savedNearby.map((entry) => fromSaved(entry.saved, 'saved_nearby', entry.distanceMeters)),
    ...payload.alsoNearby.map((entry, index) => fromRecommendation(entry, index + 1)),
  ]);
}

export function explorerItemToCandidate(item: NearbyMapExplorerItem): PlaceCandidate {
  return {
    googlePlaceId: item.providerPlaceId ?? '',
    name: item.name,
    formattedAddress: item.address,
    latitude: item.latitude,
    longitude: item.longitude,
    category: item.category,
    googleMapsUrl: item.googleMapsUrl,
    rawTypes: item.rawTypes,
    primaryType: item.primaryType,
    primaryTypeDisplayName: item.primaryTypeDisplayName,
    googleMapsTypeLabel: item.googleMapsTypeLabel,
    shortFormattedAddress: item.shortFormattedAddress,
    businessStatus: item.businessStatus,
  };
}

export function explorerItemToRecommendation(item: NearbyMapExplorerItem): PlaceRecommendation {
  return {
    ...explorerItemToCandidate(item),
    googlePlaceId: item.providerPlaceId ?? '',
    rating: null,
    userRatingsTotal: null,
    photoUrls: item.photoUrls,
    photoUrl: item.photoUrl,
    nearrCategory: item.category,
    distanceMeters: item.distanceMeters ?? 0,
    relevanceTier: 1,
    score: 0,
  };
}

/** Marker adapter only; saved detail always reopens the live canonical row. */
export function explorerItemToMarkerPlace(item: NearbyMapExplorerItem): SavedPlaceWithPlace {
  const now = '1970-01-01T00:00:00.000Z';
  return {
    id: item.id,
    user_id: '',
    place_id: item.placeId ?? item.id,
    radius_value: null,
    radius_unit: null,
    notes: null,
    ai_note: null,
    source_type: 'manual',
    source_url: null,
    notifications_enabled: false,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    category: item.category,
    created_at: now,
    updated_at: now,
    place: {
      id: item.placeId ?? item.id,
      google_place_id: item.providerPlaceId,
      name: item.name,
      formatted_address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
      category: item.category,
      short_formatted_address: item.shortFormattedAddress,
      google_primary_type: item.primaryType,
      google_types: item.rawTypes,
      google_type_label: item.googleMapsTypeLabel,
      containing_places: null,
      business_status: item.businessStatus,
      google_maps_url: item.googleMapsUrl,
      created_at: now,
    },
  };
}

export type NearbyExplorerSaveTransition = {
  items: NearbyMapExplorerItem[];
  selectedId: string;
};

/**
 * Convert one recommendation to its canonical saved representation without
 * changing its marker/card id. If a race reveals an existing representation,
 * that duplicate is removed and selection remains on the just-saved card.
 */
export function saveNearbyExplorerItemTransition(
  items: readonly NearbyMapExplorerItem[],
  itemId: string,
  saved: SavedPlaceWithPlace,
): NearbyExplorerSaveTransition {
  const current = items.find((item) => item.id === itemId);
  if (!current) return { items: [...items], selectedId: itemId };
  const savedProjection = fromSaved(saved, 'saved_nearby', current.distanceMeters);
  const updated: NearbyMapExplorerItem = {
    ...current,
    ...savedProjection,
    id: current.id,
    sourceType: current.sourceType,
    photoUrl: current.photoUrl,
    photoUrls: current.photoUrls,
  };
  return {
    items: items
      .filter((item) => item.id === itemId || !sameNearbyExplorerPlace(item, updated))
      .map((item) => (item.id === itemId ? updated : item)),
    selectedId: itemId,
  };
}

/** Initial fit keeps one extreme saved outlier from forcing a regional view. */
export function explorerItemsForInitialFit(
  items: readonly NearbyMapExplorerItem[],
): NearbyMapExplorerItem[] {
  if (items.length <= 2) return [...items];
  const anchor = items.find((item) => item.sourceType === 'anchor') ?? items[0]!;
  const measured = items
    .filter((item) => item.id !== anchor.id)
    .map((item) => ({ item, distance: distanceMeters(anchor, item) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance);
  if (measured.length === 0) return [anchor];
  const median = measured[Math.floor((measured.length - 1) / 2)]!.distance;
  const cutoff = Math.max(30_000, median * 4);
  const useful = measured.filter((entry) => entry.distance <= cutoff);
  if (useful.length === 0) useful.push(measured[0]!);
  return [anchor, ...useful.map((entry) => entry.item)];
}

export function explorerSinglePlaceRegion(item: NearbyMapExplorerItem): ExplorerRegion {
  return {
    latitude: item.latitude,
    longitude: item.longitude,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
  };
}

export function nearbyExplorerEdgePadding(input: {
  topInset: number;
  carouselHeight: number;
  bottomInset: number;
}) {
  return {
    top: Math.max(120, Math.round(input.topInset + 108)),
    right: 48,
    bottom: Math.max(210, Math.round(input.carouselHeight + input.bottomInset + 28)),
    left: 48,
  };
}

export function nearbyExplorerCardWidth(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  return Math.min(320, Math.max(272, width - 56));
}

export function nearbyExplorerCardSideInset(viewportWidth: number): number {
  return Math.max(24, (viewportWidth - nearbyExplorerCardWidth(viewportWidth)) / 2);
}

/** Recenter only when a card-selected target is outside the comfortable center. */
export function shouldRecenterExplorerSelection(
  region: ExplorerRegion | null | undefined,
  item: NearbyMapExplorerItem,
): boolean {
  if (!region) return true;
  return (
    Math.abs(item.latitude - region.latitude) > region.latitudeDelta * 0.36 ||
    Math.abs(item.longitude - region.longitude) > region.longitudeDelta * 0.36
  );
}

export function explorerSelectionRegion(
  region: ExplorerRegion | null | undefined,
  item: NearbyMapExplorerItem,
): ExplorerRegion {
  const fallback = explorerSinglePlaceRegion(item);
  return {
    latitude: item.latitude,
    longitude: item.longitude,
    latitudeDelta: Math.max(0.01, region?.latitudeDelta ?? fallback.latitudeDelta),
    longitudeDelta: Math.max(0.01, region?.longitudeDelta ?? fallback.longitudeDelta),
  };
}
