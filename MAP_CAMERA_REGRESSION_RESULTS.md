# Map camera regression results — October 15 Fieldnotes polish

## Executed checks

Commands ran in `C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct15-polish` against the working integration based on `f51dfdb75dcdee3e02ceb848875e2cea46632d42`. Final release SHA and native screenshots are recorded by the release/visual reports.

| Command | Result | Scope |
| --- | --- | --- |
| `npx.cmd ts-node -P scripts/tsconfig.json scripts/testMapViewportGeometry.ts` | PASS, 30/30 | Independent pixel-fit oracle, bounds, padding, actual keyboard/frame overlap, selection correction, stale-request and transaction cases. |
| `npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesMapCameraRuntime.ts` | PASS | Actual source-loaded React callbacks/effect and gesture responder with native-host mocks. |
| `npx.cmd ts-node -P scripts/tsconfig.json scripts/testMapCameraOwnership.ts` | PASS | Dismissal preserves the explored camera; explicit navigation retains ownership. |
| `npx.cmd ts-node -P scripts/tsconfig.json scripts/testMapCameraTransactionHotfix.ts` | PASS, 31/31 | Existing cluster/transaction/conservation regressions and 1,000 mixed operations. |
| `git diff --check` | PASS | No whitespace errors; Git emitted an existing line-ending normalization warning. |

The existing transaction suite reported **0 dead taps, 0 stacked commands, 0 automatic child selections, 0 missing IDs, 0 duplicate IDs and 0 camera loops** in its synthetic fixtures. These are test results, not native frame-rate or physical-device measurements.

## Camera-owner audit

All imperative commands remain gated by `beginCameraMovement` and the existing transaction coordinator. The coordinator still permits one native command per transaction. Region callbacks, native readback, camera revisions and cluster watchdog protections remain in place.

| Event | Owner / command | Context and gesture policy |
| --- | --- | --- |
| Saved pin selected | `selectPlace` → `focusZone` request → measured native selection effect | Stop GPS follow; preserve zoom; correct only actual occlusion after overlay measurement. |
| Compact card Open / upward expansion | Selected-card layout correction | Explicit action can rearm visibility after pan; larger card uses new measured bounds. |
| Card close / detail collapse | UI state, with no restoration command on dismissal | Preserve the current explored viewport. Collapse may remove an obstruction; visible marker is a no-op. |
| Saved row / saved-route selection | Existing saved-place focus resolution → selected-place owner | Exact saved identity retained; deep-link request handling and follow safeguards preserved. |
| Existing-library search result | Close search → `selectPlace` | Preserve identity and current scale; reveal the chosen marker within the remaining viewport. |
| New-place search save | Existing save flow → successful saved selection | Failed save retains search context; camera selection follows real saved data. |
| Show All | Dedicated `show_all` transaction | Disable follow; retire older explicit owner; one fit command. Identical rapid repeats while settling are ignored. |
| Recenter | `user_location` transaction | Deliberate GPS action restores follow mode; remains distinct from saved bounds. |
| Category filter change | No camera command | Preserve the area being inspected. Show these pins explicitly frames the filtered set. |
| Reset filter and frame | Show All using complete eligible set | Clear category and fit in one explicit action. |
| Nearby Explorer initial fit | Existing Explorer session owner | Wait for measured carousel/map layout; one initial fit per session. |
| Nearby card selection | Existing Explorer selection owner | Bring an offscreen item into view while retaining scale. Ordinary marker selection does not independently recenter. |
| Nearby saved detail expanded | Measured selected-detail correction | Use the expanded saved card's visible-map area. Ordinary Explorer carousel remains separate. |
| Source-group selection | Selected-place owner with measured source-group overlay | The correction does not require a compact card that is not mounted. |
| Explicit source-group fit | Existing `programmatic_focus` transaction | Frame group coordinates with group overlay padding. |
| Cluster tap | Existing cluster expansion coordinator | Choose target before the command; never automatically select a child. Watchdog recovery is readback-only. |
| Initial GPS fix | Existing one-time `user_location` effect | Skip after user exploration or a target has already owned the camera. |
| Live GPS updates | Follow-mode owner | Center-only movement, current scale preserved; disabled by intentional exploration/selection. |
| Return from Place Detail / foreground | Existing lifecycle readback | Reconcile native viewport without restoring a stale pre-open region. |
| User pan/zoom | Gesture owner | Cancel active transaction, invalidate stale projection work, and retire current automatic selected correction. |
| Keyboard/card/layout change | Selected layout owner only while still authorized | Recompute available area; no correction after user pan until explicit selection/open rearms it. |

## Regression coverage details

- Show All: empty, invalid, singleton, 2/5/20/100/1,000 places, duplicate coordinates, category subset, full collection, isolated outlier, international distribution, both sides of the dateline, measured overlay padding, retained source-group/Explorer bottom surfaces and repeat invocation.
- Occlusion: compact and expanded cards, changed heights, actual keyboard/frame overlap (Android resize, iOS overlap, offset frame, hide), small/large portrait rectangles, landscape/side obstruction, source-group carousel, Explorer saved detail, visible-pin no-op and subpixel deadband.
- Ownership: one command while settling, late native projection after gesture, dismissal and same-ID reopen, native error recovery, old-error protection for a newer owner and explicit expansion after exploration.
- Motion: actual runtime checks for Show All/selected correction and card responder; source AST inventory verifies every imperative map camera command consults `reduceMotion` or the latest GPS-watch preference ref.

The new React test extracts the production closures using TypeScript AST nodes, then mounts them with React Test Renderer. It does not copy a second implementation of camera policy. It also does not mount the entire application or implement a native map engine.

## Physical/native limitations

No physical-iPhone result is asserted by these tests. Native MapKit may adjust camera spans at continental/world scale. A near-global collection can require more than a world width after padding; the planner surfaces this diagnostic, but native Region spans remain capped at 360°. Exact padded framing for that edge case remains a physical-provider validation item.

Native `pointForCoordinate`/`coordinateForPoint` makes selected correction provider-aware, but real timing, map tilt/perspective, gesture interruption, keyboard/layout animation and accessibility text sizes still require native observation. Screenshot and measured performance results must be appended from actual captures, with platform/build conditions stated; synthetic conservation results must not be presented as native smoothness measurements.
