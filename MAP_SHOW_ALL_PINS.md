# Show All Pins — October 15 Fieldnotes polish

## Confirmed problem and implementation

The founder reported no obvious way to frame all saved pins. The previous fit action lived inside filter UI. Its ordinary fit used a centroid/standard-deviation heuristic and reminder-zone bounding coordinates; a sufficiently distant outlier could fall outside that statistical frame.

The main map now exposes a labeled **Show all pins** control with the existing Fieldnotes expand icon. Its accessible label distinguishes all saved pins from filtered saved pins. The filter menu also offers **Show these pins**, and an active filter offers **All places · Show all pins**. The latter clears the category filter and frames the entire eligible collection in the same action.

`fitVisiblePlaces` in `app/(tabs)/map.tsx` reads `filterEligiblePlaces`, or `mapPlaces` for the explicit reset-and-fit action. It does not use the nearby-reminder radius. Recenter remains GPS navigation; Nearby retains its own proximity/explorer behavior.

## Camera behavior

`lib/mapViewportGeometry.ts` computes a plan from valid saved coordinates and the measured map viewport. Top chrome and queue placement are measured; bottom space reserves the dock and the minimized map sheet. A 40-layout-pixel margin protects marker discs around the usable rectangle. Show All dismisses the keyboard and selected card and minimizes the map sheet before its final state.

For ordinary sets with multiple distinct coordinates, the screen issues native `fitToCoordinates` with this pixel padding. For one unique coordinate, it uses a finite neighborhood-scale region. For an antimeridian-crossing set, it uses the planner's shortest circular longitude interval and projected region, avoiding a naive longitude mean near Greenwich and MapKit's unwrapped polyline bounds.

The planner includes every valid coordinate, including outliers. It does not change saved data, categories, deduplication, reminder settings, or image requests.

| Input | Behavior |
| --- | --- |
| Empty or entirely invalid coordinates | Keep the current camera and show a useful message. No arbitrary fallback location. |
| One coordinate | Neighborhood context with pixel-aware center placement. |
| Repeated coordinates | One spatial extent; all saved identities remain intact. |
| Category filter | Frame the displayed filtered set. |
| All places · Show all pins | Clear the filter and frame the full eligible set. |
| Distant/international coordinates | Include all points in the bounds rather than trimming outliers. |
| Dateline neighbors | Use the short longitude arc across ±180°. |
| Viewport not ready or fully obstructed | Defer movement instead of inventing available space. |

## Ownership and repeat invocation

Show All owns a `show_all` transaction in the existing `MapCameraTransactionCoordinator`. It retires previous selection/cluster ownership, disables GPS follow, and issues exactly one native camera command. An identical Show All request while that transaction is settling is ignored. After settlement, another deliberate invocation can reframe the collection. A different explicit request can replace the previous owner.

Normal motion uses a 360ms region transition, or native fit animation. Reduce Motion uses duration zero / `animated: false`. Tapping receives restrained selection haptics through the existing preference-aware helper.

## Executed validation

`npx.cmd ts-node -P scripts/tsconfig.json scripts/testMapViewportGeometry.ts` — **29/29 passed**. Cases include 0, 1, 2, 5, 20, 100 and 1,000 pins; duplicates; invalid coordinates; an isolated international outlier among 100 nearby pins; opposite hemispheres; antimeridian neighbors; filtered inputs; safe-area/overlay padding; phone sizes; landscape; and deterministic repetition.

`npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesMapCameraRuntime.ts` — **passed**. This mounts the actual source-loaded production camera closures in React with native-host mocks. It verifies filtered/all/empty/date-line behavior, measured padding, repeated taps, and Reduce Motion. It is not a native map rendering test.

## Native validation boundary

MapKit and Google Maps retain their native world-extent and camera constraints. A near-global set can mathematically require more than one world width once overlays and marker margins are reserved. The planner exposes `requiresWorldOverscan` and caps the Region longitude span at 360°. This flag is diagnostic; it does not override MapKit constraints. Such near-world coverage does not have a proven native pixel-padding guarantee from these tests.

Mercator geometry and host-mock tests prove the planning and ownership policy. They do not prove exact MapKit framing on a physical iPhone. Native screenshots and observed results belong in the visual/performance reports; founder physical QA must include distant and antimeridian fixtures. No physical-device result is asserted here.
