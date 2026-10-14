# Splash-screen lifecycle trace

## Scope and reproduced failure

This trace covers Nearr 1.6.59 on `feat/nearr-1.6-fieldnotes`. The founder-visible warning was:

```text
Possible unhandled promise rejection
No native splash screen registered for given view controller.
Call 'SplashScreen.show' for given view controller first.
```

The warning surfaced while `Create your map` was redirecting, but that screen and its Continue/Back handlers do not call a splash API. The rejected promise originated in Expo Router's root registration path and arrived asynchronously while navigation was in progress.

## Root cause

Nearr previously had no application-owned `preventAutoHideAsync()` or `hideAsync()` call. `index.js` immediately loaded `expo-router/entry`.

Expo Router 3.5.24 schedules `_internal_preventAutoHideAsync()` in `renderRootComponent` with `setTimeout`. The callback does not await, return, or catch that promise. `expo-splash-screen` 0.27.7 memoizes the call for the current JavaScript runtime, but on an iOS development-client/JavaScript/OTA reload the current view controller can already have removed its native launch splash. In that state the native method rejects with the warning above. Because Expo Router discarded the promise, React Native reported an unhandled rejection.

An onboarding route change did not recreate the native splash controller and did not directly invoke `preventAutoHideAsync()`. It only provided the moment at which the delayed rejection became visible. A normal root React remount also stays in the same module runtime and therefore must not start a second native splash lifecycle. A full JavaScript or OTA reload creates a fresh JavaScript runtime while the existing native view controller may no longer have a registered splash; this is the important unavailable-native case.

## Authoritative lifecycle

The application now owns one process-level pair:

```text
index.js module evaluation
  -> beginNativeSplashLifecycle()
  -> SplashScreen.preventAutoHideAsync() once
  -> root React Native surface first layout
  -> hideNativeSplashWhenReady()
  -> SplashScreen.hideAsync() once
  -> completed for this JavaScript runtime
```

`index.js` imports `lib/splashLifecycle` before `expo-router/entry`. The public Expo Splash Screen API marks the lifecycle as application-controlled before Expo Router's delayed internal fallback runs. The Router fallback then observes its memoized prevent state and does not call native a second time. Router's later `_internal_maybeHideAsync()` also yields because the public prevent call marked the lifecycle as user-controlled.

The controller stores both promises. `hideWhenReady()` waits for the prevent attempt to settle, and repeated begin/hide requests return the original promise. The exact missing-native-controller rejection is a valid reload state and is settled locally. Any different native error is still reported through `console.warn`; there is no `LogBox.ignoreLogs` or global warning suppression.

## Callsite inventory

