import assert from 'node:assert/strict';
import path from 'node:path';
import React from 'react';

// The real hook and component, with deterministic native/animation boundaries.
// These are lifecycle contracts, not native frame or haptic measurements.
const Module = require('node:module');
const originalLoad = Module._load;
type Read = { resolve: (value: boolean) => void; reject: () => void };
const reads: Read[] = [];
const listeners = new Set<(value: boolean) => void>();
const appState = { currentState: 'active' };
const animations: Array<{ duration: number; started: boolean; stopped: boolean }> = [];
class AnimatedValue {
  constructor(public value: number) {}
  setValue(value: number) { this.value = value; }
  interpolate(config: unknown) { return config; }
}
Module._load = function(request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') return {
    AppState: appState, Text: 'Text', View: 'View',
    StyleSheet: { create: (styles: unknown) => styles },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => new Promise<boolean>((resolve, reject) => reads.push({ resolve, reject: () => reject(new Error('unavailable')) })),
      addEventListener: (_name: string, listener: (value: boolean) => void) => {
        listeners.add(listener); return { remove: () => listeners.delete(listener) };
      },
    },
    Animated: { View: 'Animated.View', Value: AnimatedValue, timing: (_value: unknown, config: { duration: number }) => {
      const entry = { duration: config.duration, started: false, stopped: false };
      animations.push(entry);
      return { start: () => { entry.started = true; }, stop: () => { entry.stopped = true; } };
    } },
  };
  if (request === '@expo/vector-icons') return { Feather: 'Feather' };
  if (request === '@/lib/theme') return { useTheme: () => ({ colors: { brand: '#FF9957', surface: '#FFFDF8', primary: '#263A32' } }) };
  if (request === '@/lib/useReduceMotion') return originalLoad(path.resolve(__dirname, '../lib/useReduceMotion.ts'), parent, isMain);
  return originalLoad(request, parent, isMain);
};
const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');
const { SaveArrival } = require('../components/SaveArrival.tsx');
type Renderer = ReturnType<typeof TestRenderer.create>;
const render = async (identity: string) => {
  let tree!: Renderer;
  await TestRenderer.act(async () => { tree = TestRenderer.create(React.createElement(SaveArrival, { identity })); });
  return tree;
};
const update = (tree: Renderer, identity: string | null) => TestRenderer.act(() => tree.update(React.createElement(SaveArrival, { identity })));
const emit = (value: boolean) => TestRenderer.act(() => listeners.forEach(listener => listener(value)));
const unmount = (tree: Renderer) => TestRenderer.act(() => tree.unmount());

async function main() {
  const regular = await render('save-a');
  assert.equal(regular.toJSON(), null, 'pending preference has no arrival visuals');
  assert.equal(animations.length, 0, 'conservative initial state does not consume or animate the identity');
  await TestRenderer.act(async () => reads[0].resolve(false));
  assert.equal(animations.length, 1);
  assert.equal(animations[0].duration, 780);
  assert.equal(animations[0].started, true);
  assert.equal(animations[0].stopped, false, 'preference resolution starts rather than cancels arrival');
  assert.equal(regular.root.findAllByProps({ testID: 'save-arrival-ring' }).length, 1);
  update(regular, 'save-a');
  assert.equal(animations.length, 1, 'ordinary rerender does not replay');
  emit(true);
  assert.equal(animations[0].stopped, true, 'live Reduce Motion change cancels in-flight choreography');
  assert.equal(animations.length, 1, 'live preference changes do not replay consumed saves');
  assert.equal(regular.root.findAllByProps({ testID: 'save-arrival-ring' }).length, 0);
  assert.equal(regular.root.findAllByProps({ testID: 'save-arrival-spark' }).length, 0);
  emit(false);
  assert.equal(animations.length, 1);
  update(regular, 'save-b');
  assert.equal(animations.length, 2, 'a new saved identity gets one arrival');
  update(regular, null);
  update(regular, 'save-a');
  assert.equal(animations.length, 2, 'an older identity is not replayed after clearing the cue');
  unmount(regular);

  const reduced = await render('reduced-a');
  await TestRenderer.act(async () => reads[1].resolve(true));
  assert.equal(animations.length, 3);
  assert.equal(animations[2].duration, 220, 'reduced motion has only a short opacity cue');
  assert.equal(reduced.root.findAllByProps({ testID: 'save-arrival-ring' }).length, 0);
  assert.equal(reduced.root.findAllByProps({ testID: 'save-arrival-spark' }).length, 0);
  const pin = reduced.root.findByType('Feather' as any).parent!;
  assert.deepEqual(pin.props.style[1].transform, [{ translateY: 0 }, { scale: 1 }], 'reduced pin has no translation, pulse or scale');
  unmount(reduced);

  const raced = await render('pending-a');
  update(raced, 'pending-b');
  emit(true);
  assert.equal(animations.length, 4, 'latest identity waits for the first known setting');
  await TestRenderer.act(async () => reads[2].resolve(false));
  assert.equal(animations.length, 4, 'late initial read cannot override a newer accessibility event');
  assert.equal(raced.root.findAllByProps({ testID: 'save-arrival-spark' }).length, 0);
  unmount(raced);

  const failed = await render('failed-setting');
  await TestRenderer.act(async () => reads[3].reject());
  assert.equal(animations.length, 5);
  assert.equal(animations[4].duration, 220, 'setting failure resolves conservatively instead of hanging');
  unmount(failed);

  appState.currentState = 'background';
  const background = await render('background-save');
  await TestRenderer.act(async () => reads[4].resolve(false));
  assert.equal(animations.length, 5, 'background saves do not animate');
  appState.currentState = 'active';
  emit(true);
  assert.equal(animations.length, 5, 'background identities are not replayed after a preference change');
  unmount(background);

  const abandoned = await render('unmounted-save');
  unmount(abandoned);
  await TestRenderer.act(async () => reads[5].resolve(false));
  assert.equal(animations.length, 5, 'late settings resolution after unmount cannot animate');
  assert.equal(listeners.size, 0, 'all preference subscriptions clean up');
  console.log('PASS SaveArrival real hook/component: readiness, one-shot identities, setting race/error, live Reduce Motion, background and unmount cleanup');
}
main().finally(() => { Module._load = originalLoad; }).catch(error => { console.error(error); process.exitCode = 1; });
