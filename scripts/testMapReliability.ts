import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMapClusterIndex,
  clusterExpansionRegion,
  clusterExpansionZoom,
  clusterTapZoom,
  clusterWithoutSelectedMember,
  queryMapClusters,
  regionToClusterZoom,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import {
  assertMarkerConservation,
  clearMapReliabilityDiagnostics,
  getMapReliabilityDiagnostics,
  recordMapReliabilityDiagnostic,
} from '../lib/mapReliability';
import { isSameCanonicalPlace } from '../lib/placeCanonicalization';
import { shouldCommitSavedPlacesFetch } from '../lib/savedPlacesDatasetVersion';
import { filterPlacesForMap, MAP_FILTER_ALL, type MapVisibilityFilter } from '../lib/mapVisibility';
import { distanceMeters } from '../lib/geo';
import type { SavedPlaceWithPlace } from '../types';

type Place = SavedPlaceWithPlace;
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 760;

function saved(
  id: string,
  latitude: number,
  longitude: number,
  category = 'restaurant',
  name = id,
): Place {
  return {
    id,
    category,
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name,
      formatted_address: `${id} Test Street`,
      latitude,
      longitude,
      category,
      google_maps_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  } as Place;
}

function zoomFor(region: ClusterRegion): number {
  return Math.round(regionToClusterZoom({
    longitudeDelta: region.longitudeDelta,
    viewportWidth: VIEWPORT_WIDTH,
  }));
}

type RenderState = {
  places: Place[];
  filter: MapVisibilityFilter;
  selectedId: string | null;
  region: ClusterRegion;
};

type RenderFrame = {
  eligible: Place[];
  individuals: Place[];
  clusters: MapClusterMarker[];
  index: ReturnType<typeof buildMapClusterIndex<Place>>;
  zoom: number;
};

function renderFrame(state: RenderState): RenderFrame {
  const eligible = filterPlacesForMap(state.places, state.filter, state.selectedId);
  const index = buildMapClusterIndex(eligible);
  const zoom = zoomFor(state.region);
  const nodes = queryMapClusters(index, {
    region: state.region,
    zoom,
    viewportWidth: VIEWPORT_WIDTH,
  });
  const looseIds = new Set(nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []));
  const selectedCompanions = new Set<string>();
  const clusters = nodes.flatMap((node) => {
    if (node.kind !== 'cluster') return [];
    const projected = clusterWithoutSelectedMember(node, state.selectedId, zoom);
    if (projected.looseMemberId) selectedCompanions.add(projected.looseMemberId);
    return projected.cluster ? [projected.cluster] : [];
  });
  const individuals = eligible.filter((place) =>
    place.id === state.selectedId || looseIds.has(place.id) || selectedCompanions.has(place.id),
  );
  assertMarkerConservation({
    eligiblePlaces: eligible,
    individualIds: individuals.map((place) => place.id),
    clusters,
    region: state.region,
  });
  return { eligible, individuals, clusters, index, zoom };
}

