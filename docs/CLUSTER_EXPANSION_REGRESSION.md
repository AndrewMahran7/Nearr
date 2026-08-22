# Intermittent cluster expansion regression

## Current tap pipeline

1. `filterPlacesForMap` derives the category-filtered `visiblePlaces`.
2. The selected place and an active map-group's members are removed from
   `clusterCandidates` so those pins remain individual.
3. `buildMapClusterIndex(clusterCandidates)` builds the memoized Supercluster
   index. `queryMapClusters` queries it with the last settled camera region and
   committed hysteresis zoom.
4. `clusterMarkers` render as `NearrMapClusterMarker`; its native `Marker`
   stops propagation and calls `handleClusterPress(cluster)`.
5. The handler resolves the event against `clusterMarkersRef` and
   `clusterIndexRef`, then resolves current members with `clusterMemberPlaces`.
   A stale native marker id is repaired against the latest rendered cluster.
6. Conflicting selected-place UI is dismissed, follow-camera ownership is
   released, and the cluster coordinator temporarily owns the camera.
7. The engine's `getClusterExpansionZoom` result is forced to at least one
   meaningful zoom level beyond the current committed zoom.
8. If the map is not ready, one request is queued. Otherwise
   `animateToRegion` receives the calculated expansion region.
9. `onRegionChangeComplete` records the actual region, commits clustering zoom,
   and marks the camera action settled. The cluster index is re-queried and the
   original stable member set is checked against the resulting clusters.
10. If it did not split in a bounded interval, one `fitToCoordinates` retry uses
    current member bounds (including a non-degenerate floor for co-located
    places). If that also fails, the first still-visible member opens as the
    deterministic terminal fallback.

## Restart/state audit

| State | Initial value | Mutated by | Reset on app restart | Can become stale? |
|---|---|---|---|---|
| `selected` | `null` | marker/deep-link/group selection; dismiss | Yes | It can conflict with a new tap; cluster tap now dismisses it first. |
| selected cluster / active cluster | no old state; coordinator `null` | cluster tap and verification | Yes | Native animation can be interrupted; now timeout- and lifecycle-cleared. |
| pending camera target | none | pre-ready cluster tap | Yes | Previously absent (tap was dropped); now bounded to one latest request. |
| camera animation state | none | coordinator primary/fallback actions | Yes | Native completion can be lost; timeout makes it self-clearing. |
| `hasUserMovedRef` | `false` | `onPanDrag` | Yes | Long-lived by design; it gates only automatic initial location focus, not cluster taps. |
| camera owner / `followMode` | `true` | pan, recenter, place/cluster focus | Yes | The ref could otherwise race state; cluster tap writes both ref and state immediately. |
| `lastRegionRef` | `null` | `onRegionChangeComplete` | Yes | May lag during animation; cluster verification waits for completion. |
| `settledRegion` | `null` | `onRegionChangeComplete` | Yes | May lag during animation by design; never used as a camera command. |
| `clusterZoom` | `null` | completed camera changes | Yes | Hysteresis intentionally retains a committed integer; tap enforces a +1 minimum. |
| marker cache / arrays | empty/derived | visible places, selection, camera | Yes | Memo inputs are complete; tap reads current refs rather than captured arrays. |
| clustering index | derived from candidates | filter, data, selected/group exceptions | Yes | An old native id can outlive a render; tap resolves against the current index. |
| category filter | `all` | filter chips, invalid-filter repair, deep link | Yes | Can invalidate ids; the current index/member set is authoritative. |
| visible markers | derived | data/filter/selection/camera | Yes | Render can race a native tap; stable member verification repairs it. |
| `mapReady` / ref | `false` / `null` | native mount/readiness | Yes | A marker tap could previously be dropped; now it queues once. |
| layout dimensions | `0` then measured | root/sheet layout | Yes | Window dimensions provide the initial safe fallback. |
| lifecycle state | current `AppState` | background/foreground listener | Yes | Native animations may be interrupted; transient expansion is reset on both edges. |
| focus/navigation state | unfocused | router focus/blur | Yes | Place Detail navigation can interrupt animation; focus edges reset only transient expansion. |
| onboarding/map overlay | feature state | onboarding state machine | Depends on persisted onboarding | It does not gate the cluster handler; existing overlay behavior is unchanged. |

## Deterministic failure proof from the old implementation

The old handler called `mapRef.current?.animateToRegion(...)` and returned. If
the ref/native map was not ready, the optional call performed no action and no
request was retained. If the command ran but no region completion/recluster
followed, there was no verification, timeout, retry, or user-visible fallback.
Both branches are deterministic silent terminal states in the old control flow.
A restart recreated the map ref, reset camera/region/zoom/selection refs, and
rebuilt the cluster index, which removed whichever transient condition caused
that occurrence.

The production observation does not identify which transient native condition
was present on Andrew's device, so the exact field that triggered the reported
incident is not fully proven. The eliminated silent terminal states are proven
from the prior source and covered by `test:map-cluster-expansion`.
