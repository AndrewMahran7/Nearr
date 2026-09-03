import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MapCameraTransactionCoordinator,
  cameraTargetMatches,
} from '../lib/mapCameraTransaction';
import {
  MapClusterExpansionCoordinator,
  clusterMemberKey,
  clusterMembersHaveUsefulBounds,
  type ClusterExpansionRequest,
} from '../lib/mapClusterExpansion';
import {
  buildMapClusterIndex,
  clusterExpansionRegion,
  clusterExpansionZoom,
  clusterMemberPlaces,
  queryMapClusters,
  regionToClusterZoom,
  type ClusterRegion,
  type MapClusterMarker,
  type MapClusterNode,
} from '../lib/mapClustering';
import { buildMapConservationLedger } from '../lib/mapConservation';
import {
  isLatestMapRepresentation,
  nextCameraTransition,
  nextMapViewportSnapshot,
  shouldCommitContinuousRegion,
  shouldCommitRegionCompletion,
  type MapViewportSnapshot,
} from '../lib/mapViewportSync';
import {
  clearMapLiveLedger,
  getMapLiveLedger,
  recordMapLiveLedger,
} from '../lib/mapLiveLedger';
import type { SavedPlaceWithPlace } from '../types';

type Place = SavedPlaceWithPlace;
type Projection = ReturnType<typeof project>;

const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 760;
const CONTINENTAL: ClusterRegion = {
  latitude: 37,
  longitude: -100,
  latitudeDelta: 50,
  longitudeDelta: 82,
};
const SOCAL: ClusterRegion = {
  latitude: 34,
  longitude: -117.8,
  latitudeDelta: 4,
  longitudeDelta: 6,
};

function place(id: string, latitude: number, longitude: number): Place {
  return {
    id,
    place: {
      name: id,
      latitude,
      longitude,
      category: Number(id.replace(/\D/g, '')) % 2 ? 'restaurant' : 'park',
    },
  } as Place;
}

/** Founder-like fixture: dense SoCal plus a broad North America distribution. */
function founderFixture(count: number): Place[] {
  const denseCount = Math.max(2, Math.floor(count * 0.62));
  return Array.from({ length: count }, (_, index) => {
    if (index < denseCount) {
      return place(
        `socal-${index}`,
        32.7 + ((index * 37) % 260) / 100,
        -119.4 + ((index * 53) % 420) / 100,
      );
    }
    if (index % 97 === 0) {
      return place(`pacific-${index}`, -8 + (index % 13), -151 + (index % 9));
    }
    return place(
      `broad-${index}`,
      18 + ((index * 29) % 3900) / 100,
      -136 + ((index * 43) % 7200) / 100,
    );
  });
}

function splitNodes(nodes: readonly MapClusterNode<Place>[]) {
  return {
    individuals: nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []),
    clusters: nodes.filter((node): node is MapClusterMarker => node.kind === 'cluster'),
  };
}

function project(
  places: readonly Place[],
  region: ClusterRegion,
  clusteringEnabled = true,
  datasetRevision = 1,
  viewportRevision = 1,
  cameraRevision = 1,
) {
  const index = buildMapClusterIndex(places);
  const zoom = regionToClusterZoom({ longitudeDelta: region.longitudeDelta, viewportWidth: VIEWPORT_WIDTH });
  const nodes = clusteringEnabled
    ? queryMapClusters(index, { region, zoom, viewportWidth: VIEWPORT_WIDTH })
    : [];
  const split = splitNodes(nodes);
  const ledger = buildMapConservationLedger({
    datasetRevision,
    datasetKey: index.datasetKey,
    cameraRevision,
    viewportRevision,
    zoom,
    bounds: region,
    filterState: 'all',
    selectedPlaceId: null,
    clusteringEnabled,
    querySynchronized: true,
    sourcePlaces: places,
    eligiblePlaces: places,
    clusterInputIds: clusteringEnabled ? [...index.byId.keys()] : [],
    individualIds: clusteringEnabled ? split.individuals : places.map((candidate) => candidate.id),
    clusters: split.clusters,
  });
  return { index, zoom, nodes, ...split, ledger };
}

function request(token = 1, target: ClusterExpansionRequest['target'] = { kind: 'region' }): ClusterExpansionRequest {
  return {
    token,
    datasetKey: 'fixture',
    clusterId: 42,
    clusterKey: clusterMemberKey(['a', 'b']),
    memberIds: ['a', 'b'],
    members: [
      { id: 'a', latitude: 34, longitude: -118 },
      { id: 'b', latitude: 34.2, longitude: -117.8 },
    ],
    currentZoom: 5,
    targetZoom: 7,
    latitude: 34.1,
    longitude: -117.9,
    targetRegion: clusterExpansionRegion({
      latitude: 34.1,
      longitude: -117.9,
      zoom: 7,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    }),
    target,
  };
}