function lcg(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function generatedLayout(kind: string, count: number, seed: number): Place[] {
  const random = lcg(seed);
  const result: Place[] = [];
  for (let index = 0; index < count; index += 1) {
    let latitude = 34;
    let longitude = -118;
    if (kind === 'dense_urban') {
      latitude += (random() - 0.5) * 0.03;
      longitude += (random() - 0.5) * 0.03;
    } else if (kind === 'sparse_suburban') {
      latitude += (random() - 0.5) * 1.2;
      longitude += (random() - 0.5) * 1.2;
    } else if (kind === 'linear_coastline') {
      latitude += index * 0.002;
      longitude += index * 0.00012;
    } else if (kind === 'same_coordinate') {
      // Intentionally identical.
    } else if (kind === 'near_distinct') {
      latitude += Math.floor(index / 2) * 0.004;
      longitude += (index % 2) * 0.0009;
    } else if (kind === 'international') {
      latitude = -70 + random() * 140;
      longitude = -179 + random() * 358;
    } else {
      const metro = index % 8;
      latitude = -35 + metro * 10 + (random() - 0.5) * 0.5;
      longitude = -150 + metro * 38 + (random() - 0.5) * 0.5;
    }
    result.push(saved(
      `${kind}-${index}`,
      latitude,
      longitude,
      ['restaurant', 'park', 'hotel', 'shopping', 'fitness', 'museum', 'other'][index % 7],
    ));
  }
  return result;
}

// -------------------------------------------------------------------------
// Canonicalization: strong identity only; ambiguous nearby destinations stay.
// -------------------------------------------------------------------------

assert.equal(isSameCanonicalPlace(
  { googlePlaceId: 'same', name: 'Old name' },
  { google_place_id: 'same', name: 'New name' },
), true);
assert.equal(isSameCanonicalPlace(
  { googlePlaceId: 'beach', name: 'Waimea Bay Beach', latitude: 21.64, longitude: -158.06 },
  { google_place_id: 'park', name: 'Waimea Bay Beach Park', latitude: 21.6401, longitude: -158.0601 },
), false);
assert.equal(isSameCanonicalPlace(
  { googlePlaceId: 'branch-a', name: 'Blue Bottle', latitude: 34, longitude: -118 },
  { google_place_id: 'branch-b', name: 'Blue Bottle', latitude: 34.0001, longitude: -118 },
), false);
assert.equal(isSameCanonicalPlace(
  { name: 'Exact Place', formattedAddress: '1 Main St', latitude: 34, longitude: -118 },
  { name: 'Exact Place', formatted_address: '1 Main St', latitude: 34.0001, longitude: -118 },
), true);
assert.equal(isSameCanonicalPlace(
  { name: 'Exact Place', formattedAddress: '1 Main St', latitude: 34, longitude: -118 },
  { name: 'Exact Place', formatted_address: '2 Main St', latitude: 34.0001, longitude: -118 },
), false);

// -------------------------------------------------------------------------
// Viewport edge + empty viewport regressions.
// -------------------------------------------------------------------------

for (const viewportWidth of [320, 430, 768]) {
  const zoom = 10;
  const longitudeDelta = (360 * viewportWidth) / (256 * 2 ** zoom);
  const region = { latitude: 0, longitude: 0, latitudeDelta: longitudeDelta, longitudeDelta };
  const degreesPerPoint = longitudeDelta / viewportWidth;
  const west = -longitudeDelta / 2;
  const places = [
    saved('inside-edge', 0, west + degreesPerPoint * 0.1),
    ...Array.from({ length: 20 }, (_, index) =>
      saved(`outside-edge-${index}`, 0, west - degreesPerPoint * 55),
    ),
    saved('center-control', 0, 0),
  ];
  const index = buildMapClusterIndex(places);
  const nodes = queryMapClusters(index, { region, zoom, viewportWidth });
  const represented = new Set(nodes.flatMap((node) =>
    node.kind === 'place' ? [node.id] : [...node.memberIds],
  ));
  assert.ok(
    represented.has('inside-edge'),
    `onscreen edge member remains represented at ${viewportWidth}px`,
  );
  assertMarkerConservation({
    eligiblePlaces: places,
    individualIds: nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []),
    clusters: nodes.flatMap((node) => node.kind === 'cluster' ? [node] : []),
    region,
  });
}

{
  const places = generatedLayout('dense_urban', 10_000, 1);
  const nodes = queryMapClusters(buildMapClusterIndex(places), {
    region: { latitude: -35, longitude: 120, latitudeDelta: 0.01, longitudeDelta: 0.01 },
    zoom: 16,
    viewportWidth: VIEWPORT_WIDTH,
  });
  assert.equal(nodes.length, 0, 'empty viewport is explicit offscreen state, not 10k native markers');
}

// Duplicate dataset rows are canonicalized by saved_places.id before indexing.
{
  const one = saved('stable-id', 34, -118);
  const index = buildMapClusterIndex([one, { ...one, place: { ...one.place } }]);
  assert.equal(index.pointCount, 1);
}

// -------------------------------------------------------------------------
// Determinism, membership counts, screen-space behavior.
// -------------------------------------------------------------------------

const deterministicPlaces = generatedLayout('dense_urban', 250, 42);
const deterministicRegion = { latitude: 34, longitude: -118, latitudeDelta: 0.12, longitudeDelta: 0.12 };
const deterministicIndex = buildMapClusterIndex(deterministicPlaces);
const deterministicZoom = zoomFor(deterministicRegion);
const signature = () => queryMapClusters(deterministicIndex, {
  region: deterministicRegion,
  zoom: deterministicZoom,
  viewportWidth: VIEWPORT_WIDTH,
}).map((node) => node.kind === 'place'
  ? `p:${node.id}`
  : `c:${node.id}:${node.count}:${node.memberIds.join(',')}`);
