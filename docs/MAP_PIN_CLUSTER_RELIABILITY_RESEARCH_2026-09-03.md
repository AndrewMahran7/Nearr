# Map pin and cluster reliability research — 2026-09-03

## Runtime baseline

- Nearr: Expo SDK 51, React Native 0.74.5, `react-native-maps@1.14.0`, `supercluster@8.0.1`.
- Provider: Apple Maps on iOS and Google Maps on Android. No native dependency change is required.
- Current map is native-camera-owned (`initialRegion` plus imperative camera commands); it does not pass a controlled `region` prop.

## Findings and decisions

| Issue | Primary source | Relevance / Nearr reproduction | Decision |
|---|---|---|---|
| Continuous and final camera observation | [`react-native-maps` MapView API](https://github.com/react-native-maps/react-native-maps/blob/master/docs/mapview.md) | The API documents continuous `onRegionChange`, final `onRegionChangeComplete`, `getCamera`, `animateCamera`, `animateToRegion`, and `getMapBoundaries`. Nearr reproduced stale clustering because it used only the final callback. | Observe `onRegionChange` with one RAF-coalesced publisher; use completion as a final signal and native boundary readback for programmatic moves. Keep the map uncontrolled. |
| Programmatic camera events can be absent or late | [`react-native-maps` issue #4762](https://github.com/react-native-maps/react-native-maps/issues/4762), [`react-native-maps` issue #5086](https://github.com/react-native-maps/react-native-maps/issues/5086) | Maintainer issue reports show camera commands may not emit region events and iOS animation can suppress later completion callbacks. Nearr's pre-fix fixture reproduces the resulting stale viewport even without asserting one particular native failure mode. | Every command advances a camera revision. Programmatic completion is reconciled from `getMapBoundaries`; an async readback commits only if its captured revision is still current. |
| Controlled-region feedback loops | [`react-native-maps` README](https://github.com/react-native-maps/react-native-maps#onregionchangecomplete-callback-is-called-infinitely) | The project documents infinite `onRegionChangeComplete` loops when state updates feed a controlled map. Nearr does not need controlled camera ownership. | JS viewport is observation state for queries/diagnostics only and is never passed back as `region`. |
| Native bounds support | [`react-native-maps` MapView API](https://github.com/react-native-maps/react-native-maps/blob/master/docs/mapview.md#methods) | `getMapBoundaries()` is a supported promise API. The installed 1.14.0 type/source also exposes it. | Read native bounds on map-ready, foreground, and programmatic completion; reject invalid/zero spans. |
| Supercluster query contract | [Supercluster README](https://github.com/mapbox/supercluster#methods) | Official order is `[westLng, southLat, eastLng, northLat]` and query zoom is an integer. Nearr's deterministic antimeridian and bbox tests pass. | Derive longitude/Web-Mercator zoom from measured map width, clamp/round for queries, and never query an invalid viewport. |
| Immutable cluster index | [Supercluster README](https://github.com/mapbox/supercluster#methods) | `load(points)` produces an immutable index. Camera motion does not change points. | Rebuild only when the filtered canonical dataset key changes; viewport revisions query the existing index. |
| Supported cluster expansion | [Supercluster `getClusterExpansionZoom`, `getChildren`, and `getLeaves`](https://github.com/mapbox/supercluster#methods) | Nearr already carries the engine cluster id and full unique leaves. Existing regression tests prove queued taps, nested taps, stale ids, bounds fallback, and terminal selection. | Use `getClusterExpansionZoom`; if it does not split, fit unique member coordinates once, then select a member so no valid tap terminates silently. |
| Full membership validation | [Supercluster `getLeaves`](https://github.com/mapbox/supercluster#methods) | The default leaf limit is 10. A conservation check using the default would silently truncate large clusters. | Always use `getLeaves(clusterId, Infinity)` for internal membership/conservation and verify engine count equals unique canonical leaf count. |
| Cluster tuning | [Supercluster options](https://github.com/mapbox/supercluster#options) | Official defaults are radius 40, extent 512, maxZoom 16, minPoints 2. Nearr uses extent 256 so radius is expressed in the same 256px tile convention as its zoom math. A 1,000-point fixture compared 56/40/32/24px. | Use 40px: at the fixture's neighborhood zoom it produced 28 representations versus 17 at 56px while retaining 3 wide-area representations; 32/24 raised city marker work more sharply. Correctness does not depend on this tuning. |
| Marker view tracking | [`react-native-maps` marker docs](https://github.com/react-native-maps/react-native-maps/blob/master/docs/marker.md), [`react-native-maps` issue #5956](https://github.com/react-native-maps/react-native-maps/issues/5956) | Custom marker tracking is expensive; a newer iOS/Google/Fabric report also shows invisible/untappable markers after reinsertion with tracking off. Nearr is on an older non-Fabric runtime and Apple Maps on iOS, so that exact issue is not reproduced. | Preserve stable keys/order/callbacks. Track custom marker visuals only for a bounded 120ms (or selected-photo decode), and avoid camera-driven visual prop churn. |
| Expo compatibility | [Expo `react-native-maps` documentation](https://docs.expo.dev/versions/latest/sdk/map-view/) | Expo supports `react-native-maps`; changing map libraries or adding a native module would require a binary and is outside this OTA. | Stay on the installed native surface and ship host-JS only after gates pass. |

## Nearr reproduction

The frozen pre-fix harness models 20 valid canonical saves. The native camera is continental (`[-129.5, 24.75, -67.5, 48.75]`, derived zoom 3), while JS remains on San Diego (`[-117.2211, 32.6557, -117.1011, 32.7757]`, zoom 12) after a missing completion callback. The stale query renders one truthful three-place cluster but leaves 17 native-viewport-eligible IDs unrepresented. The same immutable index queried with the actual camera represents all 20 with zero missing and zero duplicates.

## Historical branch audit

`fix/map-conservation-viewport-audit` was based at `78158ab` while current `origin/main` was `7ba1089`. It was not cherry-picked. Its reproduction, frame-coalescing, native-readback, bypass, and conservation-ledger concepts were independently inspected and ported after confirming current-main map-library compatibility. This ticket additionally adds a revision-safe completion handshake, measured viewport metadata, a hard raw-marker ceiling while clustering is disabled, current release gates, and the requested dedicated test command.

Rejected historical assumptions:

- Completion callbacks alone are not authoritative for programmatic movement.
- A camera revision number attached at callback time is insufficient; an older callback can otherwise be mislabeled as the newest command.
- Clustering-disabled mode may not render an unbounded 10,000-marker native tree.
- The former 56px radius was not retained merely to compensate for stale viewport state.
