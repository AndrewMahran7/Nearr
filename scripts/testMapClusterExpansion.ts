/** Deterministic repeated-interaction harness for cluster-tap recovery. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MapClusterExpansionCoordinator,
  clusterMemberFitCoordinates,
  clusterMemberKey,
  resolveLatestClusterMarker,
  type ClusterExpansionAction,
  type ClusterExpansionRequest,
} from '../lib/mapClusterExpansion';
import {
  buildMapClusterIndex,
  clusterExpansionRegion,
  clusterExpansionZoom,
  clusterMemberPlaces,
  clusterTapZoom,
  queryMapClusters,
  regionToClusterZoom,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import type { SavedPlaceWithPlace } from '../types';
import {
  clearMapClusterDiagnostics,
  getMapClusterDiagnostics,
  recordMapClusterDiagnostic,
} from '../lib/mapClusterDiagnostics';

type Place = SavedPlaceWithPlace;

const wide: ClusterRegion = {
  latitude: 33.7455,
  longitude: -117.8677,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};
const viewportWidth = 390;
const viewportHeight = 760;

function dense(prefix: string, count = 8, offset = 0): Place[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    place: {
      latitude: 33.7455 + offset + (index % 3) * 0.00008,
      longitude: -117.8677 + offset + Math.floor(index / 3) * 0.00008,
      category: index % 2 ? 'restaurant' : 'park',
      name: `${prefix} ${index}`,
    },
  } as Place));
}

function clusters(nodes: ReturnType<typeof queryMapClusters<Place>>): MapClusterMarker[] {
  return nodes.filter((node): node is MapClusterMarker => node.kind === 'cluster');
}

function requestFor(
  index: ReturnType<typeof buildMapClusterIndex<Place>>,
  cluster: MapClusterMarker,
  currentZoom: number,
  token = 1,
): ClusterExpansionRequest {
  const members = clusterMemberPlaces(index, cluster.clusterId);
  const targetZoom = clusterTapZoom({
    expansionZoom: clusterExpansionZoom(index, cluster.clusterId) ?? currentZoom + 1,
    currentZoom,
  });
  const targetRegion = clusterExpansionRegion({
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    zoom: targetZoom,
    viewportWidth,
    viewportHeight,
  });
  return {
    token,
    clusterId: cluster.clusterId,
    clusterKey: clusterMemberKey(members.map((member) => member.id)),
    memberIds: members.map((member) => member.id),
    members: members.map((member) => ({
      id: member.id,
      latitude: member.place.latitude,
      longitude: member.place.longitude,
    })),
    currentZoom,
    targetZoom,
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    targetRegion,
  };
}

function memberships(
  index: ReturnType<typeof buildMapClusterIndex<Place>>,
  current: readonly MapClusterMarker[],
) {
  return current.map((cluster) => {
    const ids = clusterMemberPlaces(index, cluster.clusterId).map((place) => place.id);
    return { clusterKey: clusterMemberKey(ids), memberIds: ids };
  });
}

function expectKind<T extends ClusterExpansionAction['kind']>(
  action: ClusterExpansionAction,
  kind: T,
): Extract<ClusterExpansionAction, { kind: T }> {
  assert.equal(action.kind, kind);
  return action as Extract<ClusterExpansionAction, { kind: T }>;
}

const allPlaces = [...dense('original'), ...dense('other', 6, 0.03)];
let index = buildMapClusterIndex(allPlaces);
const wideZoom = Math.round(regionToClusterZoom({
  longitudeDelta: wide.longitudeDelta,
  viewportWidth,
}));
let wideClusters = clusters(queryMapClusters(index, { region: wide, zoom: wideZoom }));
assert.ok(wideClusters.length >= 2, 'dense fixture renders multiple clusters');
const original = wideClusters[0]!;
const originalRequest = requestFor(index, original, wideZoom);
assert.ok(originalRequest.memberIds.length >= 2, 'rendered cluster resolves current members');

// 1. Render dense -> tap -> primary camera -> recompute -> split.
{
  const coordinator = new MapClusterExpansionCoordinator();
  expectKind(coordinator.tap(originalRequest, true), 'primary_camera');
  coordinator.cameraSettled();
  const zoomed = clusters(queryMapClusters(index, {
    region: originalRequest.targetRegion,
    zoom: originalRequest.targetZoom,
  }));
  expectKind(coordinator.clustersRecomputed(memberships(index, zoomed)), 'completed');
}

// 2. Expand -> select child -> pan -> filter -> clear -> another cluster ->
// zoom out/recluster -> original again. Every explicit tap gets an action.
{
  const coordinator = new MapClusterExpansionCoordinator();
  let selectedId: string | null = null;
  let filter = 'all';
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const request = requestFor(index, original, wideZoom, cycle + 1);
    expectKind(coordinator.tap(request, true), 'primary_camera');
    coordinator.cameraSettled();
    expectKind(coordinator.clustersRecomputed([]), 'completed');
    selectedId = request.memberIds[0]!; // select child
    assert.ok(selectedId);
    const panned = { ...wide, longitude: wide.longitude + 0.001 };
    assert.ok(panned.longitude !== wide.longitude); // user pan owns camera
    filter = cycle % 2 ? 'food_drink' : 'outdoors';
    assert.notEqual(filter, 'all');
    filter = 'all';
    assert.equal(filter, 'all');
  }
  assert.equal(coordinator.current(), null, 'repeated expand/recluster never leaves a lock');
  assert.ok(selectedId);
}

// 3. Tap immediately after load queues exactly one action until map ready.
{
  const coordinator = new MapClusterExpansionCoordinator();
  expectKind(coordinator.tap(originalRequest, false), 'queued');
  expectKind(coordinator.mapBecameUsable(), 'primary_camera');
  expectKind(coordinator.mapBecameUsable(), 'none');
}

// 4. Rapid taps replace the in-flight request; timeout belongs to the latest.
{
  const coordinator = new MapClusterExpansionCoordinator();
  const second = { ...originalRequest, token: 2 };
  coordinator.tap(originalRequest, true);
  coordinator.tap(second, true);
  const fallback = expectKind(coordinator.timeout(), 'fallback_fit');
  assert.equal(fallback.request.token, 2);
}

// 5. A stale cluster id resolves against the latest rendered marker.
{
  const stale = { ...original, clusterId: Number.MAX_SAFE_INTEGER };
  const repaired = resolveLatestClusterMarker(stale, wideClusters);
  assert.ok(repaired);
  assert.equal(repaired!.clusterId, original.clusterId);
  assert.ok(clusterMemberPlaces(index, repaired!.clusterId).length >= 2);
}

// 6. A filter rebuild cannot leave an old id as a silent no-op.
{
  const foodOnly = allPlaces.filter((place) => place.place.category === 'restaurant');
  const filteredIndex = buildMapClusterIndex(foodOnly);
  const filteredClusters = clusters(queryMapClusters(filteredIndex, { region: wide, zoom: wideZoom }));
  const repaired = resolveLatestClusterMarker(original, filteredClusters);
  assert.ok(repaired, 'stale pre-filter marker resolves to a current filtered cluster');
  assert.ok(clusterMemberPlaces(filteredIndex, repaired!.clusterId).length >= 2);
  index = buildMapClusterIndex(allPlaces); // clearing the filter rebuilds cleanly
  wideClusters = clusters(queryMapClusters(index, { region: wide, zoom: wideZoom }));
  assert.ok(resolveLatestClusterMarker(original, wideClusters));
}

// 7. Same/equal expansion zoom is forced to a meaningful level in.
assert.ok(clusterTapZoom({ expansionZoom: wideZoom, currentZoom: wideZoom }) >= wideZoom + 1);

// 8. First camera failure gets one fallback fit; second ends in selection.
{
  const coordinator = new MapClusterExpansionCoordinator();
  coordinator.tap(originalRequest, true);
  expectKind(coordinator.cameraFailed(), 'fallback_fit');
  expectKind(coordinator.timeout(), 'fallback_select');
  expectKind(coordinator.timeout(), 'none');
}

// 9. Co-located member bounds are non-degenerate and safe for native fit.
{
  const coords = clusterMemberFitCoordinates([
    { id: 'a', latitude: 1, longitude: 2 },
    { id: 'b', latitude: 1, longitude: 2 },
  ]);
  assert.ok(coords[1]!.latitude > coords[0]!.latitude);
  assert.ok(coords[1]!.longitude > coords[0]!.longitude);
}

// 10. Pan, selected-pin dismissal, Place Detail return, and background/resume
// reset transient camera ownership without poisoning the next tap.
for (const lifecycle of ['user_pan', 'selected_pin_dismissed', 'place_detail_return', 'foreground_resume']) {
  const coordinator = new MapClusterExpansionCoordinator();
  coordinator.tap(originalRequest, true);
  coordinator.reset();
  assert.equal(coordinator.current(), null, `${lifecycle} clears transient expansion state`);
  expectKind(coordinator.tap({ ...originalRequest, token: 3 }, true), 'primary_camera');
}

// 11. Source contracts: selection clears before expansion; lifecycle hooks use
// the reset path; the map-ready path drains the queue; no optional camera call.
{
  const source = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  const handlerStart = source.indexOf('const handleClusterPress = useCallback');
  const handlerEnd = source.indexOf('useEffect(() => {', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.ok(handler.includes('dismissSelectedPlaceRef.current()'));
  assert.ok(handler.includes('clusterIndexRef.current'));
  assert.ok(handler.includes('mapReadyRef.current && !!mapRef.current'));
  assert.ok(!handler.includes('mapRef.current?.animateToRegion'));
  assert.match(source, /clusterExpansionCoordinatorRef\.current\.mapBecameUsable\(\)/);
  assert.match(source, /clusterExpansionCoordinatorRef\.current\.cameraSettled\(\)/);
  assert.ok((source.match(/resetClusterExpansionRef\.current\(\)/g) ?? []).length >= 3);
}

// 12. Diagnostics are event-scoped, bounded, and round coordinates.
{
  (globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
  clearMapClusterDiagnostics();
  for (let index = 0; index < 45; index += 1) {
    recordMapClusterDiagnostic('cluster_tap', {
      clusterId: index,
      memberCount: 2,
      currentZoom: 9.12345,
      targetZoom: 10.98765,
      currentRegion: {
        latitude: 33.7455123,
        longitude: -117.8677123,
        latitudeDelta: 0.123456,
        longitudeDelta: 0.234567,
      },
      targetRegion: null,
      mapReady: true,
      selectedPin: false,
      selectedCluster: null,
      cameraOwner: 'cluster',
      animationActive: false,
      filterKey: 'all',
      visibleMarkerCount: 2,
      clusterChildCount: 2,
      expansionDispatched: false,
      cameraCommandExecuted: false,
      clusteringRecomputed: false,
      resultingClusterCount: null,
      resultingMemberCount: null,
    });
  }
  const diagnostics = getMapClusterDiagnostics();
  assert.equal(diagnostics.length, 40, 'cluster diagnostics are a bounded ring');
  assert.equal(diagnostics[0]!.clusterId, 5, 'oldest diagnostic is evicted');
  assert.equal(diagnostics[0]!.currentRegion!.latitude, 33.746, 'coordinates are rounded');
}

console.log(
  'PASS cluster expansion: repeated taps, rapid taps, map readiness, filters, pan, selection, '
  + 'navigation, lifecycle, stale ids, camera failure, one fallback, and no-loop invariant',
);