assert.deepEqual(signature(), signature());
assert.equal(
  buildMapClusterIndex([...deterministicPlaces].reverse()).datasetKey,
  deterministicIndex.datasetKey,
  'dataset identity is input-order independent',
);
for (const node of queryMapClusters(deterministicIndex, {
  region: deterministicRegion,
  zoom: deterministicZoom,
  viewportWidth: VIEWPORT_WIDTH,
})) {
  if (node.kind === 'cluster') {
    assert.equal(node.count, node.memberIds.length);
    assert.equal(node.engineCount, node.memberIds.length);
  }
}

const distanceRows: string[] = [];
for (const meters of [25, 100, 250, 500, 1_000, 2_000]) {
  const latitudeDelta = meters / 111_000;
  const pair = [saved(`m${meters}-a`, 34, -118), saved(`m${meters}-b`, 34 + latitudeDelta, -118)];
  const actual = distanceMeters(
    { latitude: pair[0]!.place.latitude, longitude: pair[0]!.place.longitude },
    { latitude: pair[1]!.place.latitude, longitude: pair[1]!.place.longitude },
  );
  const states: string[] = [];
  for (const zoom of [13, 14, 15, 16, 17]) {
    const region = clusterExpansionRegion({
      latitude: 34 + latitudeDelta / 2,
      longitude: -118,
      zoom,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    const nodes = queryMapClusters(buildMapClusterIndex(pair), {
      region,
      zoom,
      viewportWidth: VIEWPORT_WIDTH,
    });
    const pointCount = nodes.filter((node) => node.kind === 'place').length;
    states.push(`z${zoom}:${nodes.some((node) => node.kind === 'cluster') ? 'cluster' : pointCount === 2 ? 'split' : 'offscreen'}`);
    if (zoom === 17 && meters <= 500) assert.equal(pointCount, 2);
  }
  distanceRows.push(`${actual.toFixed(0)}m ${states.join(' ')}`);
}

// -------------------------------------------------------------------------
// Filter, selection, mutation, lifecycle and seeded interaction sequence.
// -------------------------------------------------------------------------

const sequencePlaces = generatedLayout('dense_urban', 100, 9001);
const fullIds = sequencePlaces.map((place) => place.id).sort();
const state: RenderState = {
  places: sequencePlaces,
  filter: MAP_FILTER_ALL,
  selectedId: null,
  region: { latitude: 34, longitude: -118, latitudeDelta: 0.08, longitudeDelta: 0.08 },
};
let markerLossFailures = 0;
let duplicateFailures = 0;
let invalidMembership = 0;
let cameraLoops = 0;
let unboundedRenders = 0;
let cameraCommands = 0;
let renders = 0;
const random = lcg(20260824);

function checkedRender(): RenderFrame {
  try {
    const frame = renderFrame(state);
    renders += 1;
    return frame;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('missing=')) markerLossFailures += 1;
    if (message.includes('duplicates=')) duplicateFailures += 1;
    if (message.includes('invalid_clusters=')) invalidMembership += 1;
    throw error;
  }
}

checkedRender();
for (const filter of ['food_drink', 'stays', 'outdoors', 'things_to_do', 'shopping', 'fitness_wellness', 'other']) {
  state.filter = filter;
  checkedRender();
}
state.filter = MAP_FILTER_ALL;
assert.deepEqual(checkedRender().eligible.map((place) => place.id).sort(), fullIds);

for (let operation = 0; operation < 500; operation += 1) {
  const choice = Math.floor(random() * 12);
  const beforeCommands = cameraCommands;
  let frame = checkedRender();
  if (choice === 0 && frame.clusters.length > 0) {
    const cluster = frame.clusters[Math.floor(random() * frame.clusters.length)]!;
    const expansion = clusterExpansionZoom(frame.index, cluster.clusterId) ?? frame.zoom + 1;
    const targetZoom = clusterTapZoom({ expansionZoom: expansion, currentZoom: frame.zoom });
    state.region = clusterExpansionRegion({
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      zoom: targetZoom,
      viewportWidth: VIEWPORT_WIDTH,
      viewportHeight: VIEWPORT_HEIGHT,
    });
    cameraCommands += 1;
    frame = checkedRender();
    if (frame.clusters.some((candidate) => candidate.clusterKey === cluster.clusterKey)) {
      // The bounded terminal fallback selects one canonical member.
      state.selectedId = cluster.memberIds.find((id) => state.places.some((place) => place.id === id)) ?? null;
      cameraCommands += 1;
      checkedRender();
    }
  } else if (choice === 1 && frame.individuals.length > 0) {
    state.selectedId = frame.individuals[Math.floor(random() * frame.individuals.length)]!.id;
    cameraCommands += 1;
    checkedRender();
  } else if (choice === 2) {
    state.selectedId = null;
  } else if (choice === 3) {
    state.region = { ...state.region, longitude: state.region.longitude + (random() - 0.5) * state.region.longitudeDelta };
  } else if (choice === 4) {
    const scale = random() > 0.5 ? 0.55 : 1.8;
    state.region = { ...state.region, latitudeDelta: state.region.latitudeDelta * scale, longitudeDelta: state.region.longitudeDelta * scale };
  } else if (choice === 5) {
    state.filter = ['all', 'food_drink', 'outdoors', 'shopping'][Math.floor(random() * 4)]!;
  } else if (choice === 6) {
    const id = `saved-live-${operation}`;
    state.places = [saved(id, 34 + (random() - 0.5) * 0.02, -118 + (random() - 0.5) * 0.02), ...state.places];
  } else if (choice === 7 && state.places.length > 20) {
    const index = Math.floor(random() * state.places.length);
    const removed = state.places[index]!;
    state.places = state.places.filter((place) => place.id !== removed.id);
    if (state.selectedId === removed.id) state.selectedId = null;
  } else if (choice === 8) {
    // Place Detail and back preserve the dataset/camera.
    checkedRender();
  } else if (choice === 9) {
    // Background/foreground preserves canonical marker state.
    checkedRender();
  } else if (choice === 10) {
    // Nearby Now reads the same dataset and may select one visible place.
    state.selectedId = frame.individuals[0]?.id ?? state.selectedId;
  } else {
    // Queue/group return focuses a bounded set without changing membership.
    state.selectedId = state.places[Math.floor(random() * state.places.length)]?.id ?? null;
  }
  checkedRender();
  if (cameraCommands - beforeCommands > 2) cameraLoops += 1;
}
if (renders > 2_500) unboundedRenders += 1;

assert.equal(markerLossFailures, 0);
assert.equal(duplicateFailures, 0);
assert.equal(invalidMembership, 0);
assert.equal(cameraLoops, 0);
assert.equal(unboundedRenders, 0);

// Stale network responses cannot overwrite a newer local mutation generation.
assert.equal(shouldCommitSavedPlacesFetch(4, 4), true);
assert.equal(shouldCommitSavedPlacesFetch(4, 5), false);

// Fuzz every requested geometry family at several camera states.
for (const [layoutIndex, layout] of [
  'dense_urban',
  'sparse_suburban',
  'linear_coastline',
  'same_coordinate',
  'near_distinct',
  'international',
  'large_mixed',
].entries()) {
  const places = generatedLayout(layout, 350, 100 + layoutIndex);
  for (const region of [
    { latitude: 34, longitude: -118, latitudeDelta: 0.02, longitudeDelta: 0.02 },
    { latitude: 34, longitude: -118, latitudeDelta: 1, longitudeDelta: 1 },
    { latitude: 0, longitude: 179.8, latitudeDelta: 120, longitudeDelta: 20 },
    { latitude: -30, longitude: 120, latitudeDelta: 0.1, longitudeDelta: 0.1 },
  ]) {
    renderFrame({ places, filter: MAP_FILTER_ALL, selectedId: null, region });
  }
}

// -------------------------------------------------------------------------
// Performance: median/p95 for required scales.
// -------------------------------------------------------------------------

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]!;
}
function metric(values: number[]): string {
  return `${percentile(values, 0.5).toFixed(2)}/${percentile(values, 0.95).toFixed(2)}ms`;
}

