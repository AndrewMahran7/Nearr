/** Frozen reproduction of the production event ordering observed before this hotfix. */

import assert from 'node:assert/strict';

import {
  buildMapClusterIndex,
  queryMapClusters,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { nextMapViewportSnapshot } from '../lib/mapViewportSync';
import type { SavedPlaceWithPlace } from '../types';

const continental: ClusterRegion = {
  latitude: 37,
  longitude: -99,
  latitudeDelta: 35,
  longitudeDelta: 65,
};
const southernCalifornia: ClusterRegion = {
  latitude: 34,
  longitude: -117.8,
  latitudeDelta: 4,
  longitudeDelta: 6,
};

function saved(id: string, latitude: number, longitude: number): SavedPlaceWithPlace {
  return { id, place: { id, name: id, latitude, longitude, category: 'restaurant' } } as SavedPlaceWithPlace;
}

const places: SavedPlaceWithPlace[] = [];
for (let index = 0; index < 40; index += 1) {
  places.push(saved(
    `socal-${index}`,
    33.4 + (index % 8) * 0.18,
    -118.8 + Math.floor(index / 8) * 0.25,
  ));
}
for (const [id, latitude, longitude] of [
  ['seattle', 47.61, -122.33],
  ['new-york', 40.71, -74],
  ['miami', 25.76, -80.19],
  ['chicago', 41.88, -87.63],
  ['mexico-city', 19.43, -99.13],
  ['vancouver', 49.28, -123.12],
  ['denver', 39.74, -104.99],
  ['dallas', 32.78, -96.8],
] as const) places.push(saved(id, latitude, longitude));

const index = buildMapClusterIndex(places);
function representation(region: ClusterRegion, zoom: number) {
  const nodes = queryMapClusters(index, { region, zoom, viewportWidth: 390 });
  const individuals = nodes.filter((node) => node.kind === 'place');
  const clusters = nodes.filter((node): node is MapClusterMarker => node.kind === 'cluster');
  const ids = nodes.flatMap((node) => node.kind === 'place' ? [node.id] : [...node.memberIds]);
  return {
    individualMarkerCount: individuals.length,
    clusterCount: clusters.length,
    representedIds: [...new Set(ids)].sort(),
    duplicateIds: ids.filter((id, position) => ids.indexOf(id) !== position),
  };
}

let snapshot = nextMapViewportSnapshot({
  previous: null,
  region: continental,
  cameraRevision: 1,
  source: 'native_readback',
  width: 390,
  height: 760,
  updatedAt: 1,
});
snapshot = nextMapViewportSnapshot({
  previous: snapshot,
  region: southernCalifornia,
  cameraRevision: 2,
  source: 'region_change_complete',
  width: 390,
  height: 760,
  updatedAt: 2,
});
const settledContinental = nextMapViewportSnapshot({
  previous: snapshot,
  region: continental,
  cameraRevision: 3,
  source: 'native_readback',
  width: 390,
  height: 760,
  updatedAt: 3,
});

// Production accepted this delayed continuous sample under the same camera
// revision after the native continental readback. That is the first bad event.
const incorrectlyAcceptedLateRegional = nextMapViewportSnapshot({
  previous: settledContinental,
  region: southernCalifornia,
  cameraRevision: 3,
  source: 'region_change',
  width: 390,
  height: 760,
  updatedAt: 4,
});

const before = representation(settledContinental.region, settledContinental.zoom);
const after = representation(incorrectlyAcceptedLateRegional.region, incorrectlyAcceptedLateRegional.zoom);
const missing = before.representedIds.filter((id) => !after.representedIds.includes(id));

const trace = {
  timestamp: 4,
  interactionId: 'founder-continental-socal-return-1',
  cameraTransactionId: 3,
  eventSource: 'late_region_change',
  nativeCenter: { latitude: continental.latitude, longitude: continental.longitude },
  nativeBounds: settledContinental.bbox,
  nativeZoom: settledContinental.zoom,
  jsCenter: { latitude: southernCalifornia.latitude, longitude: southernCalifornia.longitude },
  jsBounds: incorrectlyAcceptedLateRegional.bbox,
  jsZoom: incorrectlyAcceptedLateRegional.zoom,
  viewportRevision: incorrectlyAcceptedLateRegional.viewportRevision,
  cameraRevision: incorrectlyAcceptedLateRegional.cameraRevision,
  datasetRevision: 1,
  clusterIndexRevision: index.datasetKey,
  eligiblePointCount: index.pointCount,
  clusterQueryBbox: incorrectlyAcceptedLateRegional.bbox,
  clusterQueryZoom: incorrectlyAcceptedLateRegional.zoom,
  individualMarkerCount: after.individualMarkerCount,
  clusterCount: after.clusterCount,
  uniqueRepresentedPlaceIds: after.representedIds,
  missingIds: missing,
  duplicateIds: after.duplicateIds,
  previousRepresentationCount: before.representedIds.length,
  collapsedRepresentationCount: after.representedIds.length,
  clusterTapProductionChain: ['primary_camera', 'fallback_fit', 'fallback_select'],
  cameraCommandsFromOneTap: 2,
  automaticChildSelectionsFromOneTap: 1,
};

assert.equal(before.representedIds.length, 48);
assert.equal(after.representedIds.length, 40);
assert.equal(missing.length, 8);
assert.equal(after.duplicateIds.length, 0);
console.log(JSON.stringify(trace, null, 2));
console.log('PRE-FIX FIRST BROKEN TRANSITION REPRODUCED: viewport 3 native continental -> viewport 4 late SoCal JS commit');
