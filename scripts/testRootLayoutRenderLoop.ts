/**
 * scripts/testRootLayoutRenderLoop.ts
 *
 * Startup-safety contract for the root layout. Two separate production
 * incidents converge on this file, and this test exists so neither can come
 * back quietly.
 *
 * ---------------------------------------------------------------------------
 * 1. The indefinite black screen (production, rolled back)
 * ---------------------------------------------------------------------------
 * `ff2cbbe` ("a tapped notification owns the screen it lands on") gave
 * notification handling its own root-navigation ownership layer: a parked
 * intent, a readiness gate, a transient-route `dismissAll()`, and a
 * `lib/notificationNavigation` planner. Shipped by OTA it produced a startup
 * black screen; production was rolled back and `f41ea4a` reverted it.
 *
 * The revert is the behaviour the user physically validated, so the
 * production-safe architecture is the one asserted here:
 *
 *   ONE navigation authority (AuthGate) decides where startup lands.
 *   Notification response capture lives in a renderless child controller.
 *   Its bounded intent queue never owns root state, never gates rendering,
 *   and never dismisses the stack out from under the navigator.
 *
 * ---------------------------------------------------------------------------
 * 2. The development render loop (Maximum update depth exceeded)
 * ---------------------------------------------------------------------------
 * The same reverted commit also introduced `useRootNavigationState()` into
 * RootLayoutContent. In expo-router 3.5 that hook subscribes to the store's
 * `rootState` snapshot, which `updateState` assigns UNCONDITIONALLY while
 * `routeInfo` is deepEqual-guarded:
 *
 *   updateState(state) {
 *     store.rootState = state;                                       // no guard
 *     if (!deepEqual(this.routeInfo, next)) store.routeInfo = next;  // guarded
 *   }
 *
 * `syncStoreRootState()` runs during RENDER and reassigns `rootState` whenever
 * `navigationRef.getRootState()` yields a fresh object, so useSyncExternalStore
 * saw a new snapshot identity between render and commit, re-rendered, and ran
 * the sync again. That asymmetry is why AuthGate -- which reads only the
 * guarded `routeInfo` via useSegments/usePathname -- stayed stable and never
 * appeared in the reported component stack.
 *
 * Reverting (1) removes (2) as a side effect, because the hook came in with it.
 * Both are asserted independently so a future change cannot reintroduce one
 * without the other being noticed.
 *
 * This is a source-contract test (same pattern as testAuthScreenContracts /
 * testShareRoutes): there is no React renderer in this repo, and both defects
 * are structural choices visible in the source.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testRootLayoutRenderLoop.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const LAYOUT_PATH = path.join(REPO_ROOT, 'app', '_layout.tsx');
const CONTROLLER_PATH = path.join(REPO_ROOT, 'components', 'NotificationTapController.tsx');

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/**
 * Strip comments so the prose above a rule cannot satisfy the rule.
 *
 * Split on /\r?\n/, not '\n': this repo checks out CRLF on Windows, and a
 * trailing '\r' stops `$` in /\/\/.*$/ from anchoring, which silently leaves
 * every line comment in place.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const layoutCode = code(readFileSync(LAYOUT_PATH, 'utf8'));
const controllerCode = code(readFileSync(CONTROLLER_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// 1. The reverted notification-ownership architecture must stay reverted.
// ---------------------------------------------------------------------------
// These are the load-bearing symbols of ff2cbbe. Their ABSENCE is the contract:
// production was rolled back to a build without them, and that is the build the
// user physically validated.

const REVERTED_OWNERSHIP_SYMBOLS = [
  'planNotificationNavigation',
  'takePendingNotificationNavigation',
  'setPendingNotificationNavigation',
  'clearPendingNotificationNavigation',
  'claimUiForNotification',
  'flushPendingNotificationNavigation',
  'runNotificationNavigation',
  'createNotificationOpenIntent',
  'notificationOwnsVisibleSurface',
];

for (const symbol of REVERTED_OWNERSHIP_SYMBOLS) {
  check(
    `reverted notification-ownership symbol absent: ${symbol}`,
    !layoutCode.includes(symbol),
    'ff2cbbe caused a production black screen and was reverted by f41ea4a; ' +
      'do not reintroduce the ownership layer',
  );
}

check(
  'the notificationNavigation module is not imported by the root layout',
  !/notificationNavigation/.test(layoutCode),
);
check(
  'lib/notificationNavigation.ts does not exist',
  !existsSync(path.join(REPO_ROOT, 'lib', 'notificationNavigation.ts')),
  'the planner module was deleted by the revert',
);

// A tapped notification must not tear the stack down before routing. The
// dismissAll() in ff2cbbe resolved against pre-dismissal state and stacked a
// second (tabs) navigator, which is how the Queue survived a Back gesture.
check(
  'the root layout does not dismiss the stack on a notification tap',
  !/dismissAll\s*\(/.test(layoutCode),
);
check(
  'the notification controller does not dismiss or reset the root stack',
  !/dismissAll\s*\(|resetRoot|navigation\.reset/.test(controllerCode),
);

// ---------------------------------------------------------------------------
// 2. The render loop must stay fixed.
// ---------------------------------------------------------------------------

check(
  'the root layout does not subscribe to expo-router rootState',
  !/useRootNavigationState\s*\(/.test(layoutCode),
  'useRootNavigationState() re-renders its subscriber on every navigation ' +
    'dispatch because expo-router assigns store.rootState unconditionally',
);
check(
  'useRootNavigationState is not imported by the root layout',
  !/\buseRootNavigationState\b/.test(layoutCode),
);

// The guarded route-info snapshot is fine and is what AuthGate relies on.
check(
  'route reads still go through the deepEqual-guarded snapshot',
  /useSegments\s*\(/.test(layoutCode),
);

// ---------------------------------------------------------------------------
// 3. Exactly one startup navigation authority.
// ---------------------------------------------------------------------------

check(
  'AuthGate still routes signed-out users to onboarding',
  /router\.replace\('\/\(onboarding\)'\)/.test(layoutCode),
);
check(
  'AuthGate still pulls signed-in users into the tabs',
  /router\.replace\('\/\(tabs\)\/map'\)/.test(layoutCode),
);

check(
  'RootLayout owns no notification response listener or cold-start retrieval',
  !/addNotificationResponseReceivedListener|getLastNotificationResponseAsync/.test(layoutCode),
);
check(
  'RootLayout owns no notification response or pending-intent state',
  !/lastNotificationResponse|pendingNotification|useRootNavigationState/.test(layoutCode),
);
check(
  'the renderless controller is mounted inside the existing auth shell',
  /<NotificationTapController\s+authReady=/.test(layoutCode),
);

// Notification taps still route from one isolated response controller. Its
// pending queue is non-rendering and AuthGate remains startup authority.
check(
  'notification responses are still handled',
  /addNotificationResponseReceivedListener/.test(controllerCode),
);
check(
  'cold-start notification responses are still read',
  /getLastNotificationResponseAsync/.test(controllerCode),
);
check(
  'notification action buttons still reach their handler',
  /handleNotificationAction/.test(controllerCode),
);
check(
  'notification routing cannot block root rendering',
  /return null;/.test(controllerCode) && !/return\s+<.*(?:Loading|ActivityIndicator)/s.test(controllerCode),
);

if (failures > 0) {
  console.error(`\n${failures} root-layout startup-safety test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll root-layout startup-safety tests passed.');
