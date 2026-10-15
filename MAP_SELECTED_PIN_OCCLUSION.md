# Selected pin visibility — October 15 Fieldnotes polish

## Root cause

The previous `focusZone` fit used reminder-radius coordinates and fixed padding (`top: 100`, `bottom: 220`). The selected compact card, expanded detail, safe areas and typography can occupy very different screen space. A fixed bottom allowance could therefore place the selected marker behind its own card. Reminder radius also changed camera scale even though it describes notification behavior.

## Correction

`focusZone` now requests a measured selection correction. The screen waits for the relevant selected-card or source-group overlay measurement, then derives the usable map rectangle from:

- The actual map width and height.
- Measured top controls and queue position, or the safe top inset when those controls are hidden.
- Compact card height and its bottom position, expanded detail height, or measured source-group selector height.
- Keyboard overlap and bottom-dock space where applicable.
- A 40px margin around the remaining space, including the marker's own visible disc.

Keyboard reservation uses the container's `measureInWindow` frame and the keyboard's `screenY`, recomputed on keyboard show and map layout; hide clears it. Android's existing `adjustResize` can already shrink the map above the keyboard, so the full keyboard height must not be deducted again. Late frame measurements are ignored after a newer measurement, keyboard hide, or container unmount. Geometry tests cover resized Android, overlapping iOS, an offset map frame, total coverage and keyboard hide; these are deterministic cases, not a claim of physical-device keyboard validation.

The expanded sheet retains a larger map strip above it. Its content remains scrollable rather than consuming that strip when text grows.

The effect obtains the marker's native `pointForCoordinate`. `planSelectedMarkerOcclusion` keeps an already visible marker in place and otherwise translates it only as far as necessary into the safe rectangle. The shifted camera-center screen point is converted back by native `coordinateForPoint`, then applied with `animateCamera({ center })`. Zoom, heading and pitch are not overwritten by this command. There is no hardcoded latitude offset.

The marker anchor is centered while the place card supplies its title. Native projection therefore refers to the same center that the padding protects. Source-group selection uses its own measured carousel; saved detail expanded from Nearby Explorer participates in the same correction, while the ordinary Nearby carousel retains its existing camera owner.

## Avoiding oscillation and stale movement

Each selection/layout key is consumed once. Native viewport samples may retry a pending request after another transaction settles; they do not repeatedly animate an already handled layout. Subpixel displacement below one pixel is a no-op.

Native projection promises are checked against the selected ID, selection request revision, camera revision, effect cancellation and user-gesture ownership. This rejects a late result after a different selection, dismissal, same-ID reopen, new camera command, or intentional pan/zoom.

A map gesture cancels the active transaction and retires automatic correction for that selection. A deliberate card Open/upward expansion or new selection can request visibility again. Closing a card issues no camera command and does not restore an old viewport. A failed selection animation releases only its own transaction and clears its consumed key; an old failure cannot cancel a newer owner.

All map camera paths now honor Reduce Motion, including selection, Show All, cluster expansion, Nearby selection/initial fit, source-group fit, initial GPS, GPS follow and Recenter. The long-lived GPS subscription reads a current preference ref rather than restarting for an accessibility setting change. Both selected-card spring settlement paths have zero bounciness; Reduce Motion settles immediately.

## Executed validation

`testMapViewportGeometry.ts` — **30/30 passed**, including actual keyboard/frame overlap, compact/expanded geometry, changing card/keyboard height, horizontal occlusion, landscape, invalid native projection, no movement for already-visible markers, rotated affine projection, same-ID stale request rejection and gesture cancellation.

`testFieldnotesMapCameraRuntime.ts` — **passed**, mounting actual production camera closures with host mocks. It verifies deferred measurement, center-only movement, one correction after native settlement, expanded-card correction, no camera move on dismissal, source-group measurement without a mounted compact card, Explorer saved detail, late projection cancellation after pan, same-ID reopen, native-error retry, newer-owner protection, and explicit upward expansion after pan. It also audits every imperative map camera command for a Reduce Motion gate.

`testMapCameraOwnership.ts` — **passed**: closing a place never moves the camera.

## Evidence boundary

These tests exercise React closure behavior and deterministic pixel geometry. They do not render MapKit/Google Maps or prove device timing, tilted-map perspective, Dynamic Type layout measurements, or physical-iPhone gesture behavior. Native before/after screenshots and device findings are recorded separately. Founder QA must verify compact and expanded cards, a long-name/no-photo place, keyboard overlap, a small iPhone, manual pan during movement, and dismiss/reopen.
