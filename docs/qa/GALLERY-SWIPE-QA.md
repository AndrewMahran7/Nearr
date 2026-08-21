# GALLERY-SWIPE-QA — Physical Swipe-Down Gallery Validation

- Owner: Safe Development integrator / physical-device QA
- Device: physical iPhone running the Safe Development build
- Timing: before integration; allow 20 minutes
- Preconditions: use a saved place with at least three photos, a saved place with one photo, and a place whose photo URL can be made to load slowly or fail

## Steps

1. Open the gallery from a saved place.
2. Swipe down slowly past the dismissal threshold; confirm the gallery follows the finger and dismisses.
3. Reopen it and flick downward quickly; confirm it dismisses.
4. Reopen it, start a downward drag, and release before the threshold; confirm it springs fully back.
5. Swipe horizontally between images repeatedly in both directions.
6. Perform diagonal, horizontal-heavy swipes; confirm they page and never dismiss.
7. Perform a diagonal, vertical-heavy downward swipe; confirm it dismisses.
8. Dismiss from the first image.
9. Dismiss from a middle image.
10. Dismiss from the last image.
11. Open a one-image gallery and dismiss it by swiping down.
12. Dismiss while the displayed image is still loading.
13. Dismiss while the displayed image is in a failed-image state.
14. Reopen and tap the X; confirm it still closes.
15. Swipe down and then tap X rapidly; confirm there is no stuck gallery, error, or duplicate close effect.
16. Reopen the gallery immediately after dismissing it; confirm the prior animation cannot close the new opening.
17. After every dismissal, confirm the same underlying place card/detail remains open with its state and scroll position preserved.
18. Background and foreground the app while the gallery is open, then dismiss it.
19. With VoiceOver enabled, focus and activate the labelled close action.
20. Repeat representative vertical, horizontal, and cancellation gestures quickly; confirm smoothness on the physical iPhone.

## Acceptance criteria

- Downward dismissal feels natural.
- Horizontal paging never accidentally dismisses the gallery.
- The gallery never becomes stuck or partially translated.
- The underlying place state is preserved.
- Competing or repeated close inputs cause only one close action per opening.
