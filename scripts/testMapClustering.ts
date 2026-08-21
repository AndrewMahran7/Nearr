/**
 * Pure regression + synthetic-scale checks for semantic map clustering.
 *
 * Everything here runs without a native map: clustering is a pure function of
 * (filtered places, camera), which is exactly why it can be pinned down this
 * cheaply. No network, no Google Places, no photos — a clustering path that
 * needed any of those would fail to run at all under ts-node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  CLUSTER_DOMINANCE_RATIO,
  CLUSTER_MAX_ZOOM,
  CLUSTER_NEUTRAL_GLYPH,
  CLUSTER_SIZE_TIERS,
  CLUSTER_ZOOM_HYSTERESIS,
  buildMapClusterIndex,
  clusterAccessibilityLabel,
  clusterExpansionRegion,
  clusterExpansionZoom,
  clusterGlyphForGroup,
  clusterGroupCounts,
  clusterSizing,
  clusterTapZoom,
  dominantClusterGroup,
  nextClusterZoom,
  queryMapClusters,
  regionToClusterBbox,
  regionToClusterZoom,
  type MapClusterMarker,
} from '../lib/mapClustering';
import { filterPlacesForMap, mapFilterGroupForPlace } from '../lib/mapVisibility';
import { CATEGORY_BROWSE_SECTIONS } from '../lib/placeCategory';
import type { SavedPlaceWithPlace } from '../types';

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 700;

function saved(
  category: string,
  latitude: number,
  longitude: number,
  id = `${category}-${latitude}-${longitude}`,
): SavedPlaceWithPlace {
  return {
    id,
    category,
    archived_at: null,
    visited_at: null,
    notifications_enabled: true,
    place: {
      id: `place-${id}`,
      name: `${category} @ ${latitude},${longitude}`,
      category,
      latitude,
      longitude,
    },
  } as unknown as SavedPlaceWithPlace;
}

/** A region wide enough that everything within a few km collapses. */
function wideRegion(latitude = 33.75, longitude = -117.85) {
  return { latitude, longitude, latitudeDelta: 1.2, longitudeDelta: 1.2 };
}

function tightRegion(latitude = 33.75, longitude = -117.85) {
  return { latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 };
}

function zoomFor(region: { longitudeDelta: number }) {
  return Math.round(
    regionToClusterZoom({
      longitudeDelta: region.longitudeDelta,
      viewportWidth: VIEWPORT_WIDTH,
    }),
  );
}

function clustersOf<T extends { id: string }>(
  nodes: readonly ({ kind: 'cluster' } & MapClusterMarker | { kind: 'place'; id: string; place: T })[],
): MapClusterMarker[] {
  return nodes.filter((node): node is MapClusterMarker & { kind: 'cluster' } => node.kind === 'cluster');
}

function placesOf<T extends { id: string }>(
  nodes: readonly ({ kind: 'cluster' } & MapClusterMarker | { kind: 'place'; id: string; place: T })[],
): string[] {
  return nodes.filter((node) => node.kind === 'place').map((node) => node.id);
}

// ---------------------------------------------------------------------------
// 1. Size tiers are bounded
// ---------------------------------------------------------------------------

assert.equal(clusterSizing(2).tier, 1);
assert.equal(clusterSizing(3).tier, 1);
assert.equal(clusterSizing(4).tier, 2);
assert.equal(clusterSizing(9).tier, 2);
assert.equal(clusterSizing(10).tier, 3);
assert.equal(clusterSizing(24).tier, 3);
assert.equal(clusterSizing(25).tier, 4);
assert.equal(clusterSizing(500).tier, 4);
assert.deepEqual(clusterSizing(500), clusterSizing(25), 'size saturates at the top tier');

const NORMAL_LOCAL_PIN_DIAMETER = 32;
const largest = Math.max(...CLUSTER_SIZE_TIERS.map((tier) => tier.diameter));
assert.ok(
  largest <= NORMAL_LOCAL_PIN_DIAMETER * 2,
  `largest cluster (${largest}px) stays under 2x a normal pin — count conveys magnitude, not diameter`,
);
for (let i = 1; i < CLUSTER_SIZE_TIERS.length; i += 1) {
  assert.ok(
    CLUSTER_SIZE_TIERS[i - 1]!.diameter > CLUSTER_SIZE_TIERS[i]!.diameter,
    'size tiers are strictly ordered',
  );
}

// ---------------------------------------------------------------------------
// 2. Dominant category policy
// ---------------------------------------------------------------------------

