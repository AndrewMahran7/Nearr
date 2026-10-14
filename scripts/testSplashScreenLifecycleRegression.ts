import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createSplashLifecycleController,
  MISSING_NATIVE_SPLASH_MESSAGE,
  type SplashLifecycleEvent,
} from '../lib/splashLifecycleCore';

const root = path.resolve(__dirname, '..');
let count = 0;

function pass(name: string) {
  count += 1;
  console.log(`PASS ${count}: ${name}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const preventGate = deferred<boolean>();
  let preventCalls = 0;
  let hideCalls = 0;
  const events: SplashLifecycleEvent[] = [];
  const controller = createSplashLifecycleController({
    preventAutoHide: () => {
      preventCalls += 1;
      return preventGate.promise;
    },
    hide: async () => {
      hideCalls += 1;
      return true;
    },
    onEvent: (event) => events.push(event),
  });

  const firstPrevent = controller.begin();
  const secondPrevent = controller.begin();
  assert.strictEqual(firstPrevent, secondPrevent);
  assert.equal(preventCalls, 1);
  pass('splash prevent is called once per JS runtime');

  controller.begin();
  assert.equal(preventCalls, 1);
  assert.equal(events.filter((event) => event === 'prevent_replay').length, 2);
  pass('root remount reuses the process-level prevent promise');

  assert.equal(hideCalls, 0);
  preventGate.resolve(true);
  await firstPrevent;
  assert.equal(hideCalls, 0);
  await controller.hideWhenReady();
  assert.equal(hideCalls, 1);
  pass('hide waits for explicit root readiness and settled prevent');

  const firstHide = controller.hideWhenReady();
  const secondHide = controller.hideWhenReady();
  assert.strictEqual(firstHide, secondHide);
  await secondHide;
  assert.equal(hideCalls, 1);
  pass('hide replay is idempotent and safe');

  let unexpectedFailures = 0;
  let unhandledRejections = 0;
  const onUnhandled = () => { unhandledRejections += 1; };
  process.on('unhandledRejection', onUnhandled);
  const missingNativeController = createSplashLifecycleController({
    preventAutoHide: async () => {
      throw new Error(`${MISSING_NATIVE_SPLASH_MESSAGE} Call 'SplashScreen.show' first.`);
    },
    hide: async () => true,
    onUnexpectedError: () => { unexpectedFailures += 1; },
  });
  await missingNativeController.begin();
  await new Promise<void>((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unexpectedFailures, 0);
  assert.equal(unhandledRejections, 0);
  pass('missing native splash rejection is settled without an unhandled promise');

  const unknownFailureEvents: string[] = [];
  const unknownFailureController = createSplashLifecycleController({
    preventAutoHide: async () => { throw new Error('unexpected_native_failure'); },
    hide: async () => true,
    onUnexpectedError: (operation, error) => {
      unknownFailureEvents.push(`${operation}:${error instanceof Error ? error.message : 'unknown'}`);
    },
  });
  await unknownFailureController.begin();
  assert.deepEqual(unknownFailureEvents, ['prevent:unexpected_native_failure']);
  pass('unexpected native failures remain observable while their promises settle');

  await controller.begin();
  await controller.hideWhenReady();
  assert.deepEqual(controller.snapshot(), {
    preventCalls: 1,
    hideCalls: 1,
    preventStarted: true,
    hideStarted: true,
  });
  pass('auth transition and route replay cannot retrigger splash native calls');

  const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  const account = fs.readFileSync(path.join(root, 'app/(onboarding)/account.tsx'), 'utf8');
  assert.ok(entry.indexOf("import './lib/splashLifecycle'") < entry.indexOf("import 'expo-router/entry'"));
  assert.match(layout, /onLayout=\{handleRootLayout\}/);
  assert.match(layout, /hideNativeSplashWhenReady\(\)/);
  assert.doesNotMatch(account, /SplashScreen|splashLifecycle/);
  pass('splash ownership stays at bootstrap/root layout and outside auth navigation');

  await controller.begin();
  await controller.hideWhenReady();
  assert.equal(preventCalls, 1);
  assert.equal(hideCalls, 1);
  pass('app foreground replay cannot reset the completed splash lifecycle');

  let reloadPreventCalls = 0;
  let reloadHideCalls = 0;
  const reloadController = createSplashLifecycleController({
    preventAutoHide: async () => {
      reloadPreventCalls += 1;
      throw new Error(MISSING_NATIVE_SPLASH_MESSAGE);
    },
    hide: async () => {
      reloadHideCalls += 1;
      throw new Error(MISSING_NATIVE_SPLASH_MESSAGE);
    },
  });
  await reloadController.begin();
  await reloadController.hideWhenReady();
  assert.equal(reloadPreventCalls, 1);
  assert.equal(reloadHideCalls, 1);
  pass('OTA or JS reload tolerates an already-removed native splash controller');

  assert.equal(count, 10);
  console.log('Splash-screen lifecycle regression: 10/10 passed.');
}

void main();