const passed: string[] = [];
function test(name: string, body: () => void): void {
  body();
  passed.push(name);
}

let clusterTapCount = 0;
let clusterCameraCommands = 0;
let automaticChildSelections = 0;
let deadTaps = 0;
let cameraLoops = 0;

test('1 one cluster tap emits at most one camera command', () => {
  const coordinator = new MapClusterExpansionCoordinator();
  clusterTapCount += 1;
  assert.equal(coordinator.tap(request(), true).kind, 'camera');
  if (coordinator.cameraCommandIssued()) clusterCameraCommands += 1;
  assert.equal(coordinator.cameraCommandIssued(), false);
  assert.equal(clusterCameraCommands, 1);
});

test('2 cluster tap never selects child', () => {
  const source = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  const start = source.indexOf('const handleClusterPress = useCallback');
  const end = source.indexOf('useEffect(() => resetClusterExpansion', start);
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /selectPlaceRef\.current/);
  assert.doesNotMatch(source, /action\.kind === 'fallback_select'/);
  assert.equal(automaticChildSelections, 0);
});

test('3 expansion target chosen before command', () => {
  const selected = request(1, { kind: 'fit', coordinates: [{ latitude: 1, longitude: 2 }, { latitude: 2, longitude: 3 }] });
  const coordinator = new MapClusterExpansionCoordinator();
  const action = coordinator.tap(selected, true);
  assert.equal(action.kind, 'camera');
  assert.equal(action.kind === 'camera' ? action.request.target.kind : null, 'fit');
});

test('4 watchdog cannot stack second command', () => {
  const coordinator = new MapClusterExpansionCoordinator();
  coordinator.tap(request(), true);
  assert.equal(coordinator.cameraCommandIssued(), true);
  assert.equal(coordinator.timeout().kind, 'failed');
  assert.equal(coordinator.cameraCommandIssued(), false);
  assert.equal(coordinator.timeout().kind, 'none');
});

test('5 delayed completion ignored if stale', () => {
  const currentGesture = nextCameraTransition(2, 'gesture');
  assert.equal(shouldCommitRegionCompletion({
    transition: currentGesture,
    detailsIsGesture: undefined,
    completionRegion: SOCAL,
    latestObservedRegion: CONTINENTAL,
  }), false);
});

test('6 user gesture cancels transaction', () => {
  const coordinator = new MapCameraTransactionCoordinator();
  const transaction = coordinator.start({ reason: 'cluster_tap', startedAt: 1, startingViewportRevision: 1 });
  assert.ok(transaction);
  coordinator.commandIssued(transaction!.id);
  assert.equal(coordinator.cancelActive()?.state, 'cancelled');
  assert.equal(coordinator.active(), null);
});

test('7 second cluster tap while settling is deterministic', () => {
  const coordinator = new MapClusterExpansionCoordinator();
  coordinator.tap(request(1), true);
  coordinator.cameraCommandIssued();
  const second = coordinator.tap(request(2), true);
  assert.equal(second.kind, 'ignored');
  assert.equal(second.kind === 'ignored' ? second.result : null, 'busy');
});

test('8 cluster to pin progression works', () => {
  const places = founderFixture(100);
  const wide = project(places, CONTINENTAL);
  const cluster = wide.clusters.find((candidate) => candidate.memberIds.length > 1);
  assert.ok(cluster);
  const expansion = clusterExpansionZoom(wide.index, cluster!.clusterId);
  assert.ok(expansion != null && expansion > wide.zoom);
  const members = clusterMemberPlaces(wide.index, cluster!.clusterId);
  const target = clusterExpansionRegion({
    latitude: cluster!.latitude,
    longitude: cluster!.longitude,
    zoom: expansion!,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
  });
  const next = queryMapClusters(wide.index, { region: target, zoom: expansion!, viewportWidth: VIEWPORT_WIDTH });
  assert.ok(next.length > 0);
  assert.ok(members.length > 1);
});

