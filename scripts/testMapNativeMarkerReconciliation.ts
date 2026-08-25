import assert from 'node:assert/strict';

import {
  buildMapClusterIndex,
  clusterWithoutSelectedMember,
  queryMapClusters,
  type ClusterRegion,
  type MapClusterMarker,
} from '../lib/mapClustering';
import type { SavedPlaceWithPlace } from '../types';

type NativeDescriptor = {
  key: string;
  logicalKey: string;
  count: number;
};

function saved(id: string, latitude: number, longitude: number): SavedPlaceWithPlace {
  return {
    id,
    category: 'restaurant',
    place: {
      id: `place-${id}`,
      google_place_id: `google-${id}`,
      name: id,
      formatted_address: `${id} Test Street`,
      latitude,
      longitude,
      category: 'restaurant',
    },
  } as SavedPlaceWithPlace;
}

function descriptor(cluster: MapClusterMarker): NativeDescriptor {
  return { key: cluster.id, logicalKey: cluster.clusterKey, count: cluster.count };
}

/**
 * Minimal native snapshot-cache model. Reusing one native key for another
 * logical marker leaves the prior bitmap/count attached to that owner. React
 * descriptor tests alone cannot observe this class of failure.
 */
function reconcileNative(
  previous: ReadonlyMap<string, NativeDescriptor>,
  next: readonly NativeDescriptor[],
): { visible: Map<string, NativeDescriptor>; staleReuse: number } {
  const visible = new Map<string, NativeDescriptor>();
  let staleReuse = 0;
  for (const item of next) {
    const prior = previous.get(item.key);
    if (prior && prior.logicalKey !== item.logicalKey) {
      staleReuse += 1;
      visible.set(item.key, prior);
    } else {
      visible.set(item.key, item);
    }
  }
  return { visible, staleReuse };
}

const region: ClusterRegion = {
  latitude: 34,
  longitude: -118,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
const zoom = 12;
const viewportWidth = 390;
const west = [
  saved('A', 34, -118.01),
  saved('B', 34.0001, -118.0101),
  saved('C', 34.0002, -118.0102),
  saved('D', 34.0003, -118.0103),
];
const east = [
  saved('E', 34, -117.98),
  saved('F', 34.0001, -117.9801),
  saved('G', 34.0002, -117.9802),
];

function clusters(places: readonly SavedPlaceWithPlace[]): MapClusterMarker[] {
  return queryMapClusters(buildMapClusterIndex(places), { region, zoom, viewportWidth })
    .filter((node): node is MapClusterMarker => node.kind === 'cluster');
}

const before = clusters([...west, ...east]);
const beforeEast = before.find((cluster) => cluster.memberIds.includes('E'))!;
const beforeWest = before.find((cluster) => cluster.memberIds.includes('A'))!;
assert.ok(beforeEast && beforeWest, 'fixture starts with two independent clusters');

const after = clusters([saved('N', 34.0004, -118.0104), ...west, ...east]);
const afterEast = after.find((cluster) => cluster.memberIds.includes('E'))!;
assert.deepEqual(afterEast.memberIds, beforeEast.memberIds);
assert.equal(
  afterEast.id,
  beforeEast.id,
  'Failure A: an unrelated save must not remount an unchanged logical cluster',
);

const projected = clusterWithoutSelectedMember(beforeWest, 'A', zoom).cluster!;
assert.equal(projected.count, 3, 'founder projection is the observed count-3 cluster');
assert.notEqual(
  projected.id,
  beforeWest.id,
  'Failure B: a projected remainder must not reuse the canonical cluster native key',
);

// Replay the reverted 0637226 strategy exactly: it forced the projected B/C/D
// descriptor to keep the A/B/C/D native id. A subsequent ordinary render of
// A/B/C/D reused that owner for a different logical marker and retained 3.
const revertedBadProjection = { ...projected, id: beforeWest.id };
const badR1 = new Map([[revertedBadProjection.id, descriptor(revertedBadProjection)]]);
const badR2 = reconcileNative(badR1, [descriptor(beforeWest)]);
assert.equal(badR2.staleReuse, 1, '0637226 replay reproduces stale native-key reuse');
assert.equal(badR2.visible.get(beforeWest.id)?.count, 3, '0637226 replay persists count 3');

const correctR1 = new Map([[projected.id, descriptor(projected)]]);
const correctR2 = reconcileNative(correctR1, [descriptor(beforeWest)]);
assert.equal(correctR2.staleReuse, 0);
assert.equal(correctR2.visible.get(beforeWest.id)?.count, 4);

console.log(
  'PASS native marker reconciliation: unchanged logical markers update in place; changed membership remounts; reverted count-3 key reuse is permanently detected',
);