// The ticket's worked example: 4 Food, 2 Outdoors, 1 Other -> 4/7 = 57% -> Food.
const dominantFood = dominantClusterGroup(
  { food_drink: 4, outdoors: 2, other: 1 },
  7,
);
assert.equal(dominantFood?.groupId, 'food_drink');
assert.ok((dominantFood?.share ?? 0) >= CLUSTER_DOMINANCE_RATIO);
assert.equal(clusterGlyphForGroup(dominantFood?.groupId ?? null), 'silverware-fork-knife');

// The ticket's counter-example: 3 Food, 2 Outdoors, 2 Shopping -> 43% -> mixed.
assert.equal(
  dominantClusterGroup({ food_drink: 3, outdoors: 2, shopping: 2 }, 7),
  null,
  'a plurality is not a majority — no meaningful dominant category',
);
assert.equal(clusterGlyphForGroup(null), CLUSTER_NEUTRAL_GLYPH);

// A tie at the top is never broken arbitrarily.
assert.equal(dominantClusterGroup({ food_drink: 2, outdoors: 2 }, 4), null);
assert.equal(dominantClusterGroup({ food_drink: 3, outdoors: 3 }, 6), null);
// Exactly 50% with a strict lead does qualify.
assert.equal(dominantClusterGroup({ food_drink: 3, outdoors: 2, other: 1 }, 6)?.groupId, 'food_drink');
// A single-group cluster is trivially dominant.
assert.equal(dominantClusterGroup({ outdoors: 5 }, 5)?.groupId, 'outdoors');
// Order of the keys must not matter.
assert.deepEqual(
  dominantClusterGroup({ shopping: 2, food_drink: 5, outdoors: 1 }, 8),
  dominantClusterGroup({ outdoors: 1, shopping: 2, food_drink: 5 }, 8),
);
assert.equal(dominantClusterGroup({}, 0), null);

// Every browse section has a glyph, and no section falls back to neutral by
// accident — a missing entry would silently make a whole category "mixed".
for (const section of CATEGORY_BROWSE_SECTIONS) {
  const glyph = clusterGlyphForGroup(section.id);
  assert.ok(glyph && glyph !== CLUSTER_NEUTRAL_GLYPH, `${section.id} has its own cluster glyph`);
}

// ---------------------------------------------------------------------------
// 3. Accessibility labels
// ---------------------------------------------------------------------------

assert.equal(
  clusterAccessibilityLabel({ count: 7, groupLabel: 'Food & drink' }),
  '7 saved places, mostly Food & drink',
);
assert.equal(clusterAccessibilityLabel({ count: 12, groupLabel: null }), '12 saved places');
assert.equal(clusterAccessibilityLabel({ count: 1, groupLabel: null }), '1 saved place');

// ---------------------------------------------------------------------------
// 4. Zoom conversion + hysteresis
// ---------------------------------------------------------------------------

// A 360-degree span in a 256px viewport is zoom 0 by definition.
assert.equal(
  Math.round(regionToClusterZoom({ longitudeDelta: 360, viewportWidth: 256 })),
  0,
);
// Halving the span is exactly one zoom level.
const zA = regionToClusterZoom({ longitudeDelta: 0.08, viewportWidth: VIEWPORT_WIDTH });
const zB = regionToClusterZoom({ longitudeDelta: 0.04, viewportWidth: VIEWPORT_WIDTH });
assert.ok(Math.abs(zB - zA - 1) < 1e-9, 'one halving == one zoom level');
assert.ok(zoomFor(tightRegion()) > zoomFor(wideRegion()), 'tighter region means higher zoom');
assert.equal(regionToClusterZoom({ longitudeDelta: 1e-12, viewportWidth: 390 }), CLUSTER_MAX_ZOOM + 1);
assert.equal(
  regionToClusterZoom({ longitudeDelta: Number.NaN, viewportWidth: VIEWPORT_WIDTH }),
  regionToClusterZoom({ longitudeDelta: 360, viewportWidth: VIEWPORT_WIDTH }),
  'a non-finite span degrades to the whole world, never to a crash or a silent zoom-in',
);