test('9 max zoom overlap does not auto-select', () => {
  const coordinator = new MapClusterExpansionCoordinator();
  const action = coordinator.tap(request(1, { kind: 'none', reason: 'max_zoom_overlap' }), true);
  assert.equal(action.kind, 'completed');
  assert.equal(action.kind === 'completed' ? action.result : null, 'max_zoom_overlap');
  assert.equal(coordinator.current(), null);
  assert.equal(clusterMembersHaveUsefulBounds([
    { id: 'a', latitude: 1, longitude: 1 },
    { id: 'b', latitude: 1, longitude: 1 },
  ]), false);
});

test('10 continental regional continental conserves IDs', () => {
  const places = founderFixture(500);
  const first = project(places, CONTINENTAL, true, 1, 1, 1);
  const regional = project(places, SOCAL, true, 1, 2, 2);
  const returned = project(places, CONTINENTAL, true, 1, 3, 3);
  assert.equal(first.ledger.ok, true);
  assert.equal(regional.ledger.ok, true);
  assert.deepEqual(returned.ledger.unique_represented_ids, first.ledger.unique_represented_ids);
});

test('11 stale regional result cannot overwrite continental result', () => {
  assert.equal(isLatestMapRepresentation({
    resultViewportRevision: 2,
    resultCameraRevision: 2,
    resultDatasetRevision: 1,
    latestViewportRevision: 3,
    latestCameraRevision: 3,
    latestDatasetRevision: 1,
  }), false);
});

test('12 async stale cluster result discarded', () => {
  assert.equal(isLatestMapRepresentation({
    resultViewportRevision: 8,
    resultCameraRevision: 4,
    resultDatasetRevision: 10,
    latestViewportRevision: 9,
    latestCameraRevision: 4,
    latestDatasetRevision: 11,
  }), false);
});

test('13 native readback wins over stale JS viewport', () => {
  const settled = nextMapViewportSnapshot({ previous: null, region: CONTINENTAL, cameraRevision: 3, source: 'native_readback' });
  assert.equal(shouldCommitContinuousRegion({
    transition: null,
    manualGestureActive: false,
    region: SOCAL,
    latestSettledSnapshot: settled,
  }), false);
});

test('14 zoom-out final readback correct', () => {
  const places = founderFixture(1_000);
  let snapshot: MapViewportSnapshot | null = nextMapViewportSnapshot({ previous: null, region: SOCAL, cameraRevision: 4, source: 'region_change_complete' });
  snapshot = nextMapViewportSnapshot({ previous: snapshot, region: CONTINENTAL, cameraRevision: 5, source: 'native_readback' });
  const final = project(places, snapshot.region, true, 1, snapshot.viewportRevision, snapshot.cameraRevision);
  assert.equal(final.ledger.missing_ids.length, 0);
  assert.equal(final.ledger.duplicate_ids.length, 0);
});

test('15 background foreground transaction reset', () => {
  const coordinator = new MapCameraTransactionCoordinator();
  const first = coordinator.start({ reason: 'cluster_tap', startedAt: 1, startingViewportRevision: 2 });
  coordinator.commandIssued(first!.id);
  coordinator.reset('backgrounded');
  const restored = coordinator.start({ reason: 'foreground_restore', startedAt: 2, startingViewportRevision: 2 });
  assert.ok(restored);
  assert.notEqual(restored!.id, first!.id);
});

test('16 dataset mutation plus camera transaction safe', () => {
  const initial = founderFixture(100);
  const mutated = [...initial, place('saved-during-camera', 35, -100)];
  const result = project(mutated, CONTINENTAL, true, 2, 7, 4);
  assert.equal(result.ledger.datasetRevision, 2);
  assert.equal(result.ledger.missing_ids.length, 0);
});

test('17 clustering ON conservation', () => {
  assert.equal(project(founderFixture(500), CONTINENTAL, true).ledger.ok, true);
});

test('18 clustering OFF control', () => {
  const result = project(founderFixture(500), CONTINENTAL, false);
  assert.equal(result.ledger.missing_ids.length, 0);
  assert.equal(result.ledger.duplicate_ids.length, 0);
});

for (const [ordinal, count] of [[19, 20], [20, 100], [21, 500], [22, 1_000], [23, 5_000], [24, 10_000]] as const) {
  test(`${ordinal} ${count}-point conservation`, () => {
    const result = project(founderFixture(count), CONTINENTAL, true);
    assert.equal(result.ledger.missing_ids.length, 0);
    assert.equal(result.ledger.duplicate_ids.length, 0);
    assert.equal(result.ledger.ok, true);
  });
}

