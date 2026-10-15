import assert from 'node:assert/strict';
import {
  canApplySelectedMarkerCorrection,
  isValidMapCoordinate,
  mapKeyboardOverlap,
  mapUsableViewport,
  planSavedPinsCamera,
  planSelectedMarkerOcclusion,
  type MapCoordinate,
  type MapUsableViewport,
} from '../lib/mapViewportGeometry';
import { MapCameraTransactionCoordinator } from '../lib/mapCameraTransaction';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
}
const viewport = mapUsableViewport({ width: 390, height: 844, top: 144, bottom: 270 });
const fixture = (count: number): MapCoordinate[] => Array.from({ length: count }, (_, index) => ({
  latitude: 32 + ((index * 37) % 260) / 100,
  longitude: -120 + ((index * 53) % 420) / 100,
}));

test('keyboard reserves only overlap remaining after native window resize', () => {
  assert.equal(mapKeyboardOverlap({ mapY: 24, mapHeight: 500, keyboardScreenY: 524 }), 0,
    'Android adjustResize map already ends at the keyboard');
  assert.equal(mapKeyboardOverlap({ mapY: 0, mapHeight: 844, keyboardScreenY: 544 }), 300,
    'unresized map reserves actual iOS keyboard overlap');
  assert.equal(mapKeyboardOverlap({ mapY: 44, mapHeight: 700, keyboardScreenY: 544 }), 200,
    'map frame offset and bottom chrome are excluded from keyboard height');
  assert.equal(mapKeyboardOverlap({ mapY: 44, mapHeight: 700, keyboardScreenY: 20 }), 700,
    'coverage cannot exceed the map frame');
  assert.equal(mapKeyboardOverlap({ mapY: 44, mapHeight: 700, keyboardScreenY: null }), 0,
    'keyboard hide clears coverage');
  assert.equal(mapKeyboardOverlap({ mapY: 44, mapHeight: 700, keyboardScreenY: NaN }), 0);
});

/** Independent screen-space oracle: every valid pin must fit, not just its centroid. */
function assertFit(coordinates: MapCoordinate[], targetViewport = viewport) {
  const plan = planSavedPinsCamera({ coordinates, viewport: targetViewport });
  assert.equal(plan.kind, 'camera');
  if (plan.kind !== 'camera') throw new Error('Camera plan missing');
  const pixelsPerWorld = 256 * Math.pow(2, plan.zoom);
  const latitudeY = (latitude: number) => {
    const sine = Math.sin(latitude * Math.PI / 180);
    return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
  };
  for (const coordinate of coordinates.filter(isValidMapCoordinate)) {
    const longitudeDistance = ((coordinate.longitude - plan.center.longitude + 540) % 360) - 180;
    const pixelX = targetViewport.width / 2 + longitudeDistance * pixelsPerWorld / 360;
    const pixelY = targetViewport.height / 2 +
      (latitudeY(coordinate.latitude) - latitudeY(plan.center.latitude)) * pixelsPerWorld;
    assert.ok(pixelX >= targetViewport.left - 1e-5 && pixelX <= targetViewport.right + 1e-5,
      `${JSON.stringify(coordinate)} x=${pixelX} outside ${targetViewport.left}..${targetViewport.right}`);
    assert.ok(pixelY >= targetViewport.top - 1e-5 && pixelY <= targetViewport.bottom + 1e-5,
      `${JSON.stringify(coordinate)} y=${pixelY} outside ${targetViewport.top}..${targetViewport.bottom}`);
  }
  assert.ok(Number.isFinite(plan.region.latitudeDelta) && plan.region.latitudeDelta > 0);
  assert.ok(Number.isFinite(plan.region.longitudeDelta) && plan.region.longitudeDelta > 0);
  return plan;
}

