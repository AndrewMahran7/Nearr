# Production map reliability audit — 2026-08-24

## Production baseline captured before changes

- Repository `main` / `origin/main`: `0982bacdec33a0d9f17479e9e1e3899f6a16f24b`
- Live production OTA group: `a12b09b5-13b6-4ea0-98d9-6edf7ad7b115`
- Production map source SHA: `7fc845d201c5da4c999fd0737a70b8fddbbae39b`
- Runtime: `1.3.52`
- iOS update: `01a02b13-1860-7979-a181-0385c5f70dc6`
- Android update: `01a02b13-1860-77f8-a646-08ed8bf1bde2`
- Map: `react-native-maps@1.14.0`; iOS default Apple provider, Android Google provider
- Spatial clustering: `supercluster@8.0.1`, radius 56 screen points, extent 256, max zoom 16, minimum 2
- Map pin redesign: enabled by app-config default (`true`); no production EAS override exists
- Onboarding flags: V2 enabled `true`, backend ready `true`, phase-1-only `true`
- Railway production at initial capture: deployment `2bb36548-5666-47b8-a7a8-72e09448100a`, source `0982bacd…`, success. The final concurrency guard observed a newer successful deployment `eee062e5-43db-4546-bdd2-bdcd690d4d6a` at the same source SHA, so release reconciliation was required and no production mutation was attempted.
- Edge versions: `process-share-link` 131, `delete-account` 23, `create-share-job` 25, `process-share-jobs` 79
- Production migration head observed: `20260822000003`. The CLI ledger also showed local/remote drift; this host-JS release must not mutate or reconcile schema.

The production OTA and current-main map files were byte-identical at audit start. Current-main's later commit affected the media worker, not the map.

## Exact data and interaction pipeline

| Stage | Input → output | Identity / owner / memoization | Async boundary | Can drop, merge, or stale? |
|---|---|---|---|---|
| Database | RLS-scoped `saved_places` joined to `places`, newest first → `SavedPlaceWithPlace[]` | `saved_places.id`; Supabase owns persistence | Network | RLS/auth can return empty; failures fall back to durable cache |
| Shared fetch/cache | Network or AsyncStorage → module memory cache and mounted hooks | User id + local mutation revision; `useSavedPlaces` owns state | Network, storage, realtime | Older fetches are now rejected after a newer local mutation; previously they could overwrite current marker state |
| Save-time canonicalization | Provider candidate + user's existing saves → unique saved destination | Exact Google Place id; provider-less fallback requires exact normalized name + exact address + ≤40 m | Network writes | May merge only on strong identity. Previous substring-name + proximity rule produced false merges |
| Coordinate normalization | Saved rows → finite-coordinate, unique-id rows | `saved_places.id`; `MapScreen.validPlaces` memo | None | Missing/non-finite coordinates are explicitly ineligible. Duplicate ids are discarded deterministically |
| Category derivation | Saved row/provider taxonomy → one browse group | `saved_places.id`; pure `savedPlaceCategory` / `mapFilterGroupForPlace` | None | Unknown taxonomy maps to `other`; cannot drop |
| Filtering | Canonical rows + active chip + selected id → eligible map rows | Saved id; `visiblePlaces` memo | None | Nonmatching rows are explicitly filtered. Selected target is an explicit eligibility exception |
| Map-group exception | Eligible rows + Queue/group focus ids → cluster candidates + individual ids | Saved id; memoized set | None | Cannot merge/drop; group focus is capped at 50 ids |
| Spatial index | Sorted unique candidates → one Supercluster index | Stable dataset key hashes id + coordinates + category; memoized by candidate array | Synchronous | Invalid coords are excluded earlier. Duplicate ids cannot enter twice |
| Viewport query | Index + settled region + integer zoom + viewport width → clusters and loose points | Cluster identity is dataset + zoom + sorted canonical member ids | Synchronous, only after region-complete | Offscreen is explicit. Dynamic padding covers at least cluster radius; fixed-padding edge loss is removed |
| Cluster membership | Engine leaves → canonical member ids/count | Saved id; member ids sorted/deduped | None | Engine count is retained and checked against canonical count. A mismatch is diagnostic/invariant failure |
| Selected projection | Queried cluster + selected id → selected individual + remaining cluster/singleton | Saved id; does not rebuild full index | None | Exactly-one ownership maintained; no duplicate selected member and no unrelated loss |
| Render preparation | Projected clusters + loose/exception ids → React marker objects | Place key is saved id; cluster key is stable membership identity | React render | Empty viewport renders zero markers instead of the entire dataset |
| Native MapView | React markers → native marker views/bitmaps | `identifier` and React key as above | React Native bridge/native rasterization | Static custom views track for a bounded 120 ms so Android cannot freeze a pre-frame blank snapshot |
| Pin tap | Native event → stable saved id → selection + bounded zone focus | Saved id; latest row is retained through shared cache | Native event/camera | Pin selection no longer rebuilds the full spatial index |
| Cluster tap | Native event → exact membership/dataset resolution → expansion request | Dataset key + cluster member key; coordinator owns request | Native event/camera callback/timer | Unrelated nearest-cluster repair is forbidden. Stale membership selects one of the tapped canonical members or zooms the tapped center |
| Camera | Request → native animation → region-complete → settled query | One cluster request token; initial/follow/pin/group guards | Native callback | One primary + one bounds fallback + terminal selection; no recursive camera command from ordinary reclustering |
| Lifecycle/navigation | Blur/background/detail return → transient cluster reset; focus → stale-while-revalidate | Screen focus/AppState; shared cache survives | AppState/navigation/network | No unfinished cluster ownership survives blur/background; stale fetch cannot overwrite a local mutation |