| Owner | File / function | When it executes | Can remount/replay? | Await/error behavior |
| --- | --- | --- | --- | --- |
| Nearr | `index.js` module import | Once when the app entry module is evaluated for a JavaScript runtime, before Expo Router entry | Route and component remounts do not reevaluate it. Fast Refresh may preserve it. A full JS/OTA reload creates a new runtime. | Imports the lifecycle owner; no floating native promise. |
| Nearr | `lib/splashLifecycle.ts` / module evaluation -> `beginNativeSplashLifecycle` | Immediately during app bootstrap | The module singleton owns one controller per JS runtime | Calls public `SplashScreen.preventAutoHideAsync()`. The controller handles synchronous throws and both resolve/reject branches; its returned promise never rejects. |
| Nearr | `app/_layout.tsx` / `RootLayoutContent.handleRootLayout` | First layout of the root React Native surface | `onLayout` can repeat and the component can remount | Calls `hideNativeSplashWhenReady()` without awaiting because the controller fully settles and memoizes it. Native hide is invoked at most once per JS runtime and only after prevent settles. |
| Expo Router 3.5.24 | `node_modules/expo-router/build/renderRootComponent.js` / `renderRootComponent` | A zero-delay timer after root registration begins | Once for each Router entry evaluation, including a new JS runtime | Calls `_internal_preventAutoHideAsync()` without handling the returned promise. This was the original unhandled-rejection site. Nearr's earlier public call now makes this internal fallback return `false` without another native call. |
| Expo Router 3.5.24 | `node_modules/expo-router/build/global-state/router-store.js` / navigation state listener | On the first navigation state event | Guarded by `hasAttemptedToHideSplash` | Calls `_internal_maybeHideAsync()`. It returns immediately because Nearr used the public prevent API and owns the hide. It is not the authoritative hide. |
| Expo Router 3.5.24 | `node_modules/expo-router/build/ExpoRoot.js` / missing-routes tutorial branch | Development-only Router tutorial when no routes exist | Only that exceptional render path | Calls Router's splash wrapper `hideAsync()` without awaiting. Nearr has routes, so this is not a normal Nearr boot or navigation callsite. |
| Expo Router 3.5.24 | `node_modules/expo-router/build/renderRootComponent.js` catch block | Synchronous failure while registering the root component | Exceptional bootstrap only | Calls `hideAsync()` without awaiting. `expo-splash-screen` handles the known already-removed-native error for hide; unexpected errors remain dependency behavior. |
| Expo Router 3.5.24 | `node_modules/expo-router/build/views/Try.js` / `getDerivedStateFromError` | A route render error reaches the Router error boundary | Exceptional route render only | Calls its splash wrapper `hideAsync()` without awaiting. This is an emergency error-display path, not route navigation logic. |
| Expo Splash Screen 0.27.7 | `node_modules/expo-splash-screen/build/index.native.js` / installed global error handler | A global JS error occurs after internal prevent setup | Once installed per runtime | Calls `hideAsync()` before forwarding the original error. The dependency catches its known no-native-splash hide error. |

Repository-wide application search found no other `expo-splash-screen` import or SplashScreen API call. There are no splash calls in boot/loading providers, font loading, authentication bootstrap, `AuthGate`, onboarding routes, `Create your map`, map navigation, or app foreground handlers.

## Remount and navigation trace

Development diagnostics remain narrow and structured:

- `lib/splashLifecycle.ts` logs one event for prevent request/result and hide request/result in Development. Replay events are intentionally silent.
- `app/_layout.tsx` records `root_layout_mounted`, `root_layout_first_layout`, and `root_layout_unmounted` with a unique mount ID.
- Existing `AuthGate` decision logs report its selected route.
- Existing onboarding render diagnostics report `Create your map` mount/unmount with a unique mount ID.
- Existing onboarding transition diagnostics report previous/next phase, previous/next route, navigation action, and duplicate suppression.
- Existing root route breadcrumbs record actual navigation changes.

The Android Development client confirmed one prevent and one hide during cold/current-tree boot. A Metro JavaScript reload again produced exactly one handled prevent and hide for the new runtime. Deep-linking to `Create your map` and tapping Back changed routes without another splash event or warning. Continue/Back transition ownership remains in the existing onboarding state machine and `AuthGate`; the splash fix adds no route action.

## Native configuration and OTA compatibility

Expo config introspection confirms the iOS app generates `UILaunchStoryboardName: SplashScreen` and a splash storyboard, the `expo-splash-screen` config plugin is present in the resolved plugin history, the module is autolinked, and Android uses the Expo splash theme. The current iOS Development build for app/runtime 1.6.59 was built from source that includes `expo-splash-screen` 0.27.7. The installed native configuration is valid.

The defect is in JavaScript promise ownership around the already-installed native module. The fix is JS-only and compatible with runtime 1.6.59; it does not require a native build.

## Regression coverage

`scripts/testSplashScreenLifecycleRegression.ts` proves:

- prevent is invoked once per runtime;
- a root remount reuses the original prevent promise;
- hide starts only from explicit root readiness and after prevent settles;
- repeated hide is idempotent;
- the exact missing-native rejection is handled without an unhandled rejection;
- unexpected native failures remain observable;
- auth/route and foreground replays cannot retrigger native calls;
- ownership stays outside account/onboarding navigation;
- a fresh OTA/JS runtime tolerates an already-removed native splash controller.

The existing Create Map navigation regression suite remains the source of truth for durable Continue and Back state/navigation behavior.
