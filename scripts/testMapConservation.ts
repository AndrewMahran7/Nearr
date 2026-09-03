import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildConservationFallbackCluster,
  buildMapClusterIndex,
  clusterExpansionRegion,
  clusterWithoutSelectedMember,
  queryMapClusters,
  regionToClusterZoom,
  SAFE_RAW_MARKER_LIMIT,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { buildMapConservationLedger } from '../lib/mapConservation';
import {
  isClusterQuerySynchronized,
  nextCameraTransition,
  nextMapViewportSnapshot,
  regionFromMapBoundaries,
  shouldCommitRegionCompletion,
  type MapViewportSnapshot,
} from '../lib/mapViewportSync';
import { filterPlacesForMap, MAP_FILTER_ALL, type MapVisibilityFilter } from '../lib/mapVisibility';
import { shouldCommitSavedPlacesFetch } from '../lib/savedPlacesDatasetVersion';
import type { SavedPlaceWithPlace } from '../types';

type Place = SavedPlaceWithPlace;
const WIDTH = 390;
const HEIGHT = 760;

function saved(id: string, latitude: number, longitude: number, category = 'restaurant'): Place {
  return {
    id,
    category,
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: id,
      formatted_address: `${id} fixture`,
      latitude,
      longitude,
      category,
      google_maps_url: null,
      created_at: '2026-08-25T00:00:00.000Z',
    },
  } as Place;
}

function valid(place: Place): boolean {
  const { latitude, longitude } = place.place;
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    !(latitude === 0 && longitude === 0);
}

function zoomFor(region: ClusterRegion, width = WIDTH): number {
  return Math.round(regionToClusterZoom({ longitudeDelta: region.longitudeDelta, viewportWidth: width }));
}

function represented(clusters: readonly MapClusterMarker[], individuals: readonly Place[]): Set<string> {
  return new Set([
    ...individuals.map((place) => place.id),
    ...clusters.flatMap((cluster) => [...cluster.memberIds]),
  ]);
}

function frame(args: {
  source: Place[];
  filter?: MapVisibilityFilter;
  selectedId?: string | null;
  region: ClusterRegion;
  clustering?: boolean;
  cameraRevision?: number;
  snapshot?: MapViewportSnapshot | null;
  width?: number;
}) {
  const filter = args.filter ?? MAP_FILTER_ALL;
  const selectedId = args.selectedId ?? null;
  const width = args.width ?? WIDTH;
  const eligibleSource = args.source.filter(valid);
  const eligible = filterPlacesForMap(eligibleSource, filter, selectedId);
  const clustering = args.clustering ?? true;
  const index = buildMapClusterIndex(clustering ? eligible : []);
  const zoom = zoomFor(args.region, width);
  const nodes = clustering ? queryMapClusters(index, { region: args.region, zoom, viewportWidth: width }) : [];
  const clusters: MapClusterMarker[] = [];
  const loose = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'place') {
      loose.add(node.id);
    } else {
      const projected = clusterWithoutSelectedMember(node, selectedId, zoom);
      if (projected.cluster) clusters.push(projected.cluster);
      if (projected.looseMemberId) loose.add(projected.looseMemberId);
    }
  }
  const individuals = clustering
    ? eligible.filter((place) => place.id === selectedId || loose.has(place.id))
    : eligible;
  const cameraRevision = args.cameraRevision ?? 0;
  const querySynchronized = args.snapshot
    ? isClusterQuerySynchronized(cameraRevision, args.snapshot)
    : cameraRevision === 0;
  const ledger = buildMapConservationLedger({
    datasetRevision: 1,
    datasetKey: index.datasetKey,
    cameraRevision,
    viewportRevision: args.snapshot?.viewportRevision ?? 0,
    zoom,
    bounds: args.region,
    filterState: String(filter),
    selectedPlaceId: selectedId,
    clusteringEnabled: clustering,
    querySynchronized,
    sourcePlaces: args.source,
    eligiblePlaces: eligible,
    clusterInputIds: clustering ? eligible.map((place) => place.id) : [],
    individualIds: individuals.map((place) => place.id),
    clusters,
  });
  return { eligible, index, zoom, clusters, individuals, ledger };
}