test('empty and invalid-coordinate libraries leave the existing camera alone', () => {
  for (const coordinates of [[], [{ latitude: NaN, longitude: 1 }], [{ latitude: 1, longitude: 181 }],
    [{ latitude: 91, longitude: 2 }], [{ latitude: 1, longitude: Infinity }]]) {
    assert.deepEqual(planSavedPinsCamera({ coordinates, viewport }), { kind: 'none', reason: 'no_coordinates' });
  }
  assert.equal(isValidMapCoordinate({ latitude: 0, longitude: 0 }), true);
});

for (const count of [1, 2, 5, 20, 100, 1_000]) {
  test(`${count} pins fit inside measured overlay and marker padding`, () => {
    const plan = assertFit(fixture(count));
    assert.equal(plan.validCoordinateCount, count);
    if (count === 1) assert.equal(plan.zoom, 15);
  });
}

test('100 identical-coordinate saves fit with useful neighborhood context', () => {
  const plan = assertFit(Array.from({ length: 100 }, () => ({ latitude: 34, longitude: -118 })));
  assert.equal(plan.uniqueCoordinateCount, 1);
  assert.equal(plan.validCoordinateCount, 100);
  assert.equal(plan.zoom, 15);
});

test('a single distant outlier is included even with 100 dense neighbors', () => {
  assertFit([...fixture(100), { latitude: 48.8566, longitude: 2.3522 }]);
});

test('international and opposite-hemisphere pins fit', () => {
  assertFit([
    { latitude: 34.0522, longitude: -118.2437 },
    { latitude: 51.5074, longitude: -0.1278 },
    { latitude: 35.6762, longitude: 139.6503 },
    { latitude: -33.8688, longitude: 151.2093 },
    { latitude: -33.9249, longitude: 18.4241 },
  ]);
});

test('antimeridian neighbors use the narrow arc and do not travel via Greenwich', () => {
  const plan = assertFit([{ latitude: -16, longitude: 179.5 }, { latitude: -17, longitude: -179.7 }]);
  assert.equal(plan.crossesAntimeridian, true);
  assert.ok(Math.abs(plan.center.longitude) > 179);
  assert.ok(plan.region.longitudeDelta < 5);
});

test('equivalent positive and negative dateline coordinates are one location', () => {
  const plan = assertFit([{ latitude: 0, longitude: 180 }, { latitude: 0, longitude: -180 }]);
  assert.equal(plan.uniqueCoordinateCount, 1);
  assert.equal(plan.zoom, 15);
});

test('filtered bounds are based only on the supplied displayed category', () => {
  const visible = fixture(5);
  const complete = [...visible, { latitude: 35.68, longitude: 139.69 }];
  const filteredPlan = assertFit(visible);
  const allPlan = assertFit(complete);
  assert.equal(filteredPlan.validCoordinateCount, 5);
  assert.equal(allPlan.validCoordinateCount, 6);
  assert.ok(filteredPlan.zoom > allPlan.zoom);
});

test('measured top, dock and selected-card heights translate the projected center', () => {
  const measured = mapUsableViewport({ width: 390, height: 844, top: 140, bottom: 420, margin: 28 });
  assert.deepEqual(measured.edgePadding, { top: 168, right: 28, bottom: 448, left: 28 });
  assert.deepEqual(measured.center, { x: 195, y: 282 });
  const plan = assertFit([{ latitude: 34, longitude: -118 }], measured);
  assert.ok(plan.center.latitude < 34, 'camera moves south so the pin appears above the card');
});

test('portrait, landscape, compact and expanded overlays retain all pins', () => {
  for (const [width, height, top, bottom] of [
    [320, 568, 120, 200], [430, 932, 170, 300], [844, 390, 70, 120],
    [390, 844, 150, 500], [390, 844, 150, 565],
  ]) {
    assertFit(fixture(20), mapUsableViewport({ width, height, top, bottom }));
  }
});

test('invalid or entirely covered viewport does not issue an arbitrary camera move', () => {
  for (const dimensions of [{ width: 0, height: 0 }, { width: NaN, height: 844 },
    { width: 390, height: 844, top: 200, bottom: 650 }]) {
    assert.deepEqual(planSavedPinsCamera({ coordinates: fixture(1), viewport: mapUsableViewport(dimensions) }),
      { kind: 'none', reason: 'unmeasured_viewport' });
  }
});

