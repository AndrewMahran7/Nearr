# Place detail expansion and layout

## Final behavior

The compact card remains a map surface. It keeps the selected marker inside the measured visible viewport and provides the existing path into details.

The expanded presentation is now a destination page. `expandedPlaceDetailHeight` uses the measured available height, leaves only 20–44 points of top clearance, and caps the sheet at 95%. On representative phone heights the result is 90–95% of the usable display. Map controls and the Map/Saved dock remain suppressed while expansion owns the screen.

The expanded sheet has a fixed opaque header with the drag handle, a 44×44 Close target, the actual place name, and a 44×44 More target. The generic “Your saved place” row is omitted only in this map-owned presentation. Body content scrolls beneath the header inside an overflow-clipped card, and bottom padding includes the safe-area inset plus 64 points so the last row can clear the home indicator.

## Geometry and interaction ownership

- Compact marker correction uses the actual 148×90 selected-marker canvas, anchor `{ x: 0.5, y: 0.335 }`, and 12 points of breathing room on every derived edge.
- Corrections preserve camera zoom and stop when the user takes camera ownership.
- Expanding the detail stops selected-marker correction entirely. The nearly covered map is no longer moved in the background.
- Close and collapse continue through the existing map selection and pan-responder owners. No second modal or native dependency was added.
- The header owns sheet dragging; the body `ScrollView` owns content scrolling; horizontal gallery controls retain their existing gesture contract.

## Content layout

- Empty saved reasons render as one compact Add note row. Real reasons retain the existing readable card.
- Reminder copy uses the remaining width with natural wrapping. The native switch/activity state occupies a non-shrinking 54-point slot and retains a minimum 44-point target.
- The existing gallery → identity → Directions → source → reason → reminder → visit hierarchy is unchanged.
- Related saved-place cards can reuse destination-provenance local snapshot images. They do not trigger Google hydration.

## Validation

`npm.cmd run test:place-detail`, `npm.cmd run test:fieldnotes-oct18`, and `npm.cmd run test:fieldnotes-oct15` cover the new heights, fixed header, safe bottom, marker edges, user-pan cancellation, no expanded camera loop, close behavior, large text, reminder allocation, photo states, and convergence. TypeScript passes.

Native iPhone visual and gesture acceptance remains open because no controllable iPhone or connected Android target was available in this session.
