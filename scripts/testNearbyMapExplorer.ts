/**
 * Production regression and synthetic-scale gate for the in-map Nearby Map
 * Explorer. This stays native-free: data, clustering, camera, and source
 * ownership contracts are exercised without mounting Google Maps or photos.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  buildNearbyMapExplorerItems,
  explorerItemToMarkerPlace,
  explorerItemsForInitialFit,
  explorerSelectionRegion,
  sameNearbyExplorerPlace,
  saveNearbyExplorerItemTransition,
  shouldRecenterExplorerSelection,
  type NearbyMapExplorerItem,
  type NearbyMapExplorerPayload,
} from '../lib/nearbyMapExplorer';
import {
  buildMapClusterIndex,
  clusterMemberPlaces,
  clusterWithoutSelectedMember,
  queryMapClusters,
  regionToClusterZoom,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { MapClusterExpansionCoordinator } from '../lib/mapClusterExpansion';
import { assertMarkerConservation } from '../lib/mapReliability';
import {
  MAP_FILTER_ALL,
  filterPlacesForMap,
  mapFilterGroupForPlace,
} from '../lib/mapVisibility';
import { buildExternalMapsUrl } from '../lib/externalMapsUrl';
import type { PlaceRecommendation } from '../lib/placeRecommendations';
import type { SavedPlaceWithPlace } from '../types';

const ROOT = process.cwd();
const MAP_SOURCE = readFileSync(join(ROOT, 'app/(tabs)/map.tsx'), 'utf8');
const SELECTED_SOURCE = readFileSync(
  join(ROOT, 'components/map/SelectedPlaceDetails.tsx'),
  'utf8',
);
const RECOMMENDED_SOURCE = readFileSync(
  join(ROOT, 'components/map/RecommendedPlaceDetails.tsx'),
  'utf8',
);
const CAROUSEL_SOURCE = readFileSync(
  join(ROOT, 'components/map/NearbyMapExplorerCarousel.tsx'),
  'utf8',
);

function saved(
  id: string,
  providerId: string | null,
  name: string,
  latitude: number,
  longitude: number,
  category = 'restaurant',
  address = `${id} Main Street`,
): SavedPlaceWithPlace {
  return {
    id,
    user_id: 'user-1',
    place_id: `place-${id}`,
    category,
    archived_at: null,
    visited_at: null,
    notifications_enabled: false,
    place: {
      id: `place-${id}`,
      google_place_id: providerId,
      name,
      formatted_address: address,
      latitude,
      longitude,
      category,
      google_maps_url: providerId ? `https://maps.google.com/?cid=${providerId}` : null,
    },
  } as unknown as SavedPlaceWithPlace;
}

function recommendation(
  index: number,
  overrides: Partial<PlaceRecommendation> = {},
): PlaceRecommendation {
  const ring = index % 40;
  const radius = 0.002 + Math.floor(index / 40) * 0.00025;
  const angle = (ring / 40) * Math.PI * 2;
  return {
    googlePlaceId: `provider-rec-${index}`,
    name: `Nearby recommendation ${index}`,
    formattedAddress: `${1000 + index} Explorer Avenue`,
    latitude: 33.75 + Math.cos(angle) * radius,
    longitude: -117.85 + Math.sin(angle) * radius,
    category: index % 2 === 0 ? 'restaurant' : 'park',
    nearrCategory: index % 2 === 0 ? 'restaurant' : 'park',
    googleMapsUrl: null,
    rawTypes: index % 2 === 0 ? ['restaurant'] : ['park'],
    primaryType: index % 2 === 0 ? 'restaurant' : 'park',
    primaryTypeDisplayName: index % 2 === 0 ? 'Restaurant' : 'Park',
    googleMapsTypeLabel: index % 2 === 0 ? 'Restaurant' : 'Park',
    shortFormattedAddress: `Explorer ${index}`,
    businessStatus: 'OPERATIONAL',
    rating: 4.5,
    userRatingsTotal: 100 + index,
    photoUrl: `https://images.test/${index}/thumb.jpg`,
    photoUrls: Array.from({ length: 7 }, (_, photo) =>
      `https://images.test/${index}/${photo + 1}.jpg`,
    ),
    distanceMeters: 100 + index,
    relevanceTier: 1,
    score: 1000 - index,
    ...overrides,
  } as PlaceRecommendation;
}

function payload(count: number): NearbyMapExplorerPayload {
  return {
    anchor: saved('anchor', 'provider-anchor', 'Starting place', 33.75, -117.85),
    savedNearby: [
      {
        saved: saved('saved-nearby', 'provider-saved', 'Already saved', 33.751, -117.851, 'cafe'),
        distanceMeters: 145,
      },
    ],
    alsoNearby: Array.from({ length: count }, (_, index) => recommendation(index)),
  };
}

const REGION = {
  latitude: 33.75,
  longitude: -117.85,
  latitudeDelta: 1,
  longitudeDelta: 1,
};

function projectAndAssert(
  items: readonly NearbyMapExplorerItem[],
  selectedId: string | null,
  region = REGION,
) {
  const places = items.map(explorerItemToMarkerPlace);
  const index = buildMapClusterIndex(places);
  const zoom = Math.round(regionToClusterZoom({
    longitudeDelta: region.longitudeDelta,
    viewportWidth: 390,
  }));
  const nodes = queryMapClusters(index, { region, zoom, viewportWidth: 390 });
  const clusters: MapClusterMarker[] = [];
  const individuals = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'place') {
      individuals.add(node.id);
      continue;
    }
    const projection = clusterWithoutSelectedMember(node, selectedId, zoom);
    if (projection.cluster) clusters.push(projection.cluster);
    if (projection.looseMemberId) individuals.add(projection.looseMemberId);
  }
  if (selectedId && places.some((place) => place.id === selectedId)) individuals.add(selectedId);
  const report = assertMarkerConservation({
    eligiblePlaces: places,
    individualIds: [...individuals],
    clusters,
    region,
  });
  return { index, nodes, clusters, individuals, report };
}

// 1-4: CTA, in-memory opening, origin context, and current recommendation ownership.
assert.match(SELECTED_SOURCE, /actionLabel=\{onSeeMap[^\n]*\? 'See map'/);
assert.match(SELECTED_SOURCE, /onSeeMap\?\.\(\{[\s\S]*anchor: saved,[\s\S]*alsoNearby: recommendations/);
assert.match(MAP_SOURCE, /const openNearbyExplorer = useCallback/);
assert.match(MAP_SOURCE, /setNearbyExplorer\(\{[\s\S]*anchorSavedPlaceId: payload\.anchor\.id/);
assert.match(MAP_SOURCE, /<RecommendedPlaceDetails[\s\S]*recommendation=\{selectedExplorerRecommendation\}/);
assert.match(MAP_SOURCE, /setSelected\(anchor\)[\s\S]*setPreviewExpanded\(true\)/);

const opened = buildNearbyMapExplorerItems(payload(8));
assert.equal(opened[0]?.sourceType, 'anchor');
assert.equal(opened[0]?.savedPlaceId, 'anchor');
assert.equal(opened.length, 10, 'anchor + saved-nearby + current recommendations appear');
assert.equal(opened.filter((item) => item.savedState === 'unsaved').length, 8);
assert.ok(opened.every((item) => item.photoUrls.length <= 5), 'gallery metadata is bounded');

// Strict production semantic identity: provider id is authoritative; the
// providerless fallback requires exact normalized name/address and <= 40m.
const duplicateProvider = buildNearbyMapExplorerItems({
  anchor: saved('same', 'provider-same', 'Cafe One', 33.75, -117.85),
  savedNearby: [],
  alsoNearby: [recommendation(1, { googlePlaceId: 'provider-same', name: 'Renamed provider result' })],
});
assert.equal(duplicateProvider.length, 1);
assert.equal(duplicateProvider[0]?.savedState, 'saved');

const providerlessA = buildNearbyMapExplorerItems({
  anchor: saved('providerless', null, 'Exact Cafe', 33.75, -117.85, 'cafe', '10 Main St'),
  savedNearby: [],
  alsoNearby: [recommendation(2, {
    googlePlaceId: '',
    name: ' exact cafe ',
    formattedAddress: '10 Main St',
    latitude: 33.7501,
    longitude: -117.85,
  })],
});
assert.equal(providerlessA.length, 1, 'strict providerless fallback merges a true duplicate');
assert.equal(
  sameNearbyExplorerPlace(
    opened[0]!,
    {
      ...opened[0]!,
      id: 'other',
      placeId: 'other-place',
      savedPlaceId: 'other-saved',
      providerPlaceId: null,
    },
  ),
  false,
  'a provider-backed row never falls through to fuzzy identity',
);
const nonDuplicate = buildNearbyMapExplorerItems({
  anchor: saved('near-a', null, 'Cafe', 33.75, -117.85, 'cafe', '10 Main St'),
  savedNearby: [],
  alsoNearby: [recommendation(3, {
    googlePlaceId: '',
    name: 'Cafe Annex',
    formattedAddress: '12 Main St',
    latitude: 33.75001,
    longitude: -117.85001,
  })],
});
assert.equal(nonDuplicate.length, 2, 'nearby/substrings never merge semantic entities');

// 5-11: opening/selecting/dismissing is read-only; Directions targets the
// canonical provider without a save; explicit Save transitions one item and
// conserves every unrelated id even when a duplicate race is present.
const target = opened.find((item) => item.savedState === 'unsaved')!;
assert.equal(target.savedPlaceId, null);
const beforeReadOnly = JSON.stringify(opened);
const directionsUrl = buildExternalMapsUrl({
  google_maps_url: target.googleMapsUrl,
  google_place_id: target.providerPlaceId,
  latitude: target.latitude,
  longitude: target.longitude,
  name: target.name,
  formatted_address: target.address,
});
assert.ok(directionsUrl?.includes(`query_place_id=${target.providerPlaceId}`));
assert.equal(JSON.stringify(opened), beforeReadOnly, 'Directions and detail selection do not save');
assert.match(RECOMMENDED_SOURCE, /void openExternalMaps\(\{/);
assert.match(RECOMMENDED_SOURCE, /title="Save place"/);

const canonicalSaved = saved(
  'new-saved-id',
  target.providerPlaceId,
  target.name,
  target.latitude,
  target.longitude,
  target.category,
  target.address ?? undefined,
);
const racedDuplicate = {
  ...target,
  id: 'race-duplicate',
  savedPlaceId: 'existing-saved-id',
  placeId: 'existing-place-id',
  savedState: 'saved' as const,
};
const beforeIds = new Set(opened.map((item) => item.id).filter((id) => id !== target.id));
const savedTransition = saveNearbyExplorerItemTransition(
  [...opened, racedDuplicate],
  target.id,
  canonicalSaved,
);
const transitioned = savedTransition.items.find((item) => item.id === target.id)!;
assert.equal(transitioned.savedState, 'saved');
assert.equal(transitioned.savedPlaceId, 'new-saved-id');
assert.equal(savedTransition.selectedId, target.id);
assert.equal(
  savedTransition.items.filter((item) => item.providerPlaceId === target.providerPlaceId).length,
  1,
  'save/duplicate race leaves one canonical map entity',
);
for (const id of beforeIds) {
  assert.ok(savedTransition.items.some((item) => item.id === id), `unrelated ${id} is conserved`);
}
projectAndAssert(opened, target.id);
projectAndAssert(savedTransition.items, target.id);

// 12: current production filters are applied to the same explorer projection;
// returning to All restores the complete semantic dataset.
const projectedPlaces = savedTransition.items.map(explorerItemToMarkerPlace);
const filter = mapFilterGroupForPlace(projectedPlaces.find((place) => place.id === target.id)!);
const filtered = filterPlacesForMap(projectedPlaces, filter, target.id);
assert.ok(filtered.some((place) => place.id === target.id));
assert.ok(filtered.length <= projectedPlaces.length);
assert.equal(filterPlacesForMap(projectedPlaces, MAP_FILTER_ALL).length, projectedPlaces.length);
projectAndAssert(
  savedTransition.items.filter((item) => filtered.some((place) => place.id === item.id)),
  target.id,
);

// 13: every real cluster has members and the bounded current coordinator can
// always advance primary -> bounds -> deterministic member fallback.
const clustered = projectAndAssert(buildNearbyMapExplorerItems(payload(100)), null);
const firstCluster = clustered.nodes.find(
  (node): node is MapClusterMarker => node.kind === 'cluster',
);
assert.ok(firstCluster, 'synthetic nearby data produces a tappable cluster');
assert.ok(clusterMemberPlaces(clustered.index, firstCluster!.clusterId).length > 0);
const coordinator = new MapClusterExpansionCoordinator();
const members = clusterMemberPlaces(clustered.index, firstCluster!.clusterId).map((place) => ({
  id: place.id,
  latitude: place.place.latitude,
  longitude: place.place.longitude,
}));
const request = {
  token: 1,
  datasetKey: firstCluster!.datasetKey,
  clusterId: firstCluster!.clusterId,
  clusterKey: firstCluster!.clusterKey,
  memberIds: firstCluster!.memberIds,
  members,
  currentZoom: 9,
  targetZoom: 11,
  latitude: firstCluster!.latitude,
  longitude: firstCluster!.longitude,
  targetRegion: { latitude: firstCluster!.latitude, longitude: firstCluster!.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 },
  target: { kind: 'region' as const },
};
assert.equal(coordinator.tap(request, true).kind, 'camera');
assert.equal(coordinator.cameraCommandIssued(), true);
const terminal = coordinator.timeout();
assert.equal(terminal.kind, 'failed');
assert.equal(coordinator.timeout().kind, 'none');
assert.match(MAP_SOURCE, /resolveLatestClusterMarker/);
assert.doesNotMatch(MAP_SOURCE, /action\.kind === 'fallback_select'/);

// 14-17: back restores explorer, fitting is single-shot and respects manual
// movement, AppState does not own/clear the session, and no explorer route or
// root-stack hack was introduced.
assert.match(MAP_SOURCE, /if \(selectedExplorerRecommendation\)[\s\S]*setSelectedExplorerRecommendation\(null\)/);
assert.match(MAP_SOURCE, /else if \(explorerSavedDetailOpen\)[\s\S]*setExplorerSavedDetailOpen\(false\)/);
assert.match(MAP_SOURCE, /else \{[\s\S]*closeNearbyExplorer\(\)/);
assert.match(MAP_SOURCE, /fittedExplorerSessionRef\.current === nearbyExplorer\.sessionId/);
assert.match(MAP_SOURCE, /if \(!explorerUserMovedRef\.current\) fittedExplorerSessionRef\.current = null/);
assert.match(MAP_SOURCE, /if \(nearbyExplorerRef\.current\) explorerUserMovedRef\.current = true/);
assert.equal(shouldRecenterExplorerSelection(REGION, opened[0]!), false);
const focused = explorerSelectionRegion(REGION, target);
assert.equal(focused.latitudeDelta, REGION.latitudeDelta, 'a card focus preserves zoom');
assert.ok(explorerItemsForInitialFit([...opened, {
  ...target,
  id: 'extreme-outlier',
  providerPlaceId: 'extreme-outlier',
  latitude: 60,
  longitude: 20,
}]).every((item) => item.id !== 'extreme-outlier'));
const explorerOwnership = MAP_SOURCE.slice(
  MAP_SOURCE.indexOf('const closeNearbyExplorer'),
  MAP_SOURCE.indexOf('useEffect(() => {', MAP_SOURCE.indexOf('const closeNearbyExplorer') + 1),
);
assert.doesNotMatch(explorerOwnership, /router\.(push|replace)|dismissAll/);
assert.doesNotMatch(MAP_SOURCE, /dismissAll/);
assert.doesNotMatch(MAP_SOURCE, /AppState[\s\S]{0,500}setNearbyExplorer\(null\)/);

// Synthetic scale: the current index owns 10/50/100/500 recommendation sets,
// conservation survives selected projection and zoom, and native nodes remain
// spatially bounded at overview zoom. Carousel/photo mounting is also bounded.
const timings: string[] = [];
for (const count of [10, 50, 100, 500]) {
  const started = performance.now();
  const items = buildNearbyMapExplorerItems(payload(count));
  const wide = projectAndAssert(items, items[Math.min(items.length - 1, 2)]?.id ?? null);
  const tight = projectAndAssert(items, items[0]?.id ?? null, {
    latitude: 33.75,
    longitude: -117.85,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  assert.equal(items.length, count + 2);
  assert.ok(wide.nodes.length < items.length, `${count}: overview uses clusters, not one native marker per item`);
  assert.equal(wide.report.missingOnscreenIds.length, 0);
  assert.equal(tight.report.missingOnscreenIds.length, 0);
  timings.push(`${count}:${(performance.now() - started).toFixed(1)}ms`);
}
assert.match(CAROUSEL_SOURCE, /initialNumToRender=\{3\}/);
assert.match(CAROUSEL_SOURCE, /maxToRenderPerBatch=\{3\}/);
assert.match(CAROUSEL_SOURCE, /windowSize=\{5\}/);
assert.match(CAROUSEL_SOURCE, /removeClippedSubviews/);
assert.doesNotMatch(CAROUSEL_SOURCE, /photoUrls\.map|<FlatList[^>]*photoUrls/);

console.log(
  `PASS nearby map explorer: 17 required behaviors, strict identity, save/filter/zoom/background conservation, bounded 10/50/100/500 scale (${timings.join(', ')})`,
);
