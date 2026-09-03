import assert from 'node:assert/strict';

import {
  buildMapClusterIndex,
  queryMapClusters,
  regionToClusterBbox,
  regionToClusterZoom,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { isCoordinateInsideRegion } from '../lib/mapReliability';
import type { SavedPlaceWithPlace } from '../types';

const VIEWPORT_WIDTH = 390;

function saved(id: string, latitude: number, longitude: number): SavedPlaceWithPlace {
  return {
    id,
    category: 'restaurant',
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: id,
      formatted_address: `${id} fixture`,
      latitude,
      longitude,
      category: 'restaurant',
      google_maps_url: null,
      created_at: '2026-08-25T00:00:00.000Z',
    },
  } as SavedPlaceWithPlace;
}

// Three saves in the previously settled San Diego viewport and seventeen more
// across the continental US. This reproduces the founder-visible `3` without
// inventing bad cluster membership or dropping data before the index build.
const canonical = [
  saved('san-diego-1', 32.7157, -117.1611),
  saved('san-diego-2', 32.7180, -117.1580),
  saved('san-diego-3', 32.7120, -117.1650),
  saved('los-angeles', 34.0522, -118.2437),
  saved('san-francisco', 37.7749, -122.4194),
  saved('portland', 45.5152, -122.6784),
  saved('seattle', 47.6062, -122.3321),
  saved('las-vegas', 36.1699, -115.1398),
  saved('phoenix', 33.4484, -112.0740),
  saved('salt-lake-city', 40.7608, -111.8910),
  saved('denver', 39.7392, -104.9903),
  saved('dallas', 32.7767, -96.7970),
  saved('houston', 29.7604, -95.3698),
  saved('minneapolis', 44.9778, -93.2650),
  saved('chicago', 41.8781, -87.6298),
  saved('nashville', 36.1627, -86.7816),
  saved('atlanta', 33.7490, -84.3880),
  saved('miami', 25.7617, -80.1918),
  saved('washington-dc', 38.9072, -77.0369),
  saved('new-york', 40.7128, -74.0060),
];

const previouslySettledCity: ClusterRegion = {
  latitude: 32.7157,
  longitude: -117.1611,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};
const actualContinentalCamera: ClusterRegion = {
  latitude: 36.75,
  longitude: -98.5,
  latitudeDelta: 24,
  longitudeDelta: 62,
};

const index = buildMapClusterIndex(canonical);
assert.equal(index.pointCount, canonical.length, 'all canonical places enter Supercluster');

const staleZoom = Math.round(regionToClusterZoom({
  longitudeDelta: previouslySettledCity.longitudeDelta,
  viewportWidth: VIEWPORT_WIDTH,
}));
const actualZoom = Math.round(regionToClusterZoom({
  longitudeDelta: actualContinentalCamera.longitudeDelta,
  viewportWidth: VIEWPORT_WIDTH,
}));

// Frozen production ownership: the map has moved, but a missing/interrupted
// onRegionChangeComplete leaves both settledRegion and clusterZoom unchanged.
const staleNodes = queryMapClusters(index, {
  region: previouslySettledCity,
  zoom: staleZoom,
  viewportWidth: VIEWPORT_WIDTH,
});
const representedIds = staleNodes.flatMap((node) =>
  node.kind === 'place' ? [node.id] : [...node.memberIds]);
const representedSet = new Set(representedIds);
const viewportEligibleIds = canonical
  .filter((place) => isCoordinateInsideRegion(place.place, actualContinentalCamera))
  .map((place) => place.id)
  .sort();
const missingIds = viewportEligibleIds.filter((id) => !representedSet.has(id));
const occurrenceCounts = new Map<string, number>();
for (const id of representedIds) occurrenceCounts.set(id, (occurrenceCounts.get(id) ?? 0) + 1);
const duplicateIds = [...occurrenceCounts]
  .filter(([, count]) => count > 1)
  .map(([id]) => id)
  .sort();
const clusters = staleNodes.filter((node): node is MapClusterMarker => node.kind === 'cluster');
const individuals = staleNodes.filter((node) => node.kind === 'place');

const synchronizedNodes = queryMapClusters(index, {
  region: actualContinentalCamera,
  zoom: actualZoom,
  viewportWidth: VIEWPORT_WIDTH,
});
const synchronizedIds = new Set(synchronizedNodes.flatMap((node) =>
  node.kind === 'place' ? [node.id] : [...node.memberIds]));

const ledger = {
  canonical_saved_count: canonical.length,
  eligible_after_filters: canonical.length,
  supercluster_input_count: index.pointCount,
  actual_viewport_bounds: regionToClusterBbox(actualContinentalCamera, 0),
  actual_zoom: actualZoom,
  queried_viewport_bounds: regionToClusterBbox(previouslySettledCity, 0),
  queried_zoom: staleZoom,
  camera_completion_received: false,
  supercluster_output_features: staleNodes.length,
  individual_count: individuals.length,
  cluster_count: clusters.length,
  unique_cluster_member_count: new Set(clusters.flatMap((cluster) => [...cluster.memberIds])).size,
  accounted_for_count: representedSet.size,
  missing_ids: missingIds,
  duplicate_ids: duplicateIds,
  synchronized_query_accounted_for_count: synchronizedIds.size,
  synchronized_query_missing_ids: viewportEligibleIds.filter((id) => !synchronizedIds.has(id)),
};

assert.equal(clusters.length, 1, 'stale city query renders the single reported cluster');
assert.equal(clusters[0]?.count, 3, 'the visible stale cluster truthfully contains three members');
assert.equal(missingIds.length, 17, 'seventeen continental places are absent from the stale query');
assert.equal(duplicateIds.length, 0);
assert.equal(synchronizedIds.size, canonical.length, 'the same index conserves all places with current camera inputs');

console.log(JSON.stringify(ledger, null, 2));
console.log('PRE-FIX CONTINENTAL SINGLE-CLUSTER-3 REPRODUCED: YES');
