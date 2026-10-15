import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import ts from 'typescript';
import * as geometry from '../lib/mapViewportGeometry';
import { MapCameraTransactionCoordinator } from '../lib/mapCameraTransaction';

/**
 * Mount the actual map screen's camera callback/effect with native host mocks.
 * AST extraction avoids duplicating the policy being tested. This is a React
 * integration test of the production closures, not a native MapKit renderer.
 */
const sourceRoot = process.env.NEARR_QA_SOURCE_ROOT ?? path.resolve(__dirname, '..');
const source = readFileSync(path.join(sourceRoot, 'app/(tabs)/map.tsx'), 'utf8');
const ast = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const snippets: Record<string, string> = {};
const visit = (node: ts.Node) => {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && declaration.name.text === 'fitVisiblePlaces')) {
    snippets.fit = node.getText(ast);
  }
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && declaration.name.text === 'previewPanResponder')) {
    snippets.pan = node.getText(ast);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'focusZone') snippets.focus = node.getText(ast);
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('pointForCoordinate')) {
    snippets.correction = node.getText(ast);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
for (const name of ['fit', 'focus', 'correction', 'pan']) assert.ok(snippets[name], `${name} production closure was found`);

const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
type Saved = { id: string; place: { latitude: number; longitude: number } };
const place = (id: string, latitude = 34, longitude = -118): Saved => ({ id, place: { latitude, longitude } });
const calls: Array<{ method: string; args: any[] }> = [];
let scope: any;
let api: any;
let tree: ReturnType<typeof TestRenderer.create> | null = null;
let projected = { x: 195, y: 720 };
let deferProjection = false;
const pendingProjections: Array<(point: { x: number; y: number }) => void> = [];
const inert = () => undefined;

function reset(selected: Saved | null = null) {
  calls.length = 0;
  pendingProjections.length = 0;
  deferProjection = false;
  projected = { x: 195, y: 720 };
  const coordinator = new MapCameraTransactionCoordinator();
  scope = {
    selected,
    selectedRef: { current: selected },
    mapReady: true,
    selectedCardHeight: 200,
    mapGroupSelectorHeight: 200,
    mapGroupRequest: null,
    explorerCarouselHeight: 0,
    Spacing: { lg: 20 },
    sourceGroupBrowseActive: false,
    explorerSavedDetailOpen: false,
    usableMapViewport: geometry.mapUsableViewport({ width: 390, height: 844, top: 144, bottom: 300 }),
    nearbyExplorer: null,
    selectionUserMovedRef: { current: false },
    cameraTransactionCoordinatorRef: { current: coordinator },
    selectedCorrectionKeyRef: { current: '' },
    showAllRequestKeyRef: { current: '' },
    selectionCorrectionRequestRef: { current: 0 },
    selectedCorrectionRequestRef: { current: 0 },
    selectionFocusRequestRef: { current: 0 },
    selectionFocusRequest: 0,
    previewExpanded: false,
    previewExpandedRef: { current: false },
    previewTranslateY: { setValue: inert, stopAnimation: inert },
    dismissSelectedPlace: () => scope.setSelected(null),
    PanResponder: { create: (configuration: unknown) => configuration },
    Animated: { spring: (_value: unknown, options: any) => {
      calls.push({ method: 'spring', args: [options] });
      return { start: inert };
    } },
    cameraRevisionRef: { current: 1 },
    viewportSnapshot: { viewportRevision: 1 },
    reduceMotion: false,
    mapPlaces: [place('a'), place('b', 35, -117)],
    filterEligiblePlaces: [place('a')],
    mapAreaWidth: 390,
    windowWidth: 390,
    availableHeight: 844,
    topChromeBottom: 144,
    queueChromeBottom: 190,
    safeTopInset: 44,
    insets: { bottom: 34 },
    followModeRef: { current: true },
    didFitRef: { current: false },
    resetClusterExpansionRef: { current: inert },
    Keyboard: { dismiss: () => calls.push({ method: 'keyboardDismiss', args: [] }) },
    hapticSelection: () => calls.push({ method: 'haptic', args: [] }),
    showSnackbar: (message: string) => calls.push({ method: 'snackbar', args: [message] }),
    setFollowMode: (value: boolean) => { scope.followMode = value; },
    setSelected: (value: Saved | null) => { scope.selected = value; scope.selectedRef.current = value; },
    setPreviewExpanded: (value: boolean) => { scope.previewExpanded = value; },
    setSheetMinimizeSignal: inert,
    setMapCategoryFilter: (value: string) => { scope.mapCategoryFilter = value; },
    setSelectionFocusRequest: (value: number | ((previous: number) => number)) => {
      scope.selectionFocusRequest = typeof value === 'function' ? value(scope.selectionFocusRequest) : value;
    },
    MAP_FILTER_ALL: 'all',
    __DEV__: false,
    ...geometry,
  };
  scope.beginCameraMovement = (_source: string, options: any) => {
    const transaction = coordinator.start({ reason: options.reason, startedAt: Date.now(), startingViewportRevision: scope.viewportSnapshot.viewportRevision });
    if (!transaction) return false;
    coordinator.commandIssued(transaction.id);
    scope.cameraRevisionRef.current += 1;
    return true;
  };
  scope.mapRef = { current: {
    pointForCoordinate: async (_coordinate: unknown) => deferProjection
      ? new Promise(resolve => pendingProjections.push(resolve)) : { ...projected },
    coordinateForPoint: async (point: { x: number; y: number }) => ({ latitude: 50 - point.y / 100, longitude: point.x / 100 }),
    animateCamera: (...args: any[]) => {
      calls.push({ method: 'animateCamera', args });
      const point = { x: args[0].center.longitude * 100, y: (50 - args[0].center.latitude) * 100 };
      projected = { x: projected.x - (point.x - 195), y: projected.y - (point.y - 422) };
    },
    fitToCoordinates: (...args: any[]) => calls.push({ method: 'fitToCoordinates', args }),
    animateToRegion: (...args: any[]) => calls.push({ method: 'animateToRegion', args }),
  } };
}

// Rebuild the harness per scenario so every external binding is the real
// closure's value at that render, matching normal React render semantics.
function Harness({ revision }: { revision: number }) {
  void revision;
  const bindings = Object.keys(scope);
  const body = `const {useCallback,useEffect,useMemo} = React; const {${bindings.join(',')}} = scope;\n` +
    `${snippets.fit}\n${snippets.focus}\n${snippets.correction}\n${snippets.pan}\n capture({fitVisiblePlaces,focusZone,previewPanResponder}); return null;`;
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('React', 'scope', 'capture', compiled)(React, scope, (next: any) => { api = next; });
}
let revision = 0;
async function render() {
  await TestRenderer.act(async () => {
    if (tree) tree.update(React.createElement(Harness, { revision: ++revision }));
    else tree = TestRenderer.create(React.createElement(Harness, { revision: ++revision }));
  });
}
async function unmount() {
  if (tree) await TestRenderer.act(async () => tree!.unmount());
  tree = null;
}
const commandCalls = () => calls.filter(call => ['animateCamera', 'fitToCoordinates', 'animateToRegion'].includes(call.method));
function settle() {
  const coordinator = scope.cameraTransactionCoordinatorRef.current;
  if (coordinator.active()) coordinator.settle(coordinator.active().id);
  scope.viewportSnapshot = { viewportRevision: scope.viewportSnapshot.viewportRevision + 1 };
}

async function main() {
  reset();
  await render();
  await TestRenderer.act(async () => api.fitVisiblePlaces());
  assert.equal(commandCalls().length, 1);
  assert.equal(commandCalls()[0].method, 'animateToRegion', 'filtered singleton uses deterministic region');
  await TestRenderer.act(async () => { api.fitVisiblePlaces(); api.fitVisiblePlaces(); });
  assert.equal(commandCalls().length, 1, 'rapid repeated Show All does not start competing native animations');
  assert.equal(scope.followModeRef.current, false);
  assert.equal(scope.selected, null);
  settle();
  await TestRenderer.act(async () => api.fitVisiblePlaces(true));
  assert.equal(commandCalls().at(-1)!.method, 'fitToCoordinates', 'All Places uses native measured bounds');
  assert.deepEqual(commandCalls().at(-1)!.args[0], scope.mapPlaces.map((saved: Saved) => saved.place));
  assert.equal(scope.mapCategoryFilter, 'all');
  assert.equal(commandCalls().at(-1)!.args[1].edgePadding.top, 230);
  assert.equal(commandCalls().at(-1)!.args[1].edgePadding.bottom, 208);
  scope.mapPlaces = [];
  await render();
  const beforeEmpty = commandCalls().length;
  await TestRenderer.act(async () => api.fitVisiblePlaces(true));
  assert.equal(commandCalls().length, beforeEmpty, 'zero valid coordinates leave current camera intact');
  assert.match(calls.at(-1)!.args[0], /No saved map locations/);
  await unmount();

  for (const mode of ['source-group', 'nearby-explorer']) {
    reset();
    const overlayHeight = 320;
    if (mode === 'source-group') {
      scope.mapGroupRequest = { savedPlaceIds: ['a', 'b'] };
      scope.mapGroupSelectorHeight = overlayHeight;
    } else {
      scope.nearbyExplorer = { sessionId: 'explorer' };
      scope.explorerCarouselHeight = overlayHeight;
    }
    await render();
    await TestRenderer.act(async () => api.fitVisiblePlaces(true));
    assert.equal(commandCalls()[0].method, 'fitToCoordinates');
    assert.ok(commandCalls()[0].args[1].edgePadding.bottom >= overlayHeight + scope.insets.bottom + 40,
      `${mode} Show All clears its retained measured bottom overlay`);
    await unmount();
  }

  reset();
  scope.mapPlaces = [place('east', -16, 179.6), place('west', -17, -179.7)];
  scope.reduceMotion = true;
  await render();
  await TestRenderer.act(async () => api.fitVisiblePlaces(true));
  assert.equal(commandCalls()[0].method, 'animateToRegion', 'date-line fit bypasses native unwrapped polyline bounds');
  assert.ok(Math.abs(commandCalls()[0].args[0].longitude) > 179);
  assert.equal(commandCalls()[0].args[1], 0, 'Reduce Motion removes region animation');
  await unmount();

  reset(place('selected'));
  scope.selectedCardHeight = 0;
  await render();
  assert.equal(commandCalls().length, 0, 'selection waits for measured card height');
  scope.selectedCardHeight = 200;
  await render();
  assert.equal(commandCalls().length, 1, 'measured card produces one native center correction');
  assert.equal(commandCalls()[0].method, 'animateCamera');
  assert.deepEqual(Object.keys(commandCalls()[0].args[0]), ['center'], 'selection preserves zoom, heading and pitch');
  assert.ok(Math.abs(projected.y - scope.usableMapViewport.bottom) < 1e-7);
  settle();
  await render();
  assert.equal(commandCalls().length, 1, 'settled viewport cannot loop its own correction');
  scope.previewExpanded = true;
  scope.usableMapViewport = geometry.mapUsableViewport({ width: 390, height: 844, top: 100, bottom: 500 });
  await render();
  assert.equal(commandCalls().length, 2, 'expanded card adjusts occlusion once');
  settle();
  scope.setSelected(null);
  await render();
  assert.equal(commandCalls().length, 2, 'dismiss does not move camera');
  await unmount();

  reset(place('group-member'));
  scope.sourceGroupBrowseActive = true;
  scope.selectedCardHeight = 0;
  scope.mapGroupSelectorHeight = 0;
  await render();
  assert.equal(commandCalls().length, 0, 'source group waits for its own measured carousel');
  scope.mapGroupSelectorHeight = 220;
  await render();
  assert.equal(commandCalls().length, 1, 'source group correction does not depend on an unmounted selected card');
  await unmount();

  reset(place('explorer-saved'));
  scope.nearbyExplorer = { sessionId: 'explorer' };
  await render();
  assert.equal(commandCalls().length, 0, 'ordinary Nearby Explorer keeps its own camera owner');
  scope.explorerSavedDetailOpen = true;
  scope.previewExpanded = true;
  scope.reduceMotion = true;
  await render();
  assert.equal(commandCalls().length, 1, 'expanded saved details in Explorer protect the selected pin');
  assert.equal(commandCalls()[0].args[1].duration, 0, 'Reduce Motion disables selection camera animation');
  await unmount();

  reset(place('selected'));
  deferProjection = true;
  await render();
  assert.equal(pendingProjections.length, 1);
  scope.selectionUserMovedRef.current = true;
  scope.cameraRevisionRef.current += 1;
  await TestRenderer.act(async () => pendingProjections[0]({ x: 195, y: 720 }));
  assert.equal(commandCalls().length, 0, 'gesture retires an in-flight native projection');
  scope.usableMapViewport = geometry.mapUsableViewport({ width: 390, height: 844, top: 100, bottom: 500 });
  await render();
  assert.equal(pendingProjections.length, 1, 'later layout changes cannot reclaim camera after user pans');
  await unmount();

  reset(place('same'));
  deferProjection = true;
  await render();
  scope.setSelected(null);
  await render();
  scope.setSelected(place('same'));
  await TestRenderer.act(async () => api.focusZone(scope.selected));
  await render();
  assert.equal(pendingProjections.length, 2);
  await TestRenderer.act(async () => pendingProjections[0]({ x: 195, y: 720 }));
  assert.equal(commandCalls().length, 0, 'old same-ID projection cannot affect reopened card');
  deferProjection = false;
  await TestRenderer.act(async () => pendingProjections[1]({ x: 195, y: 720 }));
  assert.equal(commandCalls().length, 1);
  await unmount();

  reset(place('recoverable-camera-error'));
  const successfulAnimation = scope.mapRef.current.animateCamera;
  scope.mapRef.current.animateCamera = () => { throw new Error('native camera temporarily unavailable'); };
  await render();
  assert.equal(scope.cameraTransactionCoordinatorRef.current.active(), null, 'failed native command releases its transaction');
  assert.equal(scope.selectedCorrectionKeyRef.current, '', 'failed command does not consume correction key');
  scope.mapRef.current.animateCamera = successfulAnimation;
  settle();
  await render();
  assert.equal(commandCalls().length, 1, 'native readback/layout can retry after failure');
  await unmount();

  reset(place('camera-error-after-new-owner'));
  scope.mapRef.current.animateCamera = () => {
    const coordinator = scope.cameraTransactionCoordinatorRef.current;
    coordinator.cancelActive('new_explicit_navigation');
    const transaction = coordinator.start({ reason: 'show_all', startedAt: Date.now(), startingViewportRevision: 1 });
    coordinator.commandIssued(transaction.id);
    throw new Error('old animation rejected');
  };
  await render();
  assert.equal(scope.cameraTransactionCoordinatorRef.current.active()?.reason, 'show_all',
    'old selection error cannot cancel a newer camera owner');
  await unmount();

  reset(place('expand-after-pan'));
  scope.selectionUserMovedRef.current = true;
  scope.reduceMotion = true;
  await render();
  await TestRenderer.act(async () => api.previewPanResponder.onPanResponderRelease({}, { dy: -70, dx: 0 }));
  assert.equal(scope.selectionUserMovedRef.current, false, 'deliberate upward expansion reclaims selected-pin visibility');
  assert.equal(scope.previewExpanded, true);
  assert.equal(calls.filter(call => call.method === 'spring').length, 0, 'Reduce Motion makes expansion settling immediate');
  scope.reduceMotion = false;
  await render();
  await TestRenderer.act(async () => api.previewPanResponder.onPanResponderTerminate());
  assert.equal(calls.find(call => call.method === 'spring')?.args[0].bounciness, 0, 'gesture interruption does not introduce bounce');
  await unmount();

  const cameraCalls: ts.CallExpression[] = [];
  const inspectMotion = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['animateCamera', 'animateToRegion', 'fitToCoordinates'].includes(node.expression.name.text)) cameraCalls.push(node);
    ts.forEachChild(node, inspectMotion);
  };
  inspectMotion(ast);
  assert.ok(cameraCalls.length >= 10, 'full map camera command inventory inspected');
  for (const call of cameraCalls) {
    assert.match(call.arguments[1]?.getText(ast) ?? '', /reduceMotion(?:Ref\.current)?/,
      `${call.expression.getText(ast)} must honor current Reduce Motion preference`);
  }
  console.log('PASS Fieldnotes map camera React integration: actual source closures; filtered/All/empty/date-line/repeat fits, measured padding, Reduce Motion, deferred measurement, one correction, expansion/dismissal, source-group and Explorer detail, gesture cancellation, same-ID reopen, native-error retry, newer-owner protection, expansion after pan, and all camera motion gates');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(unmount);
