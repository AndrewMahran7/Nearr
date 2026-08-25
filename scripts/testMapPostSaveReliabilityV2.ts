import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  buildMapClusterIndex,
  clusterWithoutSelectedMember,
  queryMapClusters,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { inspectMarkerConservation } from '../lib/mapReliability';
import { resolveLatestClusterMarker } from '../lib/mapClusterExpansion';
import { shouldCommitSavedPlacesFetch } from '../lib/savedPlacesDatasetVersion';
import type { SavedPlaceWithPlace } from '../types';

function saved(id: string, latitude: number, longitude: number, category = 'restaurant'): SavedPlaceWithPlace {
  return {
    id,
    category,
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: id,
      formatted_address: `${id} Test Street`,
      latitude,
      longitude,
      category,
    },
  } as SavedPlaceWithPlace;
}

const region: ClusterRegion = {
  latitude: 34,
  longitude: -118,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};
const focusedRegion: ClusterRegion = {
  latitude: 34,
  longitude: -118.02,
  latitudeDelta: 0.008,
  longitudeDelta: 0.008,
};
const zoom = 11;
const viewportWidth = 390;

function frame(
  places: readonly SavedPlaceWithPlace[],
  selectedId: string | null,
  view = region,
  frameZoom = zoom,
) {
  const index = buildMapClusterIndex(places);
  const nodes = queryMapClusters(index, { region: view, zoom: frameZoom, viewportWidth });
  const looseIds = new Set(nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []));
  const projectedLoose = new Set<string>();
  const clusters = nodes.flatMap((node) => {
    if (node.kind !== 'cluster') return [];
    const result = clusterWithoutSelectedMember(node, selectedId, frameZoom);
    if (result.looseMemberId) projectedLoose.add(result.looseMemberId);
    return result.cluster ? [result.cluster] : [];
  });
  const individuals = places.filter((place) =>
    place.id === selectedId || looseIds.has(place.id) || projectedLoose.has(place.id),
  );
  const report = inspectMarkerConservation({
    eligiblePlaces: places,
    individualIds: individuals.map((place) => place.id),
    clusters,
    region: view,
  });
  return { index, clusters, individuals, report };
}

const initial = [
  saved('A', 34, -118.02),
  saved('B', 34.0001, -118.0201),
  saved('C', 34.0002, -118.0202, 'park'),
  saved('D', 34.025, -118.045, 'park'),
  saved('E', 34.01, -117.97, 'museum'),
  saved('F', 33.98, -117.98, 'shopping'),
];
const recommendation = saved('N', 34.0004, -118.0204, 'museum');

const before = frame(initial, 'A');
const afterPlaces = [recommendation, ...initial];
const after = frame(afterPlaces, recommendation.id);
for (const [name, current] of [['before', before], ['after', after]] as const) {
  assert.equal(current.report.missingOnscreenIds.length, 0, `${name}: missing ids`);
  assert.equal(current.report.duplicateIds.length, 0, `${name}: duplicate ids`);
  console.log(
    `STAGE ${name} eligible=${current.report.eligibleIds.length} individual=${current.report.individualIds.length} ` +
    `cluster_members=${current.report.clusterMemberIds.length} represented_unique=${new Set([
      ...current.report.individualIds,
      ...current.report.clusterMemberIds,
    ]).size} missing=${current.report.missingOnscreenIds.length} duplicates=${current.report.duplicateIds.length}`,
  );
}

// Failure A: the generic select path focuses one zone. The focused viewport
// has only the local projected count-3 cluster while unrelated places become
// offscreen, exactly matching the founder-visible transition.
const focused = frame(afterPlaces, recommendation.id, focusedRegion);
const countThree = focused.clusters.find((cluster) => cluster.count === 3);
assert.ok(countThree, 'Failure A fixture reproduces the projected count-3 cluster');
assert.ok(focused.report.offscreenIds.length > 0, 'Failure A fixture reproduces unrelated pin loss from camera focus');

const canonicalCluster = queryMapClusters(after.index, { region, zoom, viewportWidth })
  .find((node): node is MapClusterMarker => node.kind === 'cluster' && node.memberIds.includes('N'))!;
assert.ok(canonicalCluster);
assert.ok(
  'canonicalMemberIds' in countThree!,
  'projected tap descriptor must preserve canonical index membership',
);

