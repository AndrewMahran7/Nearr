import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMapClusterIndex,
  clusterWithoutSelectedMember,
  queryMapClusters,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { resolveLatestClusterMarker } from '../lib/mapClusterExpansion';
import { inspectMarkerConservation } from '../lib/mapReliability';
import { shouldCommitSavedPlacesFetch } from '../lib/savedPlacesDatasetVersion';
import type { SavedPlaceWithPlace } from '../types';

type Place = SavedPlaceWithPlace;
type Stage = {
  name: string;
  eligible: number;
  individual: number;
  clusterMembers: number;
  uniqueRepresented: number;
  missing: number;
  duplicates: number;
};

const region: ClusterRegion = {
  latitude: 34,
  longitude: -118,
  latitudeDelta: 0.24,
  longitudeDelta: 0.24,
};
const zoom = 10;
const viewportWidth = 390;

function saved(id: string, latitude: number, longitude: number, category = 'restaurant'): Place {
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
  } as Place;
}

function renderedFrame(places: readonly Place[], selectedId: string | null) {
  const index = buildMapClusterIndex(places);
  const nodes = queryMapClusters(index, { region, zoom, viewportWidth });
  const looseIds = new Set(nodes.flatMap((node) => node.kind === 'place' ? [node.id] : []));
  const projectedLooseIds = new Set<string>();
  const clusters = nodes.flatMap((node) => {
    if (node.kind !== 'cluster') return [];
    const projected = clusterWithoutSelectedMember(node, selectedId, zoom);
    if (projected.looseMemberId) projectedLooseIds.add(projected.looseMemberId);
    return projected.cluster ? [projected.cluster] : [];
  });
  const individuals = places.filter((place) =>
    place.id === selectedId || looseIds.has(place.id) || projectedLooseIds.has(place.id),
  );
  const report = inspectMarkerConservation({
    eligiblePlaces: places,
    individualIds: individuals.map((place) => place.id),
    clusters,
    region,
  });
  return { index, nodes, clusters, individuals, report };
}

function stage(name: string, places: readonly Place[], selectedId: string | null): Stage {
  const frame = renderedFrame(places, selectedId);
  assert.equal(frame.report.offscreenIds.length, 0, `${name}: fixture keeps every place onscreen`);
  assert.equal(frame.report.missingOnscreenIds.length, 0, `${name}: no marker loss`);
  assert.equal(frame.report.duplicateIds.length, 0, `${name}: no duplicate representation`);
  assert.equal(frame.report.invalidClusterIds.length, 0, `${name}: cluster count matches members`);
  return {
    name,
    eligible: frame.report.eligibleIds.length,
    individual: frame.report.individualIds.length,
    clusterMembers: frame.report.clusterMemberIds.length,
    uniqueRepresented: new Set([
      ...frame.report.individualIds,
      ...frame.report.clusterMemberIds,
    ]).size,
    missing: frame.report.missingOnscreenIds.length,
    duplicates: frame.report.duplicateIds.length,
  };
}

const initial = [
  saved('A', 34, -118),
  saved('B', 34.0001, -118.0001),
  saved('C', 34.0002, -118.0002, 'park'),
  saved('D', 34.0003, -118.0003, 'park'),
];
const recommendation = saved('N', 34.0004, -118.0004, 'museum');

const stages: Stage[] = [];
stages.push(stage('before_save', initial, 'A'));
const optimistic = [recommendation, ...initial];
stages.push(stage('optimistic_cache_upsert', optimistic, 'A'));

// A request that began before the optimistic save must not own the newer list.
const fetchRevision = 7;
const postSaveRevision = 8;
assert.equal(shouldCommitSavedPlacesFetch(fetchRevision, postSaveRevision), false);
stages.push(stage('stale_refetch_ignored', optimistic, 'A'));
stages.push(stage('selected_place_updated', optimistic, recommendation.id));
stages.push(stage('recommendation_modal_dismissed', optimistic, recommendation.id));
stages.push(stage('first_camera_callback', optimistic, recommendation.id));

// Adding an unrelated place may rebuild the index, but it must not remount an
// unchanged visual cluster. Selection projection also updates the same native
// marker instead of leaving a detached, tappable-looking ghost behind.
const beforeIndex = buildMapClusterIndex(initial);
const beforeCluster = queryMapClusters(beforeIndex, { region, zoom, viewportWidth })
  .find((node): node is MapClusterMarker => node.kind === 'cluster')!;
const unrelated = saved('far-but-indexed', 34.09, -117.91, 'shopping');
const afterIndex = buildMapClusterIndex([unrelated, ...initial]);
const afterCluster = queryMapClusters(afterIndex, { region, zoom, viewportWidth })
  .find((node): node is MapClusterMarker =>
    node.kind === 'cluster' && node.memberIds.includes('A'))!;