function lcg(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function seeded(count: number, seed = 1): Place[] {
  const random = lcg(seed);
  const categories = ['restaurant', 'hotel', 'park', 'museum', 'shopping', 'fitness', 'other'];
  return Array.from({ length: count }, (_, index) => saved(
    `seed-${seed}-${index}`,
    34 + (random() - 0.5) * 0.7,
    -118 + (random() - 0.5) * 0.9,
    categories[index % categories.length],
  ));
}

// 1. Continental fixture and count/member equality.
const continental = seeded(20, 20);
const continentalRegion = { latitude: 34, longitude: -118, latitudeDelta: 3, longitudeDelta: 4 };
const continentalFrame = frame({ source: continental, region: continentalRegion });
assert.equal(continentalFrame.ledger.missing_ids.length, 0);
assert.equal(continentalFrame.ledger.duplicate_ids.length, 0);
for (const cluster of continentalFrame.clusters) {
  assert.equal(cluster.count, new Set(cluster.memberIds).size);
  assert.equal(cluster.engineCount, cluster.memberIds.length);
}

// 2. One hundred city places.
const city = seeded(100, 100);
assert.equal(frame({
  source: city,
  region: { latitude: 34, longitude: -118, latitudeDelta: 1, longitudeDelta: 1.2 },
}).ledger.ok, true);

// 3-4. Explicit zoom/pan matrix, forward and reverse.
const centers = [
  ['San Diego', 32.7157, -117.1611],
  ['Southern California', 34.0, -118.0],
  ['California', 37.2, -119.7],
  ['USA', 39.5, -98.35],
  ['Continental', 36.75, -98.5],
] as const;
const matrixPlaces = [
  saved('sd', 32.7157, -117.1611), saved('la', 34.0522, -118.2437),
  saved('sf', 37.7749, -122.4194), saved('denver', 39.7392, -104.9903),
  saved('chicago', 41.8781, -87.6298), saved('ny', 40.7128, -74.0060),
];
let viewport: MapViewportSnapshot | null = null;
let cameraRevision = 0;
let cameraLoops = 0;
for (const direction of [centers, [...centers].reverse()]) {
  for (let index = 0; index < direction.length; index += 1) {
    cameraRevision += 1;
    const [, latitude, longitude] = direction[index]!;
    const zoom = [3, 5, 8, 12, 16][index]!;
    const region = clusterExpansionRegion({ latitude, longitude, zoom, viewportWidth: WIDTH, viewportHeight: HEIGHT });
    viewport = nextMapViewportSnapshot({ previous: viewport, region, cameraRevision, source: 'region_change' });
    const rendered = frame({ source: matrixPlaces, region, cameraRevision, snapshot: viewport });
    assert.equal(rendered.ledger.ok, true);
    assert.equal(rendered.ledger.missing_ids.length, 0);
    if (viewport.cameraRevision !== cameraRevision) cameraLoops += 1;
  }
}
assert.equal(cameraLoops, 0);

// Missing completion cannot preserve an old query: onRegionChange owns a new snapshot.
const oldRegion = { latitude: 32.7157, longitude: -117.1611, latitudeDelta: 0.12, longitudeDelta: 0.12 };
viewport = nextMapViewportSnapshot({ previous: null, region: oldRegion, cameraRevision: 1, source: 'region_change_complete' });
const broadRegion = { latitude: 36.75, longitude: -98.5, latitudeDelta: 24, longitudeDelta: 62 };
viewport = nextMapViewportSnapshot({ previous: viewport, region: broadRegion, cameraRevision: 2, source: 'region_change' });
assert.equal(isClusterQuerySynchronized(2, viewport), true);
assert.equal(frame({ source: matrixPlaces, region: viewport.region, cameraRevision: 2, snapshot: viewport }).ledger.missing_ids.length, 0);

// Programmatic movement is explicitly unsynchronized before its first native sample.
assert.equal(isClusterQuerySynchronized(3, viewport), false);

// Completion callbacks carry no command token. A programmatic completion is
// reconciled from native boundaries, and an older non-gesture completion may
// not overwrite a newer gesture transition.
const programmaticTransition = nextCameraTransition(2, 'programmatic');
assert.equal(shouldCommitRegionCompletion({
  transition: programmaticTransition,
  detailsIsGesture: false,
  completionRegion: oldRegion,
  latestObservedRegion: broadRegion,
}), false);
const interruptedByGesture = nextCameraTransition(programmaticTransition.revision, 'gesture');
assert.equal(shouldCommitRegionCompletion({
  transition: interruptedByGesture,
  detailsIsGesture: false,
  completionRegion: oldRegion,
  latestObservedRegion: broadRegion,
}), false, 'an old programmatic completion cannot win after a pinch');
assert.equal(shouldCommitRegionCompletion({
  transition: interruptedByGesture,
  detailsIsGesture: true,
  completionRegion: broadRegion,
  latestObservedRegion: broadRegion,
}), true, 'the current gesture completion can settle');
assert.equal(shouldCommitRegionCompletion({
  transition: interruptedByGesture,
  completionRegion: oldRegion,
  latestObservedRegion: broadRegion,
}), false, 'Apple Maps fallback rejects a completion that disagrees with its latest sample');

// Native foreground readback, including antimeridian boundaries.
const readback = regionFromMapBoundaries({
  northEast: { latitude: 20, longitude: -175 },
  southWest: { latitude: -20, longitude: 175 },
});
assert.ok(readback);
assert.equal(readback!.longitudeDelta, 10);
assert.ok(Math.abs(Math.abs(readback!.longitude) - 180) < 1e-9);

// 5. Filter -> All restores exactly the canonical eligible set.
for (const filter of ['food_drink', 'stays', 'outdoors', 'things_to_do', 'shopping', 'fitness_wellness', 'other']) {
  const filtered = frame({ source: city, filter, region: continentalRegion });
  assert.equal(filtered.ledger.missing_ids.length, 0);
  assert.equal(filtered.ledger.filtered_ids.length + filtered.ledger.eligible_count, city.length);
}
assert.equal(frame({ source: city, filter: MAP_FILTER_ALL, region: continentalRegion }).ledger.eligible_count, city.length);

// 6. Selection is projection only; source and eligible identities remain stable.
const selected = frame({ source: city, selectedId: city[0]!.id, region: continentalRegion });
assert.equal(selected.ledger.source_count, city.length);
assert.equal(selected.ledger.eligible_count, city.length);
assert.equal(selected.ledger.duplicate_ids.length, 0);

// 7-9. Save/delete, stale fetch race, background/foreground preserve ownership.
let mutated = [...city];
mutated = [saved('new-save', 34, -118), ...mutated];
assert.equal(frame({ source: mutated, region: continentalRegion }).ledger.missing_ids.length, 0);
mutated = mutated.filter((place) => place.id !== 'new-save');
assert.equal(frame({ source: mutated, region: continentalRegion }).ledger.source_count, city.length);
assert.equal(shouldCommitSavedPlacesFetch(8, 9), false);
assert.equal(shouldCommitSavedPlacesFetch(9, 9), true);
viewport = nextMapViewportSnapshot({ previous: viewport, region: continentalRegion, cameraRevision: 4, source: 'native_readback' });
assert.equal(frame({ source: city, region: continentalRegion, cameraRevision: 4, snapshot: viewport }).ledger.ok, true);

// 10. Explicit Supercluster bypass renders every canonical eligible marker.
const bypass = frame({ source: city, region: continentalRegion, clustering: false });
assert.equal(bypass.clusters.length, 0);
assert.equal(bypass.individuals.length, city.length);
assert.equal(bypass.ledger.cluster_input_count, 0);
assert.equal(bypass.ledger.missing_ids.length, 0);

// 11-12. Corrupt output is detected, then bounded raw/aggregate fallback conserves access.
const corrupt = buildMapConservationLedger({
  datasetRevision: 1, datasetKey: 'corrupt', cameraRevision: 0, viewportRevision: 1,
  zoom: 5, bounds: continentalRegion, filterState: 'all', selectedPlaceId: null,
  clusteringEnabled: true, querySynchronized: true, sourcePlaces: city,
  eligiblePlaces: city, clusterInputIds: city.map((place) => place.id),
  individualIds: city.slice(0, 3).map((place) => place.id), clusters: [],
});
assert.equal(corrupt.missing_ids.length, 97);
const rawFallbackIds = represented([], city);
assert.equal(rawFallbackIds.size, city.length);
const large = seeded(SAFE_RAW_MARKER_LIMIT + 1, 501);
const aggregate = buildConservationFallbackCluster({ places: large, datasetKey: 'large', zoom: 5 });
assert.ok(aggregate);
assert.equal(aggregate!.count, large.length);
assert.equal(new Set(aggregate!.memberIds).size, large.length);
assert.equal(1, 1, 'large fallback mounts one native marker model');
const boundedBypassLedger = buildMapConservationLedger({
  datasetRevision: 1, datasetKey: 'large', cameraRevision: 9, viewportRevision: 0,
  zoom: 5, bounds: continentalRegion, filterState: 'all', selectedPlaceId: null,
  clusteringEnabled: false, querySynchronized: false, sourcePlaces: large,
  eligiblePlaces: large, clusterInputIds: [], individualIds: [], clusters: [aggregate!],
});
assert.equal(boundedBypassLedger.ok, true);
assert.equal(boundedBypassLedger.missing_ids.length, 0);

// Required conservation scale matrix. Each dataset is built once and queried
// from the current viewport; the existing index object is reused for a camera
// move, while a coordinate mutation produces a new dataset identity.
for (const count of [20, 100, 500, 1_000, 5_000, 10_000]) {
  const places = seeded(count, 70_000 + count);
  const rendered = frame({ source: places, region: continentalRegion });
  assert.equal(rendered.ledger.missing_ids.length, 0, `${count} points missing`);
  assert.equal(rendered.ledger.duplicate_ids.length, 0, `${count} points duplicated`);
  assert.equal(rendered.ledger.invalid_cluster_ids.length, 0, `${count} invalid clusters`);
  assert.equal(rendered.ledger.represented_in_viewport_count, count, `${count} represented`);
}

const revisionFixture = seeded(100, 9001);
const stableIndex = buildMapClusterIndex(revisionFixture);
const stableEngine = stableIndex.index;
queryMapClusters(stableIndex, { region: continentalRegion, zoom: 6, viewportWidth: WIDTH });
queryMapClusters(stableIndex, {
  region: { ...continentalRegion, longitude: continentalRegion.longitude + 0.2 },
  zoom: 7,
  viewportWidth: WIDTH,
});
assert.equal(stableIndex.index, stableEngine, 'viewport movement reuses the built index');
const movedFixture = revisionFixture.map((place, index) => index === 0
  ? saved(place.id, place.place.latitude + 0.01, place.place.longitude)
  : place);
const rebuiltIndex = buildMapClusterIndex(movedFixture);
assert.notEqual(rebuiltIndex.datasetKey, stableIndex.datasetKey, 'coordinate update rebuilds dataset identity');

const laidOut = nextMapViewportSnapshot({
  previous: null,
  region: continentalRegion,
  cameraRevision: 1,
  source: 'layout',
  width: 390,
  height: 760,
  updatedAt: 123,
});
assert.equal(laidOut.width, 390);
assert.equal(laidOut.height, 760);
assert.equal(laidOut.updatedAt, 123);
assert.deepEqual(laidOut.bbox, [-120, 32.5, -116, 35.5]);
assert.ok(Number.isFinite(laidOut.zoom));
assert.throws(() => nextMapViewportSnapshot({
  previous: null,
  region: { latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0 },
  cameraRevision: 0,
  source: 'initial',
}), /map_viewport_invalid_initial_region/);

// 13-15. Viewport edge, antimeridian, and zero/stale dimensions.
const edge = [saved('west-edge', 34, -119.99), saved('east-edge', 34, -116.01)];
assert.equal(frame({ source: edge, region: continentalRegion }).ledger.missing_ids.length, 0);
const dateLinePlaces = [saved('east-date-line', 10, 179), saved('west-date-line', 10, -179)];
const dateLineRegion = { latitude: 10, longitude: 180, latitudeDelta: 10, longitudeDelta: 10 };
assert.equal(frame({ source: dateLinePlaces, region: dateLineRegion }).ledger.missing_ids.length, 0);
for (const width of [0, 1, 320, 390, 768]) {
  const safeWidth = width > 0 ? width : 256;
  assert.ok(Number.isFinite(zoomFor(continentalRegion, safeWidth)));
  assert.equal(frame({ source: city, region: continentalRegion, width: safeWidth }).ledger.missing_ids.length, 0);
}

// 16. Repeated callbacks advance viewport revisions without issuing camera commands.
let repeated: MapViewportSnapshot | null = null;
for (let index = 0; index < 100; index += 1) {
  repeated = nextMapViewportSnapshot({ previous: repeated, region: continentalRegion, cameraRevision: 1, source: 'region_change' });
}
assert.equal(repeated!.viewportRevision, 100);
assert.equal(repeated!.cameraRevision, 1);

// 1,000 seeded camera/data operations.
const random = lcg(20260825);
let stressPlaces = seeded(180, 180);
let stressFilter: MapVisibilityFilter = 'all';
let stressSelected: string | null = null;
let stressRegion: ClusterRegion = { latitude: 34, longitude: -118, latitudeDelta: 1, longitudeDelta: 1.2 };
let missing = 0;
let duplicates = 0;
let invalidMembers = 0;
let silentTaps = 0;
let unboundedRenders = 0;
for (let operation = 0; operation < 1_000; operation += 1) {
  const choice = Math.floor(random() * 8);
  if (choice === 0) stressRegion = { ...stressRegion, longitude: stressRegion.longitude + (random() - 0.5) * 0.2 };
  if (choice === 1) {
    const scale = random() > 0.5 ? 1.7 : 0.6;
    stressRegion = {
      ...stressRegion,
      latitudeDelta: Math.max(0.01, Math.min(20, stressRegion.latitudeDelta * scale)),
      longitudeDelta: Math.max(0.012, Math.min(25, stressRegion.longitudeDelta * scale)),
    };
  }
  if (choice === 2) stressFilter = ['all', 'food_drink', 'outdoors', 'shopping'][Math.floor(random() * 4)]!;
  if (choice === 3) stressSelected = stressPlaces[Math.floor(random() * stressPlaces.length)]?.id ?? null;
  if (choice === 4) stressSelected = null;
  if (choice === 5) stressPlaces = [saved(`stress-save-${operation}`, 34 + random() * 0.2, -118 + random() * 0.2), ...stressPlaces];
  if (choice === 6 && stressPlaces.length > 50) stressPlaces.splice(Math.floor(random() * stressPlaces.length), 1);
  const rendered = frame({ source: stressPlaces, filter: stressFilter, selectedId: stressSelected, region: stressRegion });
  missing += rendered.ledger.missing_ids.length;
  duplicates += rendered.ledger.duplicate_ids.length;
  invalidMembers += rendered.ledger.invalid_cluster_ids.length;
  const markerModels = rendered.clusters.length + rendered.individuals.length;
  if (markerModels > stressPlaces.length) unboundedRenders += 1;
  const tapped = rendered.clusters[0];
  if (tapped && tapped.memberIds.length === 0) silentTaps += 1;
}
assert.equal(missing, 0);
assert.equal(duplicates, 0);
assert.equal(invalidMembers, 0);
assert.equal(silentTaps, 0);
assert.equal(unboundedRenders, 0);

// JS benchmark. Native memory/frame responsiveness remains a physical QA gate.
function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]!;
}
const rows: string[] = [];
for (const count of [20, 100, 250, 500, 1_000, 2_000, 5_000, 10_000]) {
  const places = seeded(count, count);
  const builds: number[] = [];
  const queries: number[] = [];
  const rawPrep: number[] = [];
  let index = buildMapClusterIndex(places);
  for (let pass = 0; pass < 5; pass += 1) {
    let start = performance.now();
    index = buildMapClusterIndex(places);
    builds.push(performance.now() - start);
    start = performance.now();
    queryMapClusters(index, { region: continentalRegion, zoom: zoomFor(continentalRegion), viewportWidth: WIDTH });
    queries.push(performance.now() - start);
    start = performance.now();
    places.map((place) => ({ key: place.id, latitude: place.place.latitude, longitude: place.place.longitude }));
    rawPrep.push(performance.now() - start);
  }
  rows.push(`${count}: cluster index p95=${percentile(builds, 0.95).toFixed(2)}ms query p95=${percentile(queries, 0.95).toFixed(2)}ms raw-prep p95=${percentile(rawPrep, 0.95).toFixed(2)}ms raw-models=${count}`);
}