const performanceRows: string[] = [];
for (const count of [100, 500, 1_000, 5_000, 10_000]) {
  const places = generatedLayout('dense_urban', count, count);
  const region = { latitude: 34, longitude: -118, latitudeDelta: 0.2, longitudeDelta: 0.2 };
  const zoom = zoomFor(region);
  const builds: number[] = [];
  let index = buildMapClusterIndex(places);
  for (let pass = 0; pass < 7; pass += 1) {
    const started = performance.now();
    index = buildMapClusterIndex(places);
    builds.push(performance.now() - started);
  }
  const queries: number[] = [];
  let nodes = queryMapClusters(index, { region, zoom, viewportWidth: VIEWPORT_WIDTH });
  for (let pass = 0; pass < 25; pass += 1) {
    const started = performance.now();
    nodes = queryMapClusters(index, {
      region: { ...region, longitude: region.longitude + pass * 0.00001 },
      zoom,
      viewportWidth: VIEWPORT_WIDTH,
    });
    queries.push(performance.now() - started);
  }
  const preparations: number[] = [];
  for (let pass = 0; pass < 20; pass += 1) {
    const started = performance.now();
    const clusters = nodes.flatMap((node) => node.kind === 'cluster' ? [node] : []);
    const individuals = nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []);
    assertMarkerConservation({ eligiblePlaces: places, individualIds: individuals, clusters, region });
    preparations.push(performance.now() - started);
  }
  const taps: number[] = [];
  const cluster = nodes.find((node): node is MapClusterMarker => node.kind === 'cluster');
  for (let pass = 0; pass < 50; pass += 1) {
    const started = performance.now();
    if (cluster) {
      const expansion = clusterExpansionZoom(index, cluster.clusterId) ?? zoom + 1;
      clusterExpansionRegion({
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        zoom: clusterTapZoom({ expansionZoom: expansion, currentZoom: zoom }),
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      });
    }
    taps.push(performance.now() - started);
  }
  const filterSwitches: number[] = [];
  for (let pass = 0; pass < 7; pass += 1) {
    const started = performance.now();
    buildMapClusterIndex(filterPlacesForMap(places, pass % 2 ? 'food_drink' : 'outdoors'));
    filterSwitches.push(performance.now() - started);
  }
  assert.ok(percentile(builds, 0.95) < 350, `${count}: index p95 budget`);
  assert.ok(percentile(queries, 0.95) < 80, `${count}: query p95 budget`);
  assert.ok(percentile(preparations, 0.95) < 80, `${count}: render prep p95 budget`);
  assert.ok(percentile(taps, 0.95) < 25, `${count}: tap p95 budget`);
  performanceRows.push(
    `${count}|${metric(builds)}|${metric(queries)}|${metric(preparations)}|${metric(taps)}|${metric(filterSwitches)}`,
  );
}