assert.deepEqual(afterCluster.memberIds, beforeCluster.memberIds);
assert.equal(afterCluster.id, beforeCluster.id, 'unrelated save preserves native cluster identity');

const projected = clusterWithoutSelectedMember(beforeCluster, 'A', zoom).cluster!;
assert.equal(projected.count, 3, 'founder fixture renders the observed cluster count 3');
assert.equal(projected.id, beforeCluster.id, 'selection projection preserves native cluster identity');
assert.equal(
  resolveLatestClusterMarker(projected, [afterCluster])?.id,
  afterCluster.id,
  'the rendered cluster 3 resolves against the current index instead of becoming dead',
);

const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
const clusterMarkerSource = readFileSync(
  join(process.cwd(), 'components/map/NearrMapClusterMarker.tsx'),
  'utf8',
);
const saveStart = mapSource.indexOf('const handleSavePlaceCandidate = useCallback');
const saveEnd = mapSource.indexOf('const handleUndoSave = useCallback', saveStart);
const saveFlow = mapSource.slice(saveStart, saveEnd);
const cacheUpsert = saveFlow.indexOf('upsertSavedPlaceIntoCache(result.saved)');
const refresh = saveFlow.indexOf('await refresh()');
assert.ok(cacheUpsert >= 0, 'map save uses the shared revision-safe cache mutation path');
assert.ok(refresh > cacheUpsert, 'optimistic cache ownership is established before refetch');
assert.match(mapSource, /currentDatasetKey: clusterIndexRef\.current\.datasetKey/);
assert.match(mapSource, /renderedDatasetKey: request\.datasetKey/);
assert.match(clusterMarkerSource, /prev\.cluster\.datasetKey === next\.cluster\.datasetKey/);
assert.match(clusterMarkerSource, /prev\.cluster\.clusterKey === next\.cluster\.clusterKey/);

let markerLoss = 0;
let duplicates = 0;
let invalidMembership = 0;
let silentClusterTaps = 0;
let cameraLoops = 0;
let unboundedRenders = 0;
let renders = 0;
let places = [...initial];

for (let operation = 0; operation < 100; operation += 1) {
  const next = saved(
    `N-${operation}`,
    34 + ((operation % 10) - 5) * 0.00015,
    -118 + (Math.floor(operation / 10) - 5) * 0.00015,
    operation % 2 ? 'restaurant' : 'park',
  );
  const startedRevision = operation * 2;
  places = [next, ...places];
  const mutationRevision = startedRevision + 1;
  assert.equal(shouldCommitSavedPlacesFetch(startedRevision, mutationRevision), false);

  try {
    const selectedFrame = renderedFrame(places, next.id);
    renders += 1;
    markerLoss += selectedFrame.report.missingOnscreenIds.length;
    duplicates += selectedFrame.report.duplicateIds.length;
    invalidMembership += selectedFrame.report.invalidClusterIds.length;

    const tapped = selectedFrame.clusters[0];
    if (tapped) {
      const currentFrame = renderedFrame(places, null);
      renders += 1;
      const resolved = resolveLatestClusterMarker(tapped, currentFrame.clusters);
      const fallbackMember = tapped.memberIds.find((id) => places.some((place) => place.id === id));
      if (!resolved && !fallbackMember) silentClusterTaps += 1;
    }

    // Category filter -> All is a pure projection; the canonical dataset returns.
    const filtered = places.filter((place) => place.category === (operation % 2 ? 'restaurant' : 'park'));
    stage(`filter_${operation}`, filtered, null);
    const all = stage(`all_${operation}`, places, null);
    assert.equal(all.eligible, places.length);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('marker loss')) markerLoss += 1;
    if (message.includes('duplicate')) duplicates += 1;
    if (message.includes('cluster count')) invalidMembership += 1;
    throw error;
  }
}

if (renders > 400) unboundedRenders += 1;
assert.equal(markerLoss, 0);
assert.equal(duplicates, 0);
assert.equal(invalidMembership, 0);
assert.equal(silentClusterTaps, 0);
assert.equal(cameraLoops, 0);
assert.equal(unboundedRenders, 0);

for (const item of stages) {
  console.log(
    `STAGE ${item.name} eligible=${item.eligible} individual=${item.individual} ` +
    `cluster_members=${item.clusterMembers} unique=${item.uniqueRepresented} ` +
    `missing=${item.missing} duplicates=${item.duplicates}`,
  );
}
console.log(
  `STRESS operations=100 renders=${renders} marker_loss=${markerLoss} duplicates=${duplicates} ` +
  `invalid_membership=${invalidMembership} silent_cluster_taps=${silentClusterTaps} ` +
  `camera_loops=${cameraLoops} unbounded_renders=${unboundedRenders}`,
);
console.log('PASS post-save conservation, revision ownership, stable cluster identity, filters, and deterministic tap fallback');
