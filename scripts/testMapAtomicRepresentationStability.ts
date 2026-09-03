import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MapAtomicRepresentationCoordinator,
  createMapRepresentation,
  decideMapRepresentationCommit,
  type MapRepresentation,
} from '../lib/mapAtomicRepresentation';
import {
  buildMapClusterIndex,
  nextClusterZoom,
  nextClusterZoomDecision,
  queryMapClusters,
  regionToClusterZoom,
  type ClusterRegion,
  type MapClusterMarker,
  type MapClusterNode,
} from '../lib/mapClustering';
import { MapCameraTransactionCoordinator } from '../lib/mapCameraTransaction';
import { MapClusterExpansionCoordinator } from '../lib/mapClusterExpansion';
import type { SavedPlaceWithPlace } from '../types';

type Marker = { id: string };
type Cluster = { id: string };
type Representation = MapRepresentation<Marker, Cluster, undefined>;
type Place = SavedPlaceWithPlace;

const CONTINENTAL: ClusterRegion = {
  latitude: 18,
  longitude: -92,
  latitudeDelta: 142,
  longitudeDelta: 174,
};
const SOCAL: ClusterRegion = {
  latitude: 34,
  longitude: -117.8,
  latitudeDelta: 5,
  longitudeDelta: 7,
};
const WIDTH = 390;

function representation(overrides: Partial<{
  datasetRevision: number;
  datasetKey: string;
  viewportRevision: number;
  cameraRevision: number;
  visualZoom: number;
  queryZoom: number;
  bbox: [number, number, number, number];
  region: ClusterRegion;
  markers: Marker[];
  clusters: Cluster[];
  representedIds: string[];
  missingIds: string[];
  duplicateIds: string[];
  isConserved: boolean;
  source: 'initial' | 'region_change' | 'region_change_complete' | 'native_readback' | 'layout';
}> = {}): Representation {
  return createMapRepresentation({
    datasetRevision: overrides.datasetRevision ?? 1,
    datasetKey: overrides.datasetKey ?? 'dataset-1',
    viewportRevision: overrides.viewportRevision ?? 1,
    cameraRevision: overrides.cameraRevision ?? 1,
    visualZoom: overrides.visualZoom ?? 4.01,
    queryZoom: overrides.queryZoom ?? 4,
    bbox: overrides.bbox ?? [-170, -55, -5, 82],
    region: overrides.region ?? CONTINENTAL,
    markers: overrides.markers ?? [{ id: 'pin-a' }, { id: 'pin-b' }],
    clusters: overrides.clusters ?? [{ id: 'cluster-20' }, { id: 'cluster-6' }],
    representedIds: overrides.representedIds ?? ['pin-a', 'pin-b'],
    missingIds: overrides.missingIds ?? [],
    duplicateIds: overrides.duplicateIds ?? [],
    isConserved: overrides.isConserved ?? true,
    source: overrides.source ?? 'native_readback',
    metadata: undefined,
    createdAt: 0,
  });
}

function context(candidate: Representation, cameraTransitionActive = false) {
  return {
    currentDatasetRevision: candidate.datasetRevision,
    currentCameraRevision: candidate.cameraRevision,
    latestCommitEligibleViewportRevision: candidate.viewportRevision,
    latestCandidateId: candidate.id,
    cameraTransitionActive,
  };
}

function place(id: string, latitude: number, longitude: number): Place {
  return {
    id,
    place: {
      name: id,
      latitude,
      longitude,
      category: Number(id.replace(/\D/g, '')) % 3 === 0 ? 'lodging' :
        Number(id.replace(/\D/g, '')) % 2 === 0 ? 'park' : 'restaurant',
    },
  } as Place;
}