// Hysteresis: small wobbles around a committed level never re-cluster.
assert.equal(nextClusterZoom(null, 11.4), 11);
assert.equal(nextClusterZoom(11, 11.49), 11);
assert.equal(nextClusterZoom(11, 11.5), 11, 'the plain rounding boundary alone does not flip');
assert.equal(nextClusterZoom(11, 11 + 0.5 + CLUSTER_ZOOM_HYSTERESIS - 0.001), 11);
assert.equal(nextClusterZoom(11, 11 + 0.5 + CLUSTER_ZOOM_HYSTERESIS + 0.01), 12);
assert.equal(nextClusterZoom(11, 10 - 0.5), 10, 'a real zoom-out still commits');
assert.equal(nextClusterZoom(11, 3), 3);
// A pan that jitters back and forth across a boundary settles, it does not oscillate.
let committed = nextClusterZoom(null, 11.49);
for (const sample of [11.51, 11.48, 11.52, 11.47, 11.5]) {
  committed = nextClusterZoom(committed, sample);
}
assert.equal(committed, 11, 'jitter across a rounding boundary never flips the clustering');

// ---------------------------------------------------------------------------
// 5. bbox
// ---------------------------------------------------------------------------

const bbox = regionToClusterBbox({
  latitude: 33.7,
  longitude: -117.9,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
});
assert.ok(bbox[0] < -117.9 && bbox[2] > -117.9, 'bbox brackets the center longitude');
assert.ok(bbox[1] < 33.7 && bbox[3] > 33.7, 'bbox brackets the center latitude');
assert.ok(bbox[3] - bbox[1] > 0.2, 'bbox is padded beyond the visible region');
const worldBbox = regionToClusterBbox({
  latitude: 0, longitude: 0, latitudeDelta: 170, longitudeDelta: 359,
});
assert.deepEqual([worldBbox[0], worldBbox[2]], [-180, 180], 'a whole-world span clamps');

// ---------------------------------------------------------------------------
// 6. Cluster membership: near clusters, far does not
// ---------------------------------------------------------------------------

const lonePlace = [saved('restaurant', 33.75, -117.85, 'lone')];
const loneIndex = buildMapClusterIndex(lonePlace);
const loneNodes = queryMapClusters(loneIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) });
assert.deepEqual(placesOf(loneNodes), ['lone'], '1 place is an individual marker, never a cluster');
assert.equal(clustersOf(loneNodes).length, 0);

// Two places ~300m apart.
const pair = [
  saved('restaurant', 33.75, -117.85, 'pair-a'),
  saved('cafe', 33.7525, -117.8525, 'pair-b'),
];
const pairIndex = buildMapClusterIndex(pair);
const pairWide = queryMapClusters(pairIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) });
assert.equal(clustersOf(pairWide).length, 1, '2 nearby places cluster at wide zoom');
assert.equal(clustersOf(pairWide)[0]!.count, 2);
assert.equal(placesOf(pairWide).length, 0);

// The same two places, zoomed in.
const pairTight = queryMapClusters(pairIndex, { region: tightRegion(), zoom: zoomFor(tightRegion()) });
assert.equal(clustersOf(pairTight).length, 0, 'zooming in splits the cluster');
assert.deepEqual(placesOf(pairTight).sort(), ['pair-a', 'pair-b']);

// Zooming back out recombines them — clustering is a function of the camera,
// with no accumulated state to drift.
const pairWideAgain = queryMapClusters(pairIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) });
assert.deepEqual(
  clustersOf(pairWideAgain).map((c) => ({ count: c.count, glyph: c.glyph })),
  clustersOf(pairWide).map((c) => ({ count: c.count, glyph: c.glyph })),
  'zoom out recombines to exactly the same clustering',
);

// Two genuinely distant places stay separate at any zoom a user browses a
// region at. Clustering is screen distance, so this is the property that keeps
// a sparse map looking exactly like it does today.
const distant = [
  saved('restaurant', 33.75, -117.85, 'oc'),
  saved('restaurant', 47.6, -122.33, 'seattle'),
];
const distantIndex = buildMapClusterIndex(distant);
const continentalBbox = { latitude: 40, longitude: -120, latitudeDelta: 30, longitudeDelta: 30 };
const distantNodes = queryMapClusters(distantIndex, {
  region: continentalBbox,
  zoom: zoomFor(wideRegion()),
});
assert.equal(clustersOf(distantNodes).length, 0, 'distant places stay separate markers');
assert.deepEqual(placesOf(distantNodes).sort(), ['oc', 'seattle']);

