import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';

const Module = require('node:module');
const originalLoad = Module._load;
let reducedMotion = false;
let springCalls = 0;
let pan: any;
class Value {
  constructor(public value: number) {}
  setValue(value: number) { this.value = value; }
  stopAnimation(callback?: (value: number) => void) { callback?.(this.value); }
}
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === '@/lib/i18n') return require('../lib/i18nEngine');
  if (request === '@/hooks/useLocale') return { useLocale: () => ({ locale: require('../lib/i18nEngine').i18n.language }) };

  if (request === 'react-native') return {
    Pressable: 'Pressable', Text: 'Text', View: 'View',
    Animated: { Value, View: 'AnimatedView', spring: (value: Value, config: { toValue: number }) => ({ start: () => { springCalls++; value.setValue(config.toValue); } }) },
    PanResponder: { create: (callbacks: unknown) => { pan = callbacks; return { panHandlers: { testPan: true } }; } },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === 'expo-router') return { useRouter: () => ({ push() {} }) };
  if (request === '@/lib/useReduceMotion') return { useReduceMotion: () => reducedMotion };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: {}, typography: {} }) };
  if (request === './SavedPlacesLibrary') return { MemoizedSavedPlacesLibrary: 'SavedLibrary' };
  if (request === './ShareQueueButton') return { ShareQueueButton: 'ShareQueueButton' };
  if (request.startsWith('@/')) return originalLoad(path.resolve(__dirname, '..', request.slice(2)), parent, isMain);
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { MapBottomSheet, getSheetPartialHeight } = require('../components/map/MapBottomSheet');
async function main() {
  let assertions = 0;
  for (reducedMotion of [false, true]) {
    for (const count of [0, 1, 3, 5, 20, 125]) {
      const snaps: Array<[string, number]> = [];
      const places = Array.from({ length: count }, (_, i) => ({ id: `saved-${i}` }));
      let selected: unknown;
      let savedRequests = 0;
      const props: any = {
        mode: 'nearby', loading: false, nearbyPlaces: [], recentPlaces: [], savedPlaces: places,
        locationState: 'unavailable', partialHeight: 144, availableHeight: 700, topInset: 80, bottomInset: 70,
        onSnapChange: (snap: string, height: number) => snaps.push([snap, height]),
        onRequestSavedMode: () => savedRequests++, onSelectPlace: (place: unknown) => { selected = place; },
        onGetDirections() {}, onSaveFromLink() {}, onSearchManually() {}, requestLocationPermission: async () => false,
      };
      const beforeSprings = springCalls;
      let renderer!: ReturnType<typeof TestRenderer.create>;
      await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(MapBottomSheet, props)); });
      assert.deepEqual(snaps.at(-1), ['partial', 144]); assertions++;
      assert.equal(renderer.root.findAllByType('SavedLibrary' as any).length, 0, 'collapsed library cannot intercept map scroll'); assertions++;
      const handle = () => renderer.root.findAllByType('Pressable' as any).find((node) => ['Open saved places', 'Return to map'].includes(node.props.accessibilityLabel))!;
      await TestRenderer.act(async () => handle().props.onPress());
      assert.deepEqual(snaps.at(-1), ['full', 550], 'full height accounts for header and dock'); assertions++;
      assert.equal(savedRequests, 1); assertions++;
      const library = renderer.root.findByType('SavedLibrary' as any);
      assert.equal(library.props.savedPlaces, places); assertions++;
      if (count) { library.props.onSelectPlace(places[0]); assert.equal(selected, places[0]); assertions++; }
      await TestRenderer.act(async () => handle().props.onPress());
      assert.deepEqual(snaps.at(-1), ['partial', 144]); assertions++;
      await TestRenderer.act(async () => renderer.update(React.createElement(MapBottomSheet, { ...props, minimizeSignal: 1 })));
      assert.deepEqual(snaps.at(-1), ['minimized', 58]); assertions++;
      await TestRenderer.act(async () => renderer.update(React.createElement(MapBottomSheet, { ...props, mode: 'saved', minimizeSignal: 1, openSignal: 1 })));
      assert.deepEqual(snaps.at(-1), ['full', 550]); assertions++;
      assert.equal(pan.onMoveShouldSetPanResponder(null, { dx: 30, dy: 2 }), false, 'header does not steal horizontal gestures'); assertions++;
      assert.equal(pan.onMoveShouldSetPanResponder(null, { dx: 2, dy: 30 }), true); assertions++;
      await TestRenderer.act(async () => renderer.update(React.createElement(MapBottomSheet, { ...props, mode: 'saved', minimizeSignal: 1, openSignal: 1, availableHeight: 600 })));
      assert.deepEqual(snaps.at(-1), ['full', 450], 'orientation/viewport changes retain snap, recompute obstruction'); assertions++;
      assert.equal(springCalls > beforeSprings, !reducedMotion, 'Reduce Motion eliminates sheet animation'); assertions++;
      await TestRenderer.act(async () => renderer.unmount());
    }
  }
  assert.ok(getSheetPartialHeight(568, 2.2, true) <= 568 * 0.4 + 1); assertions++;
  console.log(`PASS Saved sheet ${assertions} assertions: 0/1/3/5/20/125 places, open/collapse/minimize/reopen, exact selection, viewport changes, gesture ownership and Reduce Motion`);
}
main().finally(() => { Module._load = originalLoad; }).catch((error) => { console.error(error); process.exitCode = 1; });