/** North America + dense SoCal + Central/South America + Pacific points. */
function founderFixture(count: number): Place[] {
  const dense = Math.floor(count * 0.48);
  return Array.from({ length: count }, (_, index) => {
    if (index < dense) {
      return place(
        `socal-${index}`,
        32.2 + ((index * 37) % 390) / 100,
        -120.2 + ((index * 53) % 560) / 100,
      );
    }
    if (index % 11 === 0) {
      return place(
        `south-${index}`,
        -52 + ((index * 31) % 6500) / 100,
        -81 + ((index * 17) % 4700) / 100,
      );
    }
    if (index % 17 === 0) {
      return place(
        `pacific-${index}`,
        -18 + ((index * 13) % 5400) / 100,
        -165 + ((index * 19) % 4200) / 100,
      );
    }
    return place(
      `broad-${index}`,
      8 + ((index * 29) % 6400) / 100,
      -143 + ((index * 43) % 11800) / 100,
    );
  });
}

function nodeIdentity(nodes: readonly MapClusterNode<Place>[]): string[] {
  return nodes.map((node) => node.id).sort();
}

function representedNodeIds(nodes: readonly MapClusterNode<Place>[]): string[] {
  return [...new Set(nodes.flatMap((node) =>
    node.kind === 'cluster' ? [...node.memberIds] : [node.id],
  ))].sort();
}