test('near-world coverage exposes native overscan limitation explicitly', () => {
  const coordinates = Array.from({ length: 100 }, (_, index) => ({ latitude: 0, longitude: -179 + index * 3.6 }));
  const plan = assertFit(coordinates);
  assert.equal(plan.requiresWorldOverscan, true);
  assert.equal(plan.region.longitudeDelta, 360);
});

test('polar coordinates remain finite at the Mercator boundary', () => {
  const plan = planSavedPinsCamera({ coordinates: [{ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 1 }], viewport });
  assert.equal(plan.kind, 'camera');
  if (plan.kind !== 'camera') return;
  for (const value of Object.values(plan.region)) assert.ok(Number.isFinite(value));
});

test('repeat fitting is deterministic and never mutates saved coordinates', () => {
  const coordinates = fixture(20);
  const original = JSON.stringify(coordinates);
  const first = planSavedPinsCamera({ coordinates, viewport });
  const repeated = planSavedPinsCamera({ coordinates: [...coordinates].reverse(), viewport });
  assert.equal(first.kind, 'camera');
  assert.equal(repeated.kind, 'camera');
  if (first.kind !== 'camera' || repeated.kind !== 'camera') return;
  assert.deepEqual(first.region, repeated.region);
  assert.equal(JSON.stringify(coordinates), original);
});

test('Show All repeated during settlement owns exactly one native command', () => {
  const camera = new MapCameraTransactionCoordinator();
  const target = assertFit(fixture(5));
  const first = camera.start({ reason: 'programmatic_focus', startedAt: 1, startingViewportRevision: 1, targetRegion: target.region });
  assert.ok(first);
  assert.ok(camera.commandIssued(first!.id));
  assert.equal(camera.start({ reason: 'programmatic_focus', startedAt: 2, startingViewportRevision: 1 }), null);
  assert.equal(camera.commandIssued(first!.id), null);
  assert.equal(camera.current()?.cameraCommandsIssued, 1);
  camera.settle(first!.id);
  const repeated = camera.start({ reason: 'programmatic_focus', startedAt: 3, startingViewportRevision: 2 });
  assert.ok(repeated);
  assert.notEqual(repeated!.id, first!.id);
});

test('compact card correction puts the pin above the measured card without zooming', () => {
  const point = { x: 195, y: 740 };
  const plan = planSelectedMarkerOcclusion({ point, viewport });
  assert.equal(plan.kind, 'move');
  if (plan.kind !== 'move') return;
  assert.equal(plan.targetPoint.y, viewport.bottom);
  assert.equal(point.y - (plan.cameraCenterPoint.y - viewport.height / 2), viewport.bottom);
  assert.equal(plan.displacement.x, 0);
  assert.equal('zoom' in plan, false);
});

test('a visible selected pin does not continuously recenter', () => {
  assert.deepEqual(planSelectedMarkerOcclusion({ point: viewport.center, viewport }), { kind: 'none', reason: 'visible' });
  assert.deepEqual(planSelectedMarkerOcclusion({ point: { x: viewport.left - 0.25, y: viewport.bottom + 0.25 }, viewport }),
    { kind: 'none', reason: 'visible' });
});

test('changing card height, large text and keyboard overlap cause only required translation', () => {
  let point = { ...viewport.center };
  for (const bottom of [350, 480, 530]) {
    const next = mapUsableViewport({ width: 390, height: 844, top: 144, bottom });
    const plan = planSelectedMarkerOcclusion({ point, viewport: next });
    if (plan.kind === 'move') point = plan.targetPoint;
    assert.ok(point.y <= next.bottom);
    assert.equal(planSelectedMarkerOcclusion({ point, viewport: next }).kind, 'none');
  }
});

test('side overlays and orientation changes correct horizontal occlusion too', () => {
  const landscape = mapUsableViewport({ width: 844, height: 390, left: 270, top: 60, bottom: 90 });
  const plan = planSelectedMarkerOcclusion({ point: { x: 150, y: 300 }, viewport: landscape });
  assert.equal(plan.kind, 'move');
  if (plan.kind !== 'move') return;
  assert.equal(plan.targetPoint.x, landscape.left);
  assert.equal(plan.targetPoint.y, landscape.bottom);
});

