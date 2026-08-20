/**
 * scripts/testRootLayoutRenderLoop.ts
 *
 * Regression test for the root-layout infinite render loop seen on the first
 * isolated development build (2026-08-19):
 *
 *   Warning: Maximum update depth exceeded
 *     in RootLayoutContent
 *     in ThemeProvider
 *     in RootLayout
 *
 * MECHANISM (expo-router 3.5.x, verified in node_modules):
 *
 *   RouterStore.updateState(state) {
 *     store.rootState = state;                                     // UNGUARDED
 *     const next = store.getRouteInfo(state);
 *     if (!deepEqual(this.routeInfo, next)) store.routeInfo = next; // guarded
 *   }
 *
 *   useStoreRootState()  -> syncStoreRootState() during RENDER, then
 *                           useSyncExternalStore(..., rootStateSnapshot)
 *   useStoreRouteInfo()  -> syncStoreRootState() during RENDER, then
 *                           useSyncExternalStore(..., routeInfoSnapshot)
 *
 * `syncStoreRootState()` reassigns `rootState` whenever
 * `navigationRef.getRootState()` returns a fresh object -- which React
 * Navigation produces on every dispatch. So a component subscribed to the
 * ROOT STATE snapshot gets a new snapshot identity between render and commit,
 * useSyncExternalStore re-renders it, the sync runs again, and while startup
 * navigation is still churning that never settles.
 *
 * `routeInfo` is deepEqual-guarded, so `useSegments()` / `usePathname()` stay
 * stable. That asymmetry is exactly why AuthGate -- which uses only those --
 * was ABSENT from the reported component stack while RootLayoutContent, the
 * only `useRootNavigationState()` caller in the app, was present.
 *
 * The layout only ever needed one boolean ("can the navigator accept actions
 * yet?"), so it now reads that from the STABLE navigation container ref, which
 * carries no store subscription.
 *
 * This is a source-contract test (same pattern as testAuthScreenContracts /
 * testShareRoutes): there is no React renderer in this repo, and the defect is
 * a subscription choice that is visible and checkable in the source.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testRootLayoutRenderLoop.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const LAYOUT_PATH = path.join(REPO_ROOT, 'app', '_layout.tsx');
const layout = readFileSync(LAYOUT_PATH, 'utf8');

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
 * trailing '\r' makes `$` in /\/\/.*$/ fail to anchor, which silently leaves
 * every line comment in place.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const layoutCode = code(layout);

// ---- The unguarded subscription must not come back -------------------------

check(
  'the root layout does not subscribe to expo-router rootState',
  !/useRootNavigationState\s*\(/.test(layoutCode),
  'useRootNavigationState() re-renders its subscriber on every navigation dispatch ' +
    'because expo-router assigns store.rootState unconditionally; the root layout ' +
    'only needs a readiness boolean',
);
check(
  'useRootNavigationState is not imported by the root layout',
  !/\buseRootNavigationState\b/.test(layoutCode),
);

// ---- Readiness still exists, and comes from the stable ref -----------------

check(
  'readiness is derived from the navigation container ref',
  /useNavigationContainerRef\s*\(/.test(layoutCode),
);
check(
  'readiness uses isReady() rather than probing a state object',
  /\.isReady\s*\(\s*\)/.test(layoutCode),
);
check(
  'a navigationReady signal still exists for the parked cold-start intent',
  /navigationReady/.test(layoutCode),
  'the cold-start notification intent is replayed on readiness; removing the ' +
    'signal would strand it',
);

// ---- The latch is one-way ---------------------------------------------------
// Readiness is a genuine one-way transition: the navigator becomes ready and
// stays ready. Anything that sets it back to false would reopen the window the
// parked intent is waiting on.

check(
  'the readiness latch only ever transitions to true',
  !/setNavigationReady\s*\(\s*false\s*\)/.test(layoutCode),
);
check(
  'the readiness latch is initialised from the ref, not hardcoded true',
  /useState\s*\(\s*\(\s*\)\s*=>\s*navigationContainerRef\.isReady\s*\(\s*\)\s*,?\s*\)/.test(
    layoutCode.replace(/\s+/g, ' ').replace(/ /g, ' '),
  ) || /useState\([\s\S]{0,120}?isReady\(\)/.test(layoutCode),
  'starting at a hardcoded true would flush the parked intent before the ' +
    'navigator can accept actions',
);

// ---- The notification-navigation architecture is untouched ------------------
// This fix must not change WHAT happens when a notification is tapped, only
// how readiness is observed. These are the load-bearing pieces of that flow.

for (const marker of [
  'planNotificationNavigation',
  'takePendingNotificationNavigation',
  'setPendingNotificationNavigation',
  'claimUiForNotification',
  'flushPendingNotificationNavigation',
  'runNotificationNavigation',
]) {
  check(`notification-navigation flow still present: ${marker}`, layoutCode.includes(marker));
}
check(
  'the parked intent is still flushed on readiness change',
  /useEffect\(\s*\(\)\s*=>\s*\{\s*flushPendingNotificationNavigation\(\);/.test(layoutCode),
);
check(
  'the notification response listener is still registered once per mount',
  /addNotificationResponseReceivedListener/.test(layoutCode),
);

// ---- Startup routing authority is unchanged --------------------------------

check(
  'AuthGate still owns signed-out routing to onboarding',
  /router\.replace\('\/\(onboarding\)'\)/.test(layoutCode),
);
check(
  'AuthGate still pulls signed-in users into the tabs',
  /router\.replace\('\/\(tabs\)\/map'\)/.test(layoutCode),
);

if (failures > 0) {
  console.error(`\n${failures} root-layout render-loop test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll root-layout render-loop tests passed.');