const tuningRandom = lcg(56_403_224);
const tuningPlaces = Array.from({ length: 1_000 }, (_, index) => saved(
  `tuning-${index}`,
  34 + (tuningRandom() - 0.5) * 0.04,
  -118 + (tuningRandom() - 0.5) * 0.05,
));
const tuningRows: string[] = [];
for (const radiusPx of [56, 40, 32, 24]) {
  const built = buildMapClusterIndex(tuningPlaces, { radiusPx });
  const representations = [11, 13, 15, 16].map((zoom) => {
    const region = clusterExpansionRegion({
      latitude: 34,
      longitude: -118,
      zoom,
      viewportWidth: WIDTH,
      viewportHeight: HEIGHT,
    });
    return `${zoom}:${queryMapClusters(built, { region, zoom, viewportWidth: WIDTH }).length}`;
  });
  tuningRows.push(`radius=${radiusPx}px representations(z:nodes) ${representations.join(' ')}`);
}

// Source wiring: both continuous and complete callbacks, a silent-command
// readback watchdog, stable React keys, bypass flag, and developer diagnostics
// must stay present.
const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
assert.match(mapSource, /onRegionChange=\{handleRegionChange\}/);
assert.match(mapSource, /onRegionChangeComplete=\{handleRegionChangeComplete\}/);
assert.match(mapSource, /getMapBoundaries\(\)/);
assert.match(mapSource, /cameraReadbackTimerRef\.current = setTimeout/);
assert.match(mapSource, /cameraRevisionRef\.current === transition\.revision/);
assert.match(mapSource, /key=\{cluster\.id\}/);
assert.match(mapSource, /key=\{p\.id\}/);
assert.match(mapSource, /isMapClusteringEnabled\(\)/);
assert.match(mapSource, /mapDiagnostics/);

console.log('CAMERA MATRIX: PASS');
console.log('FILTER / ALL: PASS');
console.log('SELECTION / MUTATION / STALE FETCH / FOREGROUND: PASS');
console.log('CLUSTERING BYPASS: PASS');
console.log(`STRESS operations=1000 missing=${missing} duplicates=${duplicates} invalid_members=${invalidMembers} silent_taps=${silentTaps} camera_loops=${cameraLoops} unbounded_renders=${unboundedRenders}`);
for (const row of rows) console.log(`BENCH ${row}`);
for (const row of tuningRows) console.log(`TUNING ${row}`);
console.log(`SAFE RAW MARKER LIMIT: ${SAFE_RAW_MARKER_LIMIT}`);
console.log('MAP CONSERVATION TESTS PASSED');
