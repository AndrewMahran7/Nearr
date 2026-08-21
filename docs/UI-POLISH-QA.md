# UI Polish — Phone QA

Run `npx expo start --dev-client` from this worktree and use the existing development iOS build.

## A. Gallery

1. Open a place with one photo; swipe down slowly, cancel halfway, then flick down to dismiss.
2. Open a place with multiple photos; swipe from first through middle to last and back.
3. Try diagonal and horizontal drags; pages should move without an accidental dismissal.
4. Dismiss with the close button, reopen, and confirm the gallery is centered and responsive.

## B. Reminder cleanup

5. Open Settings and confirm the obsolete default reminder-distance setting is absent.
6. Open/edit a saved place; confirm the reminder control reads `Auto` unless that place has an explicit override.
7. Confirm global, nearby, quiet-hours, and per-place reminder controls still save normally.
8. Open an existing saved place created with legacy settings; confirm no error or unexpected reset.

## C. Map pins

9. View several saved places at normal zoom; confirm category symbols are legible and saved places remain distinct.
10. Pan and zoom from local to city scale; confirm pins simplify without obvious lag or unreadable overlap.
11. Tap several different pins; confirm each opens the correct place and the selected pin gains a clear label/ring.
12. Check a selected place with and without a usable photo; confirm a category symbol is the complete fallback.
13. Close Place Detail after panning; confirm the camera does not jump or recenter.
14. Check a dense area for responsive taps, smooth movement, and no sustained marker/image flashing.

## D. Cross-feature regressions

15. Open a place from a map pin → open its gallery → swipe down → close detail; confirm the same map viewport, selection flow, and navigation remain intact.