## Proven pre-fix reproductions

The frozen probe is `scripts/reproduceMapReliabilityPreFix.ts`.

- Pin disappearance: **YES**. At 320 pt width, fixed 15% query padding was 48 pt while cluster radius was 56 pt. A weighted cluster center could fall beyond the query box while a canonical member remained inside the viewport.
- Incorrect semantic grouping: **YES**. `Waimea Bay Beach Park` and `Waimea Bay Beach` matched the substring-name rule within 40 m even with distinct provider identities.
- Silent cluster-tap no-op: **NO**. Existing coordinator tests proved bounded fallback, and no deterministic no-op was found.
- Stale cluster misroute: **YES**. A stale id selected the nearest current cluster without distance, generation, or member-overlap validation.
- Freeze/update explosion: **YES**. An empty viewport query over 10,000 places returned 10,000 individual native marker models. Pin selection also rebuilt the full index.

## Root causes

- Pin disappearance — **PROVEN**: fixed fractional viewport padding could be smaller than the screen-space clustering radius. **HIGH-CONFIDENCE additional cause**: stale network snapshots could overwrite a newer optimistic dataset. **HIGH-CONFIDENCE native visual cause**: zero-delay `tracksViewChanges=false` could freeze a blank Android custom-marker bitmap before a native frame.
- Incorrect grouping — **PROVEN**: save-time substring-name + proximity fallback conflated semantic dedupe with weak similarity. Visual clustering itself remains temporary screen-space grouping only.
- Cluster tap — **PROVEN adjacent defect**: stale events could resolve to an unrelated nearest cluster. **NOT PROVEN** for the specifically reported silent no-op.
- Freeze — **PROVEN**: zero-result fallback mounted the full dataset; 10,000-place reproduction created 10,000 native marker models. **HIGH-CONFIDENCE**: selection-triggered full-index rebuild added synchronous tap work. No infinite render/camera loop was found.

## Invariants after the fix

- Every filter-eligible canonical saved id is exactly one rendered individual, exactly one visible-cluster member, or explicitly offscreen.
- Every rendered cluster's displayed count equals its sorted unique canonical member ids and its engine leaf count.
- Saved marker identity is always `saved_places.id`.
- Cluster React/native identity is derived from dataset, zoom, and canonical membership; the ephemeral Supercluster id is used only against its owning index.
- Dataset mutations advance a revision; fetches started under an older revision cannot commit.
- A valid cluster interaction has at most two camera commands and one terminal selection fallback.

Development calls `assertMarkerConservation` after every settled render computation. Production records bounded aggregate-only diagnostics on violations without private notes, source history, or raw coordinates.

## Camera ownership

```text
IDLE
 ├─ user gesture ───────────────> USER (follow off; no camera command)
 ├─ initial fix, once ──────────> INITIAL_FIT ──region complete──> IDLE
 ├─ live location, follow on ───> FOLLOW ───────region complete──> FOLLOW
 ├─ pin/deep-link selection ────> PIN_FOCUS ───region complete──> IDLE
 ├─ Queue/group focus ──────────> GROUP_FOCUS ─region complete──> IDLE
 └─ cluster tap ────────────────> CLUSTER_PRIMARY
                                      ├─ split ────────────────> IDLE
                                      └─ timeout/failure ──────> CLUSTER_FALLBACK
                                                                    ├─ split ─> IDLE
                                                                    └─ timeout ─> member selection ─> IDLE
```

Cluster, pin, deep-link, and group focus synchronously disable follow before issuing camera work. `onRegionChangeComplete` records camera state and reclusters; it never issues an ordinary camera command, preventing a region/recluster feedback loop.

## Grouping rule

- Semantic dedupe: exact provider id; or, only when both provider ids are absent, exact normalized name + exact normalized address + close coordinates.
- Visual cluster: temporary Supercluster grouping by screen-space radius at the settled integer zoom.
- Ambiguous same-place candidates: keep separate.
- Distinct nearby POIs, same-name branches, bridge/beach/bay, or same-source places: keep separate semantically; they may still share a temporary low-zoom visual cluster.