// Zoomed all the way out to the continent they do collapse — that is the
// point of the feature, and the count still tells the truth.
const continentalNodes = queryMapClusters(distantIndex, { region: continentalBbox, zoom: 2 });
assert.equal(clustersOf(continentalNodes).length, 1);
assert.equal(clustersOf(continentalNodes)[0]!.count, 2);
assert.equal(
  clustersOf(continentalNodes)[0]!.groupId,
  'food_drink',
  'both are restaurants, so the cluster is unambiguously food & drink',
);

// ---------------------------------------------------------------------------
// 7. Dominant / mixed clusters end to end
// ---------------------------------------------------------------------------

/** Seven places within a couple hundred metres of each other. */
function huddle(categories: readonly string[], prefix: string): SavedPlaceWithPlace[] {
  return categories.map((category, i) =>
    saved(category, 33.75 + i * 0.0004, -117.85 + i * 0.0004, `${prefix}-${i}`),
  );
}

const foodHuddle = huddle(
  ['restaurant', 'cafe', 'bar', 'bakery', 'park', 'beach', 'service'],
  'food',
);
const foodIndex = buildMapClusterIndex(foodHuddle);
const foodNodes = queryMapClusters(foodIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) });
const foodCluster = clustersOf(foodNodes)[0]!;
assert.equal(clustersOf(foodNodes).length, 1);
assert.equal(foodCluster.count, 7);
assert.equal(foodCluster.groupId, 'food_drink', '4 of 7 food/drink is a real majority');
assert.equal(foodCluster.glyph, 'silverware-fork-knife');
assert.equal(foodCluster.accessibilityLabel, '7 saved places, mostly Food & drink');
assert.deepEqual(
  clusterGroupCounts(foodIndex, foodCluster.clusterId),
  { food_drink: 4, stays: 0, outdoors: 2, things_to_do: 0, shopping: 0, fitness_wellness: 0, other: 1 },
  'aggregated counts match a straight count of the leaves',
);

const mixedHuddle = huddle(
  ['restaurant', 'cafe', 'bar', 'park', 'beach', 'shopping', 'shopping'],
  'mixed',
);
const mixedIndex = buildMapClusterIndex(mixedHuddle);
const mixedNodes = queryMapClusters(mixedIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) });
const mixedCluster = clustersOf(mixedNodes)[0]!;
assert.equal(mixedCluster.count, 7);
assert.equal(mixedCluster.groupId, null, '3/2/2 has no meaningful majority');
assert.equal(mixedCluster.glyph, CLUSTER_NEUTRAL_GLYPH);
assert.equal(mixedCluster.accessibilityLabel, '7 saved places');