const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
assert.match(
  mapSource,
  /filterEligiblePlaces\.filter\(\(place\) => !alwaysIndividualIds\.has\(place\.id\)\)/,
  'selection is an overlay and never redefines the canonical clustered dataset',
);
assert.doesNotMatch(
  mapSource,
  /visiblePlaces\.filter\(\(place\) => !alwaysIndividualIds\.has\(place\.id\)\)/,
  'selected-place visibility must not feed back into index ownership',
);
const saveStart = mapSource.indexOf('const handleSavePlaceCandidate = useCallback');
const saveEnd = mapSource.indexOf('const handleUndoSave = useCallback', saveStart);
const saveFlow = mapSource.slice(saveStart, saveEnd);
assert.match(saveFlow, /upsertSavedPlaceIntoCache\(result\.saved\)/, 'save enters shared revision owner');
assert.ok(
  saveFlow.indexOf('upsertSavedPlaceIntoCache(result.saved)') < saveFlow.indexOf('await refresh()'),
  'cache mutation owns the dataset before refetch',
);
assert.match(
  saveFlow,
  /focusCamera:\s*flow\s*===\s*['"]map_search['"]/, 
  'recommendation save preserves the current map camera',
);
assert.equal(shouldCommitSavedPlacesFetch(20, 21), false, 'older fetch cannot replace the saved dataset');

type RenderDescriptor = { id: string; logicalKey: string };
let seed = 0x5eed1234;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
}

let stressPlaces = [...afterPlaces];
let selectedId: string | null = null;
let activeCategory: string | null = null;
let stressRegion = { ...region };
let stressZoom = zoom;
let previousDescriptors = new Map<string, RenderDescriptor>();
let markerLoss = 0;
let duplicates = 0;
let invalidMembership = 0;
let staleNativeDescriptorReuse = 0;
let deadClusterTaps = 0;
let wrongClusterFallback = 0;
let cameraLoops = 0;
let renders = 0;
let nextId = 0;

for (let operation = 0; operation < 500; operation += 1) {
  switch (operation % 10) {
    case 0: { // recommendation save
      const id = `S-${nextId++}`;
      stressPlaces = [saved(
        id,
        34 + (random() - 0.5) * 0.07,
        -118 + (random() - 0.5) * 0.07,
        operation % 3 === 0 ? 'park' : 'restaurant',
      ), ...stressPlaces];
      selectedId = id;
      assert.equal(shouldCommitSavedPlacesFetch(operation, operation + 1), false);
      break;
    }
    case 1: // delete
      if (stressPlaces.length > 18) {
        const index = Math.floor(random() * stressPlaces.length);
        const removed = stressPlaces[index]!.id;
        stressPlaces = stressPlaces.filter((place) => place.id !== removed);
        if (selectedId === removed) selectedId = null;
      }
      break;
    case 2: // archive remains represented
      if (stressPlaces.length > 0) {
        const index = Math.floor(random() * stressPlaces.length);
        stressPlaces = stressPlaces.map((place, placeIndex) => placeIndex === index
          ? { ...place, archived_at: new Date(0).toISOString() }
          : place);
      }
      break;
    case 3: // select/detail open
      selectedId = stressPlaces[Math.floor(random() * stressPlaces.length)]?.id ?? null;
      break;
    case 4: // detail back/deselect
      selectedId = null;
      break;
    case 5: // user pan
      stressRegion = {
        ...stressRegion,
        latitude: 34 + (random() - 0.5) * 0.025,
        longitude: -118 + (random() - 0.5) * 0.025,
      };
      break;
    case 6: // zoom
      stressZoom = 10 + Math.floor(random() * 5);
      break;
    case 7: // category filter
      activeCategory = random() > 0.5 ? 'restaurant' : 'park';
      break;
    case 8: // All
      activeCategory = null;
      break;
    case 9: // background/foreground: state is retained, no camera command
      break;
  }

  const filtered = activeCategory
    ? stressPlaces.filter((place) => place.category === activeCategory)
    : stressPlaces;
  const selected = selectedId
    ? stressPlaces.find((place) => place.id === selectedId) ?? null
    : null;
  const eligible = selected && !filtered.some((place) => place.id === selected.id)
    ? [...filtered, selected]
    : filtered;
  const current = frame(eligible, selectedId, stressRegion, stressZoom);
  renders += 1;
  markerLoss += current.report.missingOnscreenIds.length;
  duplicates += current.report.duplicateIds.length;
  invalidMembership += current.report.invalidClusterIds.length;

  const descriptors = [
    ...current.clusters.map((cluster) => ({ id: cluster.id, logicalKey: cluster.clusterKey })),
    ...current.individuals.map((place) => ({ id: `place-${place.id}`, logicalKey: `place:${place.id}` })),
  ];
  for (const descriptor of descriptors) {
    const previous = previousDescriptors.get(descriptor.id);
    if (previous && previous.logicalKey !== descriptor.logicalKey) staleNativeDescriptorReuse += 1;
  }
  previousDescriptors = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  const tapped = current.clusters[0];
  if (tapped) {
    const preserved = tapped.canonicalMemberIds
      .map((id) => eligible.find((place) => place.id === id))
      .filter((place): place is SavedPlaceWithPlace => !!place);
    if (preserved.length < 2) deadClusterTaps += 1;
    if (preserved.some((place) => !tapped.canonicalMemberIds.includes(place.id))) {
      wrongClusterFallback += 1;
    }
  }
}