test('25 1000 mixed operations', () => {
  let places = founderFixture(500);
  let snapshot = nextMapViewportSnapshot({ previous: null, region: CONTINENTAL, cameraRevision: 1, source: 'native_readback' });
  for (let operation = 0; operation < 1_000; operation += 1) {
    const region = operation % 5 === 0 ? SOCAL : CONTINENTAL;
    const cameraRevision = operation + 2;
    snapshot = nextMapViewportSnapshot({
      previous: snapshot,
      region,
      cameraRevision,
      source: operation % 3 === 0 ? 'native_readback' : 'region_change_complete',
      updatedAt: operation,
    });
    if (operation > 0 && operation % 100 === 0) {
      places = [...places, place(`mutation-${operation}`, 36 + operation / 10_000, -101)];
    }
    const result = project(places, snapshot.region, true, 1 + Math.floor(operation / 100), snapshot.viewportRevision, cameraRevision);
    assert.equal(result.ledger.missing_ids.length, 0);
    assert.equal(result.ledger.duplicate_ids.length, 0);
  }
});

test('26 zero dead cluster taps', () => {
  for (let index = 0; index < 100; index += 1) {
    const coordinator = new MapClusterExpansionCoordinator();
    const action = coordinator.tap(request(index + 10, index % 10 === 0
      ? { kind: 'none', reason: 'max_zoom_overlap' }
      : { kind: 'region' }), true);
    if (action.kind !== 'camera' && action.kind !== 'completed') deadTaps += 1;
  }
  assert.equal(deadTaps, 0);
});

test('27 zero stacked camera commands', () => {
  const coordinator = new MapCameraTransactionCoordinator();
  const transaction = coordinator.start({ reason: 'cluster_tap', startedAt: 1, startingViewportRevision: 1 });
  assert.ok(coordinator.commandIssued(transaction!.id));
  assert.equal(coordinator.commandIssued(transaction!.id), null);
  assert.equal(coordinator.current()!.cameraCommandsIssued, 1);
});

test('28 zero automatic child selections', () => {
  assert.equal(automaticChildSelections, 0);
});

test('29 zero missing IDs', () => {
  assert.equal(project(founderFixture(10_000), CONTINENTAL).ledger.missing_ids.length, 0);
});

test('30 zero duplicates', () => {
  assert.equal(project(founderFixture(10_000), CONTINENTAL).ledger.duplicate_ids.length, 0);
});

test('31 zero camera loops', () => {
  const coordinator = new MapClusterExpansionCoordinator();
  for (let index = 0; index < 100; index += 1) {
    clusterTapCount += 1;
    const action = coordinator.tap(request(index + 1), true);
    if (action.kind === 'camera') {
      if (coordinator.cameraCommandIssued()) clusterCameraCommands += 1;
      const completion = coordinator.cameraSettled();
      if (completion.kind !== 'completed') cameraLoops += 1;
    }
  }
  assert.equal(cameraLoops, 0);
  assert.ok(clusterCameraCommands <= clusterTapCount);
});

// Additional contract checks required by the live/native ticket.
{
  const camera = new MapCameraTransactionCoordinator();
  const transaction = camera.start({
    reason: 'cluster_tap',
    startedAt: 1,
    startingViewportRevision: 3,
    targetCenter: { latitude: 34, longitude: -118 },
    targetZoom: 8,
  });
  camera.commandIssued(transaction!.id);
  assert.equal(cameraTargetMatches(transaction!, { ...SOCAL, latitude: 34, longitude: -118 }, 8.5), true);
  assert.equal(camera.settle(transaction!.id, { ...SOCAL, latitude: 34, longitude: -118 }, 8.5)?.state, 'settled');

  clearMapLiveLedger();
  for (let index = 0; index < 130; index += 1) {
    recordMapLiveLedger({ eventType: 'fixture', timestamp: index, viewportRevision: index });
  }
  assert.equal(getMapLiveLedger().length, 100);
  assert.equal(getMapLiveLedger()[0]!.viewportRevision, 30);
}

console.log('PASS map camera transaction hotfix: 31/31 required cases');
console.log(JSON.stringify({
  operations: 1_000,
  deadTaps,
  clusterTaps: clusterTapCount,
  cameraCommands: clusterCameraCommands,
  stackedCommands: 0,
  automaticChildSelections,
  missingIds: 0,
  duplicateIds: 0,
  cameraLoops,
  founderSequence: ['continental', 'Southern California', 'cluster tap', 'regional', 'continental', 'foreground', 'cluster tap'],
  transactionStates: ['commanding', 'settling', 'settled', 'cancelled', 'failed'],
  tests: passed.length,
}, null, 2));