test('deliberate selected-place navigation can center in the visible map', () => {
  const plan = planSelectedMarkerOcclusion({ point: { x: 36, y: 180 }, viewport, forceCenter: true });
  assert.equal(plan.kind, 'move');
  if (plan.kind === 'move') assert.deepEqual(plan.targetPoint, viewport.center);
});

test('native projected correction works under a rotated affine camera', () => {
  // A native point already contains the rotation. Recenter by unprojecting the
  // shifted screen center; do not turn pixels into a hardcoded latitude offset.
  const angle = 0.7;
  const project = (coordinate: { x: number; y: number }, center: { x: number; y: number }) => ({
    x: 195 + (coordinate.x - center.x) * Math.cos(angle) - (coordinate.y - center.y) * Math.sin(angle),
    y: 422 + (coordinate.x - center.x) * Math.sin(angle) + (coordinate.y - center.y) * Math.cos(angle),
  });
  const unproject = (point: { x: number; y: number }) => ({
    x: (point.x - 195) * Math.cos(angle) + (point.y - 422) * Math.sin(angle),
    y: -(point.x - 195) * Math.sin(angle) + (point.y - 422) * Math.cos(angle),
  });
  const marker = { x: 100, y: 300 };
  const plan = planSelectedMarkerOcclusion({ point: project(marker, { x: 0, y: 0 }), viewport });
  assert.equal(plan.kind, 'move');
  if (plan.kind !== 'move') return;
  const actual = project(marker, unproject(plan.cameraCenterPoint));
  assert.ok(Math.abs(actual.x - plan.targetPoint.x) < 1e-8);
  assert.ok(Math.abs(actual.y - plan.targetPoint.y) < 1e-8);
});

test('invalid native projection and no available map area fail without movement', () => {
  assert.deepEqual(planSelectedMarkerOcclusion({ point: { x: NaN, y: 100 }, viewport }),
    { kind: 'none', reason: 'invalid_projection' });
  assert.deepEqual(planSelectedMarkerOcclusion({ point: { x: 20, y: 100 }, viewport: mapUsableViewport({ width: 0, height: 0 }) }),
    { kind: 'none', reason: 'unmeasured_viewport' });
});

test('dismiss/reopen rejects stale selection projection and gives the new selection ownership', () => {
  const requested = { requestedSelectionId: 'saved-a', requestedCameraRevision: 4, currentCameraRevision: 4, userHasMoved: false };
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentSelectionId: null }), false);
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentSelectionId: 'saved-b' }), false);
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentSelectionId: 'saved-a' }), true);
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentSelectionId: 'saved-a',
    requestedSelectionRevision: 1, currentSelectionRevision: 3 }), false,
  'reopening the same saved ID invalidates a projection from its previous card');
});

test('gesture during a camera animation cancels ownership and async pin corrections', () => {
  const coordinator = new MapCameraTransactionCoordinator();
  const transaction = coordinator.start({ reason: 'programmatic_focus', startedAt: 1, startingViewportRevision: 1 });
  assert.ok(transaction);
  coordinator.commandIssued(transaction!.id);
  coordinator.cancelActive('user_gesture');
  assert.equal(coordinator.active(), null);
  assert.equal(coordinator.settle(transaction!.id), null);
  const requested = { requestedSelectionId: 'saved-a', currentSelectionId: 'saved-a', requestedCameraRevision: 4 };
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentCameraRevision: 5, userHasMoved: true }), false);
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentCameraRevision: 5, userHasMoved: false }), false);
  assert.equal(canApplySelectedMarkerCorrection({ ...requested, currentCameraRevision: 4, userHasMoved: true }), false);
});

console.log(`PASS map viewport geometry: ${passed.length}/${passed.length}`);
for (const name of passed) console.log(`  ${name}`);