function conservedProjection(count: number, region = CONTINENTAL) {
  const places = founderFixture(count);
  const index = buildMapClusterIndex(places);
  const visualZoom = regionToClusterZoom({ longitudeDelta: region.longitudeDelta, viewportWidth: WIDTH });
  const queryZoom = nextClusterZoom(null, visualZoom);
  const nodes = queryMapClusters(index, { region, zoom: queryZoom, viewportWidth: WIDTH });
  const expected = places
    .filter((candidate) => (
      candidate.place.latitude >= region.latitude - region.latitudeDelta / 2 &&
      candidate.place.latitude <= region.latitude + region.latitudeDelta / 2 &&
      candidate.place.longitude >= region.longitude - region.longitudeDelta / 2 &&
      candidate.place.longitude <= region.longitude + region.longitudeDelta / 2
    ))
    .map((candidate) => candidate.id)
    .sort();
  const represented = new Set(representedNodeIds(nodes));
  const missing = expected.filter((id) => !represented.has(id));
  const occurrences = new Map<string, number>();
  for (const node of nodes) {
    const ids = node.kind === 'cluster' ? node.memberIds : [node.id];
    ids.forEach((id) => occurrences.set(id, (occurrences.get(id) ?? 0) + 1));
  }
  const duplicates = [...occurrences].filter(([, seen]) => seen > 1).map(([id]) => id);
  return { places, index, nodes, queryZoom, missing, duplicates };
}

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${passed}. ${name}`);
}

test('transient invalid viewport cannot clear a valid visible representation', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const initial = representation();
  coordinator.observe(initial);
  assert.equal(coordinator.commit(initial, context(initial)).allowed, true);
  const transient = representation({
    viewportRevision: 2,
    source: 'region_change',
    markers: [],
    clusters: [],
    representedIds: [],
    isConserved: false,
  });
  coordinator.observe(transient);
  assert.equal(coordinator.commit(transient, context(transient, true)).allowed, false);
  assert.equal(coordinator.visible()?.id, initial.id);
});

test('stale candidate cannot commit', () => {
  const candidate = representation({ viewportRevision: 4 });
  const decision = decideMapRepresentationCommit({
    candidate,
    visible: null,
    context: { ...context(candidate), latestCommitEligibleViewportRevision: 5 },
  });
  assert.equal(decision.reason, 'stale_viewport');
});

test('superseded candidate cannot commit', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const older = representation({ viewportRevision: 4 });
  const newer = representation({ viewportRevision: 5 });
  coordinator.observe(older);
  coordinator.observe(newer);
  assert.equal(coordinator.commit(older, { ...context(older), latestCandidateId: newer.id }).reason, 'superseded_candidate');
});

test('candidate missing IDs cannot commit', () => {
  const candidate = representation({ missingIds: ['pin-z'], isConserved: false });
  assert.equal(decideMapRepresentationCommit({ candidate, visible: null, context: context(candidate) }).reason, 'missing_ids');
});

test('candidate duplicates cannot commit', () => {
  const candidate = representation({ duplicateIds: ['pin-a'], isConserved: false });
  assert.equal(decideMapRepresentationCommit({ candidate, visible: null, context: context(candidate) }).reason, 'duplicate_ids');
});

test('final valid candidate commits atomically', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const candidate = representation();
  coordinator.observe(candidate);
  assert.equal(coordinator.commit(candidate, context(candidate)).allowed, true);
  assert.deepEqual(coordinator.visible()?.clusters, candidate.clusters);
});

test('one settled viewport produces at most one final visible commit', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const candidate = representation();
  coordinator.observe(candidate);
  coordinator.commit(candidate, context(candidate));
  coordinator.observe(candidate);
  assert.equal(coordinator.commit(candidate, context(candidate)).reason, 'equivalent_representation');
  assert.equal(coordinator.metrics().visibleCommitCount, 1);
});

const timelineRows: Array<Record<string, string | number | boolean>> = [];
test('50ms founder sequence has no visible thrash', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const oldValid = representation({ viewportRevision: 40, cameraRevision: 7 });
  coordinator.observe(oldValid);
  coordinator.commit(oldValid, context(oldValid));
  const events: Array<{ time: number; candidate: Representation; active: boolean }> = [
    { time: 10, candidate: representation({ viewportRevision: 40, cameraRevision: 7, source: 'region_change', markers: Array.from({ length: 48 }, (_, i) => ({ id: `raw-${i}` })), clusters: [] }), active: true },
    { time: 30, candidate: representation({ viewportRevision: 41, cameraRevision: 8, source: 'region_change', markers: [], clusters: [], representedIds: [] }), active: true },
    { time: 50, candidate: representation({ viewportRevision: 42, cameraRevision: 8, source: 'native_readback', markers: [{ id: 'pin-final' }], clusters: [{ id: 'cluster-final-20' }, { id: 'cluster-final-6' }], representedIds: ['pin-final'] }), active: false },
  ];
  timelineRows.push({ time: 0, visualZoom: oldValid.visualZoom, queryZoom: oldValid.queryZoom, candidate: oldValid.id, visible: coordinator.visible()!.id, commit: true, reason: 'commit_initial' });
  for (const event of events) {
    coordinator.observe(event.candidate);
    const decision = coordinator.commit(event.candidate, context(event.candidate, event.active));
    timelineRows.push({ time: event.time, visualZoom: event.candidate.visualZoom, queryZoom: event.candidate.queryZoom, candidate: event.candidate.id, visible: coordinator.visible()!.id, commit: decision.allowed, reason: decision.reason });
  }
  assert.deepEqual(timelineRows.slice(0, 3).map((row) => row.visible), [oldValid.id, oldValid.id, oldValid.id]);
  assert.notEqual(timelineRows[3]!.visible, oldValid.id);
  assert.equal(coordinator.metrics().visibleCommitCount, 2);
});

test('zoom boundary jitter does not alternate cluster zoom', () => {
  let queryZoom = 4;
  const seen: number[] = [];
  for (const visualZoom of [3.98, 4.01, 3.99, 4.02]) {
    queryZoom = nextClusterZoomDecision(queryZoom, visualZoom).zoom;
    seen.push(queryZoom);
  }
  assert.deepEqual(seen, [4, 4, 4, 4]);
});

test('stable viewport has a stable cluster tree', () => {
  const projection = conservedProjection(500);
  const repeated = queryMapClusters(projection.index, { region: CONTINENTAL, zoom: projection.queryZoom, viewportWidth: WIDTH });
  assert.deepEqual(nodeIdentity(repeated), nodeIdentity(projection.nodes));
});

test('visual zoom is separated from integer cluster query zoom', () => {
  const visualZoom = 4.02;
  const decision = nextClusterZoomDecision(4, visualZoom);
  assert.equal(decision.zoom, 4);
  assert.notEqual(visualZoom, decision.zoom);
});

test('cluster tap transaction remains one command', () => {
  const coordinator = new MapCameraTransactionCoordinator();
  const first = coordinator.start({ reason: 'cluster_tap', startedAt: 0, startingViewportRevision: 1 });
  assert.ok(first);
  assert.ok(coordinator.commandIssued(first.id));
  assert.equal(coordinator.start({ reason: 'cluster_tap', startedAt: 1, startingViewportRevision: 1 }), null);
  assert.equal(coordinator.current()?.cameraCommandsIssued, 1);
});

test('automatic child selection remains zero', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(tabs)', 'map.tsx'), 'utf8');
  assert.doesNotMatch(source, /selectPlaceRef\.current\([^)]*cluster/i);
  const coordinator = new MapClusterExpansionCoordinator();
  assert.equal(coordinator.current(), null);
});

test('continental to regional to continental final conservation remains', () => {
  const broad = conservedProjection(1000, CONTINENTAL);
  const regional = conservedProjection(1000, SOCAL);
  const broadAgain = conservedProjection(1000, CONTINENTAL);
  assert.deepEqual([broad.missing.length, regional.missing.length, broadAgain.missing.length], [0, 0, 0]);
  assert.deepEqual([broad.duplicates.length, regional.duplicates.length, broadAgain.duplicates.length], [0, 0, 0]);
});

function assertAtomicDatasetSwap(oldCandidate: Representation, nextCandidate: Representation): void {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  coordinator.observe(oldCandidate);
  coordinator.commit(oldCandidate, context(oldCandidate));
  const oldId = coordinator.visible()!.id;
  coordinator.observe(nextCandidate);
  assert.equal(coordinator.visible()!.id, oldId);
  assert.equal(coordinator.commit(nextCandidate, context(nextCandidate)).allowed, true);
  assert.equal(coordinator.visible()!.id, nextCandidate.id);
}

test('filter changes are atomic', () => {
  assertAtomicDatasetSwap(representation(), representation({ datasetRevision: 2, datasetKey: 'filter-other', markers: [{ id: 'other-48' }], clusters: [] }));
});

test('dataset save is atomic', () => {
  assertAtomicDatasetSwap(representation(), representation({ datasetRevision: 2, datasetKey: 'saved-plus-one', markers: [{ id: 'pin-a' }, { id: 'pin-b' }, { id: 'pin-c' }] }));
});

test('dataset delete is atomic', () => {
  assertAtomicDatasetSwap(representation(), representation({ datasetRevision: 2, datasetKey: 'saved-minus-one', markers: [{ id: 'pin-a' }] }));
});

test('foreground resync is atomic', () => {
  const oldCandidate = representation();
  const nextCandidate = representation({ cameraRevision: 2, viewportRevision: 2, source: 'native_readback', markers: [{ id: 'foreground-pin' }] });
  assertAtomicDatasetSwap(oldCandidate, nextCandidate);
});

test('no temporary empty arrays appear after first valid render', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const initial = representation();
  coordinator.observe(initial);
  coordinator.commit(initial, context(initial));
  const empty = representation({ source: 'region_change', markers: [], clusters: [], representedIds: [], viewportRevision: 2, cameraRevision: 2 });
  coordinator.observe(empty);
  coordinator.commit(empty, context(empty, true));
  assert.ok((coordinator.visible()!.markers.length + coordinator.visible()!.clusters.length) > 0);
  const source = readFileSync(join(process.cwd(), 'app', '(tabs)', 'map.tsx'), 'utf8');
  assert.match(source, /const clusterMarkers = visibleRepresentation\?\.clusters \?\? \[\]/);
  assert.match(source, /decideMapRepresentationCommit/);
  assert.match(source, /onRegionChange=\{handleRegionChange\}/);
});

test('individual marker keys remain stable', () => {
  const first = representation({ viewportRevision: 1 });
  const second = representation({ viewportRevision: 2 });
  assert.deepEqual(first.markers.map((marker) => marker.id), second.markers.map((marker) => marker.id));
  const source = readFileSync(join(process.cwd(), 'app', '(tabs)', 'map.tsx'), 'utf8');
  assert.match(source, /key=\{p\.id\}/);
});

test('cluster keys remain stable', () => {
  const projection = conservedProjection(500);
  const clusters = projection.nodes.filter((node): node is MapClusterMarker => node.kind === 'cluster');
  const repeated = queryMapClusters(projection.index, { region: CONTINENTAL, zoom: projection.queryZoom, viewportWidth: WIDTH })
    .filter((node): node is MapClusterMarker => node.kind === 'cluster');
  assert.deepEqual(clusters.map((cluster) => cluster.id), repeated.map((cluster) => cluster.id));
  const source = readFileSync(join(process.cwd(), 'app', '(tabs)', 'map.tsx'), 'utf8');
  assert.match(source, /key=\{cluster\.id\}/);
});

test('equivalent representation causes no redundant commit', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  const first = representation({ viewportRevision: 1 });
  const equivalent = representation({ viewportRevision: 2, bbox: [-169.99999, -55, -5, 82] });
  coordinator.observe(first);
  coordinator.commit(first, context(first));
  coordinator.observe(equivalent);
  assert.equal(coordinator.commit(equivalent, context(equivalent)).reason, 'equivalent_representation');
});

for (const count of [20, 100, 500, 1000, 5000, 10000]) {
  test(`${count.toLocaleString()}-point conservation`, () => {
    const projection = conservedProjection(count);
    assert.equal(projection.missing.length, 0);
    assert.equal(projection.duplicates.length, 0);
  });
}

let stressMetrics: ReturnType<MapAtomicRepresentationCoordinator<Marker, Cluster>['metrics']>;
test('1,000-operation mixed transition stress stays valid', () => {
  const coordinator = new MapAtomicRepresentationCoordinator<Marker, Cluster>();
  let current = representation({ viewportRevision: 1, cameraRevision: 1 });
  coordinator.observe(current);
  coordinator.commit(current, context(current));
  for (let operation = 1; operation <= 1000; operation += 1) {
    const revision = operation + 1;
    const transient = representation({ viewportRevision: revision, cameraRevision: revision, source: 'region_change', markers: [], clusters: [], representedIds: [] });
    coordinator.observe(transient);
    coordinator.commit(transient, context(transient, true));
    current = representation({
      datasetRevision: 1 + Math.floor(operation / 100),
      datasetKey: `stress-${1 + Math.floor(operation / 100)}`,
      viewportRevision: revision,
      cameraRevision: revision,
      source: operation % 2 === 0 ? 'native_readback' : 'region_change_complete',
      markers: [{ id: `pin-${operation % 17}` }],
      clusters: [{ id: `cluster-${operation % 23}` }],
    });
    coordinator.observe(current);
    coordinator.commit(current, context(current));
  }
  stressMetrics = coordinator.metrics();
  assert.equal(stressMetrics.nonConservedVisibleCommitCount, 0);
  assert.equal(stressMetrics.staleVisibleCommitCount, 0);
  assert.equal(stressMetrics.invalidVisibleCommitCount, 0);
});

test('zero stale visible commits', () => {
  assert.equal(stressMetrics.staleVisibleCommitCount, 0);
});

test('zero invalid visible commits', () => {
  assert.equal(stressMetrics.invalidVisibleCommitCount, 0);
});

assert.equal(passed, 31);
console.log('\nFounder 50ms atomic visibility timeline');
console.table(timelineRows);
console.log('\nStress metrics', stressMetrics!);
console.log(`PASS map atomic representation stability: ${passed}/31 cases`);
