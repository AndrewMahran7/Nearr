/** Pure regression and synthetic-scale checks for saved map pin presentation. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { filterPlacesForMap } from '../lib/mapVisibility';
import {
  MAP_MARKER_COMPACT_COUNT,
  MAP_MARKER_DENSE_COUNT,
  MARKER_CATEGORY_PRESENTATIONS,
  mapMarkerDetailLevel,
  savedMarkerPresentation,
} from '../lib/mapMarkerPresentation';
import { NEARR_CATEGORIES } from '../lib/placeCategory';
import type { SavedPlaceWithPlace } from '../types';

function saved(category: string, index = 1): SavedPlaceWithPlace {
  return {
    id: `saved-${category}-${index}`,
    category,
    archived_at: null,
    visited_at: null,
    notifications_enabled: true,
    place: {
      id: `place-${category}-${index}`,
      name: `${category} place ${index}`,
      category,
      latitude: 34 + index * 0.0001,
      longitude: -118 - index * 0.0001,
    },
  } as unknown as SavedPlaceWithPlace;
}

assert.deepEqual(
  Object.keys(MARKER_CATEGORY_PRESENTATIONS).sort(),
  [...NEARR_CATEGORIES].sort(),
  'marker taxonomy must cover the canonical Nearr taxonomy exactly',
);
assert.equal(savedMarkerPresentation(saved('restaurant'), { detailLevel: 'local', selected: false }).family, 'food');
assert.equal(savedMarkerPresentation(saved('hotel'), { detailLevel: 'local', selected: false }).family, 'stay');
assert.equal(savedMarkerPresentation(saved('beach'), { detailLevel: 'local', selected: false }).glyph, 'waves');
assert.equal(savedMarkerPresentation(saved('hiking_trail'), { detailLevel: 'local', selected: false }).glyph, 'hiking');
assert.equal(savedMarkerPresentation(saved('not-real'), { detailLevel: 'local', selected: false }).category, 'other');

// Selection is a reversible projection, not component-local selected state.
const restaurant = saved('restaurant');
const normal = savedMarkerPresentation(restaurant, { detailLevel: 'local', selected: false });
const selected = savedMarkerPresentation(restaurant, { detailLevel: 'local', selected: true });
const normalAgain = savedMarkerPresentation(restaurant, { detailLevel: 'local', selected: false });
assert.equal(normal.selected, false);
assert.equal(selected.selected, true);
assert.equal(selected.showLabel, true, 'selection has a non-color label cue');
assert.deepEqual(normalAgain, normal, 'deselect returns to the exact normal presentation');

// Duplicate-name suppression. The Place Detail card titles the selected place,
// so the pin's own name capsule is hidden for exactly as long as that card is
// on screen — and for nothing else.
const selectedWithDetail = savedMarkerPresentation(restaurant, {
  detailLevel: 'local', selected: true, detailVisible: true,
});
assert.equal(
  selectedWithDetail.showLabel,
  false,
  'selected + Place Detail open hides the duplicate name capsule',
);
assert.equal(
  savedMarkerPresentation(restaurant, {
    detailLevel: 'local', selected: true, detailVisible: false,
  }).showLabel,
  true,
  'selected + Place Detail closed restores the normal selected-marker label',
);
assert.equal(
  savedMarkerPresentation(restaurant, {
    detailLevel: 'local', selected: false, detailVisible: true,
  }).showLabel,
  false,
  "an unselected marker never gains a label from another place's detail card",
);
// Switching the selection: the place that just lost selection returns to the
// exact normal presentation, with no residual hidden-label state.
assert.deepEqual(
  savedMarkerPresentation(restaurant, {
    detailLevel: 'local', selected: false, detailVisible: true,
  }),
  normal,
  'deselecting while another detail is open leaves no stale label state',
);
// Hiding the visual capsule must not touch selection identity, the selected
// body, or the photo/category fallback.
assert.equal(selectedWithDetail.selected, true, 'the marker stays selected');
assert.equal(
  savedMarkerPresentation(restaurant, {
    detailLevel: 'local', selected: true, detailVisible: true,
    photoUri: 'https://example.com/place.jpg',
  }).visual,
  'photo',
  'selected photo survives label suppression',
);
assert.equal(
  savedMarkerPresentation(restaurant, {
    detailLevel: 'local', selected: true, detailVisible: true,
    photoUri: 'https://example.com/place.jpg', photoFailed: true,
  }).glyph,
  selected.glyph,
  'category fallback survives label suppression',
);
// Accessibility is never traded for visual polish.
assert.equal(
  selectedWithDetail.accessibilityLabel,
  selected.accessibilityLabel,
  'the accessible name is unchanged when the visual label is hidden',
);
assert.ok(
  selectedWithDetail.accessibilityLabel.includes(restaurant.place.name),
  'VoiceOver still identifies the selected place by name',
);

// Photos are progressive and selected-only. Missing and failed photos retain a
// complete category marker; an unselected marker never becomes a photo wall.
assert.equal(savedMarkerPresentation(restaurant, {
  detailLevel: 'local', selected: true, photoUri: 'https://example.com/place.jpg',
}).visual, 'photo');
assert.equal(savedMarkerPresentation(restaurant, {
  detailLevel: 'local', selected: true, photoUri: null,
}).visual, 'category');
assert.equal(savedMarkerPresentation(restaurant, {
  detailLevel: 'local', selected: true, photoUri: 'https://example.com/place.jpg', photoFailed: true,
}).visual, 'category');
assert.equal(savedMarkerPresentation(restaurant, {
  detailLevel: 'local', selected: false, photoUri: 'https://example.com/place.jpg',
}).visual, 'category');

assert.equal(mapMarkerDetailLevel({ latitudeDelta: 0.05, visibleCount: 25 }), 'local');
assert.equal(mapMarkerDetailLevel({ latitudeDelta: 0.05, visibleCount: MAP_MARKER_COMPACT_COUNT }), 'compact');
assert.equal(mapMarkerDetailLevel({ latitudeDelta: 0.2, visibleCount: 10 }), 'compact');
assert.equal(mapMarkerDetailLevel({ latitudeDelta: 0.05, visibleCount: MAP_MARKER_DENSE_COUNT }), 'dense');
assert.equal(mapMarkerDetailLevel({ latitudeDelta: 1, visibleCount: 1 }), 'dense');

// Filter invariant: an excluded place never reaches marker presentation.
const beach = saved('beach', 2);
const filtered = filterPlacesForMap([restaurant, beach], 'outdoors');
const filteredPresentations = filtered.map((place) =>
  savedMarkerPresentation(place, { detailLevel: 'local', selected: false }),
);
assert.deepEqual(filtered.map((place) => place.id), [beach.id]);
assert.deepEqual(filteredPresentations.map((entry) => entry.category), ['beach']);

assert.equal(normal.accessibilityLabel, 'Saved restaurant, restaurant place 1');
assert.equal(selected.accessibilityLabel, 'Selected saved restaurant, restaurant place 1');

// Synthetic pure-presentation cost. This does not claim native GPU/device
// performance; it catches accidental super-linear JS work and records the tier
// used at the requested collection sizes.
for (const count of [25, 100, 250, 500]) {
  const places = Array.from({ length: count }, (_, index) => saved(
    NEARR_CATEGORIES[index % NEARR_CATEGORIES.length]!,
    index + 1,
  ));
  const level = mapMarkerDetailLevel({ latitudeDelta: 0.05, visibleCount: count });
  const started = performance.now();
  for (let pass = 0; pass < 50; pass += 1) {
    places.map((place) => savedMarkerPresentation(place, {
      detailLevel: level,
      selected: false,
    }));
  }
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1000, `${count} marker presentations remain comfortably linear`);
  console.log(`PERF ${count} markers: tier=${level}, 50 passes=${elapsedMs.toFixed(2)}ms`);
}

const mapSource = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
const componentSource = readFileSync(join(process.cwd(), 'components/map/NearrMapMarker.tsx'), 'utf8');
// Individual pins now render from the post-clustering set, and their detail
// level is derived from that same set — clustering owns marker COUNT, this
// module owns how each surviving pin looks. See lib/mapClustering.ts.
assert.match(mapSource, /individualPlaces\.map\(\(p\) => \(\s*\n\s*<NearrMapMarker/);
assert.match(mapSource, /visibleCount: individualPlaces\.length/);
assert.match(mapSource, /detailLevel=\{markerDetailLevel\}/);
assert.match(mapSource, /MaterialCommunityIcons\.loadFont\(\)/);
assert.match(mapSource, /redesignEnabled=\{mapPinRedesignActive\}/);
// The rule is driven by the same flag that mounts the Place Detail card, not
// by a layout measurement, and it is scoped to the selected marker.
assert.match(mapSource, /const selectedPlaceDetailVisible = !!selected;/);
assert.match(mapSource, /const shouldRenderSelectedPlaceDetail =/);
assert.match(mapSource, /\{selected && shouldRenderSelectedPlaceDetail \? \(/);
assert.match(
  mapSource,
  /: selectedPlaceDetailVisible && selected\?\.id === p\.id/,
);
assert.match(componentSource, /accessibilityLabel=\{presentation\.accessibilityLabel\}/);
assert.match(componentSource, /const showsLabel = presentation\.showLabel;/);
assert.match(componentSource, /prev\.detailVisible === next\.detailVisible/);
// Hiding the capsule shrinks the canvas, so the anchor must follow it or the
// pin would jump off its coordinate.
assert.match(
  componentSource,
  /anchor=\{selected && redesignEnabled && showsLabel \? \{ x: 0\.5, y: 0\.335 \} : \{ x: 0\.5, y: 0\.5 \}\}/,
);
assert.match(
  componentSource,
  /selected && showsLabel[\s\S]{0,40}width: selectedWidth, height: selectedHeight/,
);
assert.match(componentSource, /!redesignEnabled \|\| !selected \|\| !googlePlaceId/);
assert.match(componentSource, /tracksViewChanges=\{tracksViewChanges\}/);
assert.match(componentSource, /setPhotoFailed\(true\)/);
assert.match(componentSource, /MAP_PIN_DIAGNOSTIC_LIMIT = 30/);
assert.match(componentSource, /selected-photo-(request|result|loaded|failed)/);
assert.match(mapSource, /renderCount: mapRenderCountRef\.current/);
assert.match(mapSource, /markersRendered: clusterMarkers\.length \+ individualPlaces\.length/);

console.log('PASS category, selection, duplicate-label suppression, filter, photo fallback, density, accessibility, bounded diagnostics, and marker wiring');