// The aggregated counts must survive being rolled up through several zoom
// levels — this is the property a shared mutable accumulator would break.
for (let zoom = 0; zoom <= CLUSTER_MAX_ZOOM; zoom += 1) {
  for (const cluster of clustersOf(
    queryMapClusters(foodIndex, { region: wideRegion(), zoom }),
  )) {
    const counts = clusterGroupCounts(foodIndex, cluster.clusterId);
    const summed = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(summed, cluster.count, `zoom ${zoom}: group counts sum to point_count`);
    assert.equal(
      cluster.groupId,
      dominantClusterGroup(counts, cluster.count)?.groupId ?? null,
      `zoom ${zoom}: rolled-up dominance matches a fresh count of the leaves`,
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Filter-first: filtering happens BEFORE clustering
// ---------------------------------------------------------------------------

const mixedCollection = [
  ...huddle(['restaurant', 'cafe', 'bar', 'bakery'], 'f'),
  ...huddle(['park', 'beach', 'hiking_trail'], 'o'),
];
const allZoom = zoomFor(wideRegion());

const unfiltered = queryMapClusters(
  buildMapClusterIndex(filterPlacesForMap(mixedCollection, 'all')),
  { region: wideRegion(), zoom: allZoom },
);
assert.equal(clustersOf(unfiltered)[0]!.count, 7);
assert.equal(clustersOf(unfiltered)[0]!.groupId, 'food_drink');

const outdoorsOnly = filterPlacesForMap(mixedCollection, 'outdoors');
assert.equal(outdoorsOnly.length, 3);
const outdoorsNodes = queryMapClusters(buildMapClusterIndex(outdoorsOnly), {
  region: wideRegion(),
  zoom: allZoom,
});
const outdoorsCluster = clustersOf(outdoorsNodes)[0]!;
assert.equal(outdoorsCluster.count, 3, 'the count reflects ONLY the filtered places');
assert.equal(outdoorsCluster.groupId, 'outdoors');
assert.equal(outdoorsCluster.glyph, 'pine-tree');
assert.equal(outdoorsCluster.accessibilityLabel, '3 saved places, mostly Outdoors');
for (const place of outdoorsOnly) {
  assert.equal(mapFilterGroupForPlace(place), 'outdoors');
}

const foodOnly = filterPlacesForMap(mixedCollection, 'food_drink');
const foodOnlyCluster = clustersOf(
  queryMapClusters(buildMapClusterIndex(foodOnly), { region: wideRegion(), zoom: allZoom }),
)[0]!;
assert.equal(foodOnlyCluster.count, 4);
assert.equal(foodOnlyCluster.groupId, 'food_drink');

// Returning to All must restore the original clustering exactly.
const restored = queryMapClusters(
  buildMapClusterIndex(filterPlacesForMap(mixedCollection, 'all')),
  { region: wideRegion(), zoom: allZoom },
);
assert.deepEqual(
  clustersOf(restored).map((c) => [c.count, c.groupId]),
  clustersOf(unfiltered).map((c) => [c.count, c.groupId]),
);

// ---------------------------------------------------------------------------
// 9. Selected-place exception
// ---------------------------------------------------------------------------
//
// The map excludes the selected place (and any active map-group focus) from
// the clustering input and renders it individually. Modelled here exactly as
// the screen does it.

const selectedId = 'food-1';
const withoutSelected = foodHuddle.filter((place) => place.id !== selectedId);
const selectedIndex = buildMapClusterIndex(withoutSelected);
const selectedNodes = queryMapClusters(selectedIndex, {
  region: wideRegion(),
  zoom: zoomFor(wideRegion()),
});
const rendered = [
  ...clustersOf(selectedNodes).map((c) => `cluster:${c.count}`),
  ...placesOf(selectedNodes),
  selectedId,
];
assert.ok(rendered.includes(selectedId), 'the selected place is always rendered individually');
assert.equal(
  clustersOf(selectedNodes).reduce((sum, c) => sum + c.count, 0) + placesOf(selectedNodes).length,
  foodHuddle.length - 1,
  'the selected place is not double-counted inside a cluster',
);
assert.equal(clustersOf(selectedNodes)[0]!.count, 6, 'the surrounding cluster drops to 6');

// Selecting and deselecting is reversible with no residue.
const deselected = queryMapClusters(buildMapClusterIndex(foodHuddle), {
  region: wideRegion(),
  zoom: zoomFor(wideRegion()),
});
assert.equal(clustersOf(deselected)[0]!.count, 7, 'deselect restores the full cluster');

// A map-group focus keeps its members individually visible too.
const groupIds = new Set(['food-0', 'food-1', 'food-2']);
const groupNodes = queryMapClusters(
  buildMapClusterIndex(foodHuddle.filter((place) => !groupIds.has(place.id))),
  { region: wideRegion(), zoom: zoomFor(wideRegion()) },
);
const groupRendered = clustersOf(groupNodes).reduce((sum, c) => sum + c.count, 0)
  + placesOf(groupNodes).length
  + groupIds.size;
assert.equal(groupRendered, foodHuddle.length, 'group focus preserves every place exactly once');
for (const id of groupIds) {
  assert.ok(!placesOf(groupNodes).includes(id), 'group members are excluded from the clustered set');
}

// ---------------------------------------------------------------------------
// 10. Stable cluster identity
// ---------------------------------------------------------------------------

const stableIndex = buildMapClusterIndex(foodHuddle);
const panA = queryMapClusters(stableIndex, {
  region: { latitude: 33.75, longitude: -117.85, latitudeDelta: 1.2, longitudeDelta: 1.2 },
  zoom: zoomFor(wideRegion()),
});
const panB = queryMapClusters(stableIndex, {
  region: { latitude: 33.752, longitude: -117.848, latitudeDelta: 1.2, longitudeDelta: 1.2 },
  zoom: zoomFor(wideRegion()),
});
assert.deepEqual(
  clustersOf(panA).map((c) => c.id),
  clustersOf(panB).map((c) => c.id),
  'panning at the same zoom keeps identical cluster ids — no marker churn',
);
assert.ok(clustersOf(panA)[0]!.id.startsWith('cluster-'), 'ids come from the clustering engine');
assert.notEqual(clustersOf(panA)[0]!.id, 'cluster-0', 'ids are engine ids, never array indexes');

// Two independent builds over the same input produce the same ids.
const rebuilt = queryMapClusters(buildMapClusterIndex(foodHuddle), {
  region: wideRegion(),
  zoom: zoomFor(wideRegion()),
});
assert.deepEqual(
  clustersOf(rebuilt).map((c) => c.id),
  clustersOf(panA).map((c) => c.id),
  'clustering is deterministic across index rebuilds',
);

// ---------------------------------------------------------------------------
// 11. Expansion zoom + tap behavior
// ---------------------------------------------------------------------------

const expansion = clusterExpansionZoom(stableIndex, clustersOf(panA)[0]!.clusterId);
assert.ok(expansion != null && expansion > zoomFor(wideRegion()), 'expansion zoom is further in');

const tapZoom = clusterTapZoom({ expansionZoom: expansion!, currentZoom: zoomFor(wideRegion()) });
assert.ok(tapZoom > zoomFor(wideRegion()), 'a tap always zooms in at least one level');
assert.ok(tapZoom <= CLUSTER_MAX_ZOOM + 1, 'a tap never exceeds the level where clustering stops');

// Tapping at the expansion zoom actually splits the cluster.
const afterTapRegion = clusterExpansionRegion({
  latitude: clustersOf(panA)[0]!.latitude,
  longitude: clustersOf(panA)[0]!.longitude,
  zoom: tapZoom,
  viewportWidth: VIEWPORT_WIDTH,
  viewportHeight: VIEWPORT_HEIGHT,
});
const afterTapNodes = queryMapClusters(stableIndex, {
  region: afterTapRegion,
  zoom: tapZoom,
});
assert.ok(
  clustersOf(afterTapNodes).length + placesOf(afterTapNodes).length > clustersOf(panA).length,
  'tapping a cluster reveals more markers than were there before',
);

// The region we animate to really does read back as the zoom we asked for.
const roundTrip = regionToClusterZoom({
  longitudeDelta: afterTapRegion.longitudeDelta,
  viewportWidth: VIEWPORT_WIDTH,
});
assert.ok(Math.abs(roundTrip - tapZoom) < 1e-6, 'expansion region round-trips to its zoom');
assert.ok(
  afterTapRegion.latitudeDelta < afterTapRegion.longitudeDelta * (VIEWPORT_HEIGHT / VIEWPORT_WIDTH),
  'Mercator latitude compression is applied',
);

// A dead tap is impossible even if the engine reports no further expansion.
assert.equal(clusterTapZoom({ expansionZoom: 5, currentZoom: 9 }), 10);
assert.equal(clusterTapZoom({ expansionZoom: 99, currentZoom: 9 }), CLUSTER_MAX_ZOOM + 1);
assert.equal(
  clusterTapZoom({ expansionZoom: 99, currentZoom: CLUSTER_MAX_ZOOM + 1 }),
  CLUSTER_MAX_ZOOM + 1,
  'at the top of the range a tap is a no-op rather than an infinite chase',
);

// ---------------------------------------------------------------------------
// 12. Identical coordinates terminate
// ---------------------------------------------------------------------------

const stacked = [
  saved('restaurant', 33.75, -117.85, 'stack-a'),
  saved('cafe', 33.75, -117.85, 'stack-b'),
  saved('bar', 33.75, -117.85, 'stack-c'),
];
const stackedIndex = buildMapClusterIndex(stacked);
const stackedWide = clustersOf(
  queryMapClusters(stackedIndex, { region: wideRegion(), zoom: zoomFor(wideRegion()) }),
);
assert.equal(stackedWide.length, 1);
assert.equal(stackedWide[0]!.count, 3);

const stackedExpansion = clusterExpansionZoom(stackedIndex, stackedWide[0]!.clusterId);
assert.ok(
  (stackedExpansion ?? 0) > CLUSTER_MAX_ZOOM,
  'co-located places report an expansion past the clustering ceiling',
);
const stackedTap = clusterTapZoom({
  expansionZoom: stackedExpansion!,
  currentZoom: zoomFor(wideRegion()),
});
assert.equal(stackedTap, CLUSTER_MAX_ZOOM + 1, 'the tap is capped at the ceiling, and terminates');

const stackedFinal = queryMapClusters(stackedIndex, {
  region: tightRegion(),
  zoom: CLUSTER_MAX_ZOOM + 1,
});
assert.equal(clustersOf(stackedFinal).length, 0);
assert.deepEqual(
  placesOf(stackedFinal).sort(),
  ['stack-a', 'stack-b', 'stack-c'],
  'past the ceiling co-located saves are ordinary overlapping pins — exactly the pre-clustering behavior',
);

// No place may ever be lost: at every zoom, clustered + loose == input.
for (let zoom = 0; zoom <= CLUSTER_MAX_ZOOM + 1; zoom += 1) {
  const nodes = queryMapClusters(foodIndex, { region: wideRegion(), zoom });
  const accounted = clustersOf(nodes).reduce((sum, c) => sum + c.count, 0) + placesOf(nodes).length;
  assert.equal(accounted, foodHuddle.length, `zoom ${zoom}: every place is accounted for exactly once`);
}

// Regression: `visiblePlaces` is the collection allowed by the active Nearr
// filter; it is not pre-clipped to the current camera. A GPS-centered camera
// can therefore be away from all three saves while it settles. Supercluster's
// empty bbox result must not become an empty React marker list.
const threeOrdinaryPlaces = [
  saved('restaurant', 33.7500, -117.8500, 'three-a'),
  saved('cafe', 33.7525, -117.8525, 'three-b'),
  saved('park', 33.7550, -117.8550, 'three-c'),
];
const awayFromPlaces = queryMapClusters(buildMapClusterIndex(threeOrdinaryPlaces), {
  region: {
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  },
  zoom: 14,
});
assert.equal(clustersOf(awayFromPlaces).length, 0);
assert.deepEqual(
  placesOf(awayFromPlaces).sort(),
  ['three-a', 'three-b', 'three-c'],
  'three filter-visible valid places always produce marker nodes even while the camera is elsewhere',
);
assert.ok(
  clustersOf(awayFromPlaces).length + placesOf(awayFromPlaces).length > 0,
  'visiblePlacesLength > 0 can never produce a zero-marker render list',
);

// ---------------------------------------------------------------------------
// 13. Degenerate input
// ---------------------------------------------------------------------------

assert.equal(buildMapClusterIndex([]).index, null);
assert.deepEqual(queryMapClusters(buildMapClusterIndex([]), { region: wideRegion(), zoom: 8 }), []);
assert.equal(buildMapClusterIndex(null).pointCount, 0);
const withBadCoords = buildMapClusterIndex([
  saved('restaurant', 33.75, -117.85, 'good'),
  { id: 'bad', place: { latitude: null, longitude: null } } as unknown as SavedPlaceWithPlace,
]);
assert.equal(withBadCoords.pointCount, 1, 'places without coordinates are skipped, not crashed on');

// ---------------------------------------------------------------------------
// 14. Offline: no network / photo surface is reachable from clustering
// ---------------------------------------------------------------------------

const clusteringSource = readFileSync(join(process.cwd(), 'lib/mapClustering.ts'), 'utf8');
const clusterComponentSource = readFileSync(
  join(process.cwd(), 'components/map/NearrMapClusterMarker.tsx'),
  'utf8',
);
for (const forbidden of ['fetch(', 'placeRichDetails', 'photoUrl', 'Image', 'supabase']) {
  assert.ok(
    !clusteringSource.includes(forbidden),
    `clustering must not reference ${forbidden} — clusters are derived from local state only`,
  );
  assert.ok(
    !clusterComponentSource.includes(forbidden),
    `the cluster marker must not reference ${forbidden} — no photo fan-out`,
  );
}

// ---------------------------------------------------------------------------
// 15. Screen wiring
// ---------------------------------------------------------------------------

const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
assert.match(mapSource, /const clusterCandidates = useMemo\(/);
assert.match(mapSource, /visiblePlaces\.filter\(\(place\) => !alwaysIndividualIds\.has\(place\.id\)\)/);
assert.match(mapSource, /if \(selected\?\.id\) ids\.add\(selected\.id\);/);
assert.match(mapSource, /new Set<string>\(mapGroupCoordinateIds\)/);
assert.match(mapSource, /buildMapClusterIndex\(clusterCandidates\)/);
assert.match(mapSource, /visibleCount: individualPlaces\.length/);
assert.match(mapSource, /\{individualPlaces\.map\(\(p\) => \(\s*\n\s*<NearrMapMarker/);
assert.match(mapSource, /\{clusterMarkers\.map\(\(cluster\) => \(\s*\n\s*<NearrMapClusterMarker/);
assert.match(mapSource, /onPress=\{handleClusterPress\}/);
assert.match(mapSource, /setSettledRegion\(region\)/);
// Clustering must not be able to move the camera on its own.
assert.equal(
  (mapSource.match(/clusterExpansionRegion\(/g) ?? []).length,
  1,
  'exactly one camera movement is driven by clustering: the cluster tap',
);
assert.ok(
  !/useEffect\([^)]*clusterNodes/.test(mapSource),
  'no effect reacts to reclustering — reclustering never moves the camera',
);

// ---------------------------------------------------------------------------
// 16. Synthetic performance
// ---------------------------------------------------------------------------
//
// JS timings here are NOT a claim about native frame rate; they bound the work
// this module adds to a region change. Physical QA still governs.

function syntheticCollection(count: number): SavedPlaceWithPlace[] {
  const categories = ['restaurant', 'cafe', 'bar', 'park', 'beach', 'shopping', 'hotel', 'museum'];
  const places: SavedPlaceWithPlace[] = [];
  // Deterministic LCG so the fixture is identical on every run.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    // Clumped like a real collection: a few dense metros, not a uniform sheet.
    const metro = i % 5;
    const baseLat = 33.6 + metro * 0.25;
    const baseLng = -118.3 + metro * 0.2;
    places.push(
      saved(
        categories[i % categories.length]!,
        baseLat + (rand() - 0.5) * 0.3,
        baseLng + (rand() - 0.5) * 0.3,
        `synthetic-${i}`,
      ),
    );
  }
  return places;
}

const PERF_SCENARIOS = [
  {
    name: 'wide  ',
    region: { latitude: 34.1, longitude: -117.9, latitudeDelta: 1.6, longitudeDelta: 1.6 },
  },
  {
    name: 'metro ',
    region: { latitude: 33.6, longitude: -118.3, latitudeDelta: 0.22, longitudeDelta: 0.22 },
  },
] as const;

const perfRows: string[] = [];

for (const count of [50, 100, 250, 500]) {
  const places = syntheticCollection(count);

  const buildStart = performance.now();
  const index = buildMapClusterIndex(places);
  const buildMs = performance.now() - buildStart;
  assert.ok(buildMs < 100, `${count} markers: index build (${buildMs.toFixed(2)}ms) stays cheap`);

  for (const scenario of PERF_SCENARIOS) {
    const zoom = zoomFor(scenario.region);

    // A region change re-queries but does NOT rebuild the index — the query is
    // the cost the user actually pays while panning.
    const QUERIES = 50;
    const queryStart = performance.now();
    let nodes = queryMapClusters(index, { region: scenario.region, zoom });
    for (let i = 1; i < QUERIES; i += 1) {
      nodes = queryMapClusters(index, {
        region: { ...scenario.region, longitude: scenario.region.longitude + i * 0.0005 },
        zoom,
      });
    }
    const queryMs = (performance.now() - queryStart) / QUERIES;

    const clusters = clustersOf(nodes).length;
    const loose = placesOf(nodes).length;
    const contained = clustersOf(nodes).reduce((sum, c) => sum + c.count, 0) + loose;

    assert.ok(
      clusters + loose <= contained,
      `${count} markers @ ${scenario.name}: rendering never exceeds what is contained`,
    );
    assert.ok(
      queryMs < 16,
      `${count} markers @ ${scenario.name}: per-region-change query (${queryMs.toFixed(3)}ms) `
      + 'stays inside a frame budget',
    );

    perfRows.push(
      `PERF ${String(count).padStart(3)} markers | ${scenario.name} z${String(zoom).padStart(2)} | `
      + `${String(contained).padStart(3)} in view -> ${String(clusters).padStart(2)} clusters + `
      + `${String(loose).padStart(3)} individual = ${String(clusters + loose).padStart(3)} rendered | `
      + `build ${buildMs.toFixed(2)}ms | query ${queryMs.toFixed(3)}ms`,
    );
  }

  // Nothing may be lost across the whole collection at any zoom.
  const everything = queryMapClusters(index, {
    region: { latitude: 34.1, longitude: -117.9, latitudeDelta: 6, longitudeDelta: 6 },
    zoom: 6,
  });
  const accounted = clustersOf(everything).reduce((sum, c) => sum + c.count, 0)
    + placesOf(everything).length;
  assert.equal(accounted, count, `${count} markers: nothing is lost`);
  assert.ok(
    clustersOf(everything).length + placesOf(everything).length < count,
    `${count} markers: clustering actually reduces marker count`,
  );
}
for (const row of perfRows) console.log(row);

console.log(
  'PASS membership, dominance, mixed clusters, size tiers, filter-first, selected-place exception, ' +
  'stable ids, expansion zoom, identical coordinates, accessibility labels, offline purity, and wiring',
);
