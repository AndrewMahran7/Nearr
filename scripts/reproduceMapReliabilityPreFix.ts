import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  buildMapClusterIndex,
  regionToClusterBbox,
  type ClusterRegion,
} from '../lib/mapClustering';
import type { SavedPlaceWithPlace } from '../types';

type FixturePlace = SavedPlaceWithPlace;

function place(id: string, latitude: number, longitude: number, name = id): FixturePlace {
  return {
    id,
    category: null,
    place: {
      id: `place-${id}`,
      name,
      latitude,
      longitude,
      category: null,
      google_primary_type: null,
      google_types: null,
    },
  } as FixturePlace;
}

/** Frozen query ownership from production source 7fc845d. */
function legacyRepresentedIds(
  index: ReturnType<typeof buildMapClusterIndex<FixturePlace>>,
  region: ClusterRegion,
  zoom: number,
): Set<string> {
  const ids = new Set<string>();
  if (!index.index) return ids;
  const features = index.index.getClusters(regionToClusterBbox(region, 0.15), zoom);
  if (features.length === 0) return new Set(index.byId.keys());
  for (const feature of features) {
    const properties = feature.properties as { cluster?: boolean; cluster_id?: number; savedPlaceId?: string };
    if (!properties.cluster) {
      if (properties.savedPlaceId) ids.add(properties.savedPlaceId);
      continue;
    }
    index.index.getLeaves(Number(properties.cluster_id), Infinity).forEach((leaf) => {
      const id = String((leaf.properties as { savedPlaceId?: string }).savedPlaceId ?? '');
      if (id) ids.add(id);
    });
  }
  return ids;
}

// Frozen production geometry: fixed 15% bbox padding is only 48 screen points
// on a 320-point viewport, less than the 56-point cluster radius. A dense group
// just outside the left edge can pull its cluster center beyond the query bbox
// while one canonical member remains inside the actual viewport. A center pin
// keeps the result non-empty, bypassing the old "return every marker" fallback.
const viewportWidth = 320;
const zoom = 10;
const longitudeDelta = (360 * viewportWidth) / (256 * 2 ** zoom);
const region: ClusterRegion = {
  latitude: 0,
  longitude: 0,
  latitudeDelta: longitudeDelta,
  longitudeDelta,
};
const degreesPerPoint = longitudeDelta / viewportWidth;
const west = -longitudeDelta / 2;
const edgePlaces = [
  place('inside-edge', 0, west + degreesPerPoint * 0.1),
  ...Array.from({ length: 20 }, (_, i) =>
    place(`outside-${i}`, 0, west - degreesPerPoint * 55),
  ),
  place('center-control', 0, 0),
];
const edgeIndex = buildMapClusterIndex(edgePlaces);
const edgeRepresented = legacyRepresentedIds(edgeIndex, region, zoom);
const pinDisappearReproduced = !edgeRepresented.has('inside-edge');
assert.equal(pinDisappearReproduced, true);

// Frozen canonicalization rule from savedPlacesService.ts: substring-equal
// normalized names within 40 m are treated as the same logical place even
// when provider ids and addresses differ.
function legacySameNormalizedName(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const a = normalize(left);
  const b = normalize(right);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}
const incorrectGroupingReproduced =
  legacySameNormalizedName('Waimea Bay Beach Park', 'Waimea Bay Beach') && 30 <= 40;
assert.equal(incorrectGroupingReproduced, true);

// Frozen stale-tap behavior: when the native marker id is no longer present,
// the old resolver accepts the nearest current cluster with no distance or
// member-overlap bound, even if it belongs to a different continent/dataset.
function legacyResolveLatest<T extends { clusterId: number; latitude: number; longitude: number }>(
  tapped: { clusterId: number; latitude: number; longitude: number },
  current: readonly T[],
): T | null {
  const exact = current.find((candidate) => candidate.clusterId === tapped.clusterId);
  if (exact) return exact;
  return [...current].sort((left, right) =>
    ((left.latitude - tapped.latitude) ** 2 + (left.longitude - tapped.longitude) ** 2) -
    ((right.latitude - tapped.latitude) ** 2 + (right.longitude - tapped.longitude) ** 2),
  )[0] ?? null;
}
const staleTapResolution = legacyResolveLatest(
  { clusterId: 999, latitude: 34, longitude: -118 },
  [{ clusterId: 1, latitude: 40.7, longitude: -74, name: 'unrelated' }],
);
const staleTapMisrouteReproduced = staleTapResolution?.name === 'unrelated';
assert.equal(staleTapMisrouteReproduced, true);

// Frozen empty-viewport behavior: a legitimate zero-feature query returns the
// entire dataset as individual native markers. At 10k this is a synchronous
// marker-mount explosion and a credible tap/region freeze mechanism.
const large = Array.from({ length: 10_000 }, (_, i) =>
  place(`large-${i}`, 35 + (i % 100) * 0.00001, -120 + Math.floor(i / 100) * 0.00001),
);
const started = performance.now();
const largeIndex = buildMapClusterIndex(large);
const emptyIds = legacyRepresentedIds(
  largeIndex,
  { latitude: -35, longitude: 120, latitudeDelta: 0.01, longitudeDelta: 0.01 },
  16,
);
const elapsedMs = performance.now() - started;
const freezeRiskReproduced = emptyIds.size === large.length;
assert.equal(freezeRiskReproduced, true);

console.log('PRE-FIX PIN DISAPPEAR REPRODUCED:', pinDisappearReproduced ? 'YES' : 'NO');
console.log('PRE-FIX INCORRECT GROUPING REPRODUCED:', incorrectGroupingReproduced ? 'YES' : 'NO');
console.log('PRE-FIX CLUSTER TAP NO-OP REPRODUCED: NO');
console.log('PRE-FIX STALE CLUSTER TAP MISROUTE REPRODUCED:', staleTapMisrouteReproduced ? 'YES' : 'NO');
console.log('PRE-FIX FREEZE / MARKER EXPLOSION REPRODUCED:', freezeRiskReproduced ? 'YES' : 'NO');
console.log(`PRE-FIX 10K EMPTY-VIEW BUILD+QUERY: ${elapsedMs.toFixed(2)}ms; ${emptyIds.size} native marker models`);