// Production-safe diagnostics are bounded and contain only aggregate fields.
(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
clearMapReliabilityDiagnostics();
for (let index = 0; index < 100; index += 1) {
  recordMapReliabilityDiagnostic('map_cluster_index_rebuilt', {
    datasetGeneration: index,
    placeCount: 100,
    durationMs: 1.234,
  });
}
assert.equal(getMapReliabilityDiagnostics().length, 80);

const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
assert.match(mapSource, /viewportWidth: windowWidth/);
assert.match(mapSource, /assertMarkerConservation\(args\)/);
assert.match(mapSource, /clusterWithoutSelectedMember\(node, selectedMarkerId/);
assert.match(mapSource, /recordMapReliabilityDiagnostic\('map_pin_tap'/);
assert.match(mapSource, /recordMapReliabilityDiagnostic\('map_cluster_tap'/);

console.log('DISTANCE/Z:', distanceRows.join(' | '));
console.log('PERF Places|Index median/p95|Query median/p95|Render prep median/p95|Tap median/p95|Filter median/p95');
performanceRows.forEach((row) => console.log(`PERF ${row}`));
console.log(`SEEDED operations=500 renders=${renders} camera_commands=${cameraCommands}`);
console.log(`RESULT marker_loss=${markerLossFailures} duplicates=${duplicateFailures} invalid_membership=${invalidMembership} camera_loops=${cameraLoops} unbounded_renders=${unboundedRenders}`);
console.log('PASS map reliability sequences, conservation, fuzz geometry, canonicalization, stable identity, stale-fetch gate, and performance');