if (renders > 550) cameraLoops += 1;
assert.equal(markerLoss, 0);
assert.equal(duplicates, 0);
assert.equal(invalidMembership, 0);
assert.equal(staleNativeDescriptorReuse, 0);
assert.equal(deadClusterTaps, 0);
assert.equal(wrongClusterFallback, 0);
assert.equal(cameraLoops, 0);

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

for (const size of [100, 500, 1_000, 5_000, 10_000]) {
  const fixture = Array.from({ length: size }, (_, index) => saved(
    `P-${size}-${index}`,
    34 + ((index % 100) - 50) * 0.00025,
    -118 + (Math.floor(index / 100) - Math.floor(size / 200)) * 0.00025,
    index % 2 ? 'restaurant' : 'park',
  ));
  const samples = {
    build: [] as number[],
    query: [] as number[],
    descriptors: [] as number[],
    selection: [] as number[],
    tap: [] as number[],
    mutation: [] as number[],
  };
  let descriptorCount = 0;
  for (let pass = 0; pass < 7; pass += 1) {
    let started = performance.now();
    const index = buildMapClusterIndex(fixture);
    samples.build.push(performance.now() - started);

    started = performance.now();
    const nodes = queryMapClusters(index, { region, zoom, viewportWidth });
    samples.query.push(performance.now() - started);

    started = performance.now();
    const clusterDescriptors = nodes.filter(
      (node): node is MapClusterMarker => node.kind === 'cluster',
    );
    const looseDescriptors = nodes.filter((node) => node.kind === 'place');
    descriptorCount = clusterDescriptors.length + looseDescriptors.length;
    samples.descriptors.push(performance.now() - started);

    const selectedMember = clusterDescriptors[0]?.memberIds[0] ?? null;
    started = performance.now();
    const projectedDescriptors = clusterDescriptors.flatMap((cluster) => {
      const projected = clusterWithoutSelectedMember(cluster, selectedMember, zoom);
      return projected.cluster ? [projected.cluster] : [];
    });
    samples.selection.push(performance.now() - started);

    started = performance.now();
    if (projectedDescriptors[0]) {
      resolveLatestClusterMarker(projectedDescriptors[0], projectedDescriptors);
    }
    samples.tap.push(performance.now() - started);

    started = performance.now();
    const mutation = [saved(`M-${pass}`, 34, -118), ...fixture];
    void mutation.length;
    samples.mutation.push(performance.now() - started);
  }
  const metric = (values: readonly number[]) =>
    `${percentile(values, 0.5).toFixed(2)}/${percentile(values, 0.95).toFixed(2)}ms`;
  console.log(
    `PERF_V2 ${size} build=${metric(samples.build)} query=${metric(samples.query)} ` +
    `descriptors=${metric(samples.descriptors)} selection=${metric(samples.selection)} ` +
    `tap=${metric(samples.tap)} mutation=${metric(samples.mutation)} native_descriptors=${descriptorCount}`,
  );
  if (size === 10_000) {
    assert.ok(percentile(samples.build, 0.95) < 100, '10k index build stays bounded');
    assert.ok(percentile(samples.query, 0.95) < 50, '10k viewport query stays bounded');
    assert.ok(percentile(samples.selection, 0.95) < 20, 'selection projection stays bounded');
    assert.ok(descriptorCount < 1_000, '10k fixture never falls back to 10k native markers');
  }
}

console.log(
  `FAILURE_A focused_offscreen=${focused.report.offscreenIds.length} count3=${countThree?.count ?? 0}`,
);
console.log(
  `STRESS operations=500 renders=${renders} marker_loss=${markerLoss} duplicates=${duplicates} ` +
  `invalid_membership=${invalidMembership} stale_native_reuse=${staleNativeDescriptorReuse} ` +
  `dead_cluster_taps=${deadClusterTaps} wrong_fallback=${wrongClusterFallback} ` +
  `camera_loops=${cameraLoops} unbounded_renders=${renders > 550 ? 1 : 0}`,
);
console.log('PASS post-save conservation, canonical tap membership, revision ownership, and recommendation camera preservation');
