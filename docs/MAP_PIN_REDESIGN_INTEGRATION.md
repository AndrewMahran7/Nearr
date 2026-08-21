# Map Pin Redesign Integration Notes

## Boundary

The redesign is isolated behind `EXPO_PUBLIC_MAP_PIN_REDESIGN_ENABLED` (default
on in the current client). `app/(tabs)/map.tsx` continues to own data, filtering, selection, camera,
radius circles and the place card. Marker-specific work is limited to:

- `lib/mapMarkerPresentation.ts`: pure category, density, photo-fallback and
  accessibility rules.
- `components/map/NearrMapMarker.tsx`: native marker rendering and bounded
  `tracksViewChanges` snapshot lifecycle.

No marker performs a normal-list photo request. Only the selected marker reads
Nearr's existing rich-details cache, which deduplicates the same Google Places
request already used by Place Detail.

## Expected conflicts

### Safe Development current baseline

- Likely file: `app/(tabs)/map.tsx`.
- Safe Development's physically validated startup, map provider, permission,
  live-location, camera and place-card behavior wins.
- Reapply only the `NearrMapMarker` import, `markerLatitudeDelta` state,
  `mapMarkerDetailLevel` calculation, completed-region update and filtered
  marker render props.

### `feat/onboarding-v2` at `eca05c6d7284d3a950ec8496ae4dd6aab61a7015`

- Expected direct conflict: `app/(tabs)/map.tsx`.
- Preserve Onboarding's coachmarks, behavioral progress observation and
  permission suppression.
- Do not copy either complete map file. Keep Onboarding behavior around the
  screen and retain this branch's modular marker import/presentation/rendering.

### Future Place Recommendations

- If recommendations add non-saved map annotations, do not pass them through
  `NearrMapMarker` as though they were saved. Give them a visibly distinct
  annotation component and accessibility prefix.
- Saved-place filtering must continue to produce `visiblePlaces` before saved
  markers render.

### Pre-JoinBrands filter/polish

- Reconcile category/filter UI in `app/(tabs)/map.tsx` and
  `lib/mapVisibility.ts` first.
- The invariant remains: a place excluded from `visiblePlaces` creates no
  marker. The one documented exception is an already-selected/deep-linked
  place, which current product behavior intentionally pins visible.

## MAP-PINS-QA — Physical Map Pin Validation

Owner: Andrew / Mobile QA

When: after integration into Nearr-Dev

Required actions:

1. Enable the map-pin flag in the development build only.
2. Capture 1-place, 10-place and dense-local-cluster maps with mixed
   categories.
3. Select and deselect a marker; switch directly from A to B; open and close
   the place card.
4. Validate a successful selected photo, then repeat with network disabled or
   a failed image URL and confirm the category marker remains.
5. Change every available map filter and confirm excluded places have no
   marker.
6. Pan and zoom from local through city scale in light and dark mode.
7. Repeat the interaction sweep on an iPhone while watching animation,
   memory, image loading and tap responsiveness.

Acceptance criteria:

- Category glyphs remain recognizable and do not obscure the map.
- The selected marker is dominant by size, ring and label, not color alone.
- A becomes normal when B becomes selected; closing the card clears selection.
- Photo failure/offline produces a complete category fallback without a blank
  marker or permanent spinner.
- Zooming out or raising density makes markers smaller and simpler.
- Filters remove markers, panning/zooming stays responsive, light/dark tile
  contrast is legible, and existing place-card behavior is unchanged.
