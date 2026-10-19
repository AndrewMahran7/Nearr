# October 18 navigation and media fixes

## Review exit and map chrome

The failed post-save resolution path left Quick Check as the active presentation even after the save/source mutation had succeeded. That explains why the review could remain layered over Activity and why the map dock did not immediately return: the review still owned the visible route.

Single-candidate, picker, manual-search, and multi-place completion now converge on the same verified completion function. It clears pending completion once, advances onboarding only when applicable, and invokes the existing exactly-once save-navigation plan. Back and dismiss continue through the established `ShareJobsSheet` route owner. The map dock remains hidden only while search, Nearby Explorer, expanded detail, onboarding, group browse, or another legitimate map surface owns it.

`test:save-navigation`, `test:save-completion-contracts`, `test:share-completion`, and the multi-place interaction suites verify one final navigation outcome and no duplicate completion feedback. Native transition animation remains part of founder acceptance.

## Phase 2 practice media

The 2nd Floor food practice was mapped to the bundled Mad Yolks asset. That cross-place substitution is removed. Phase 2 real-practice surfaces now render exact media when an exact asset exists and an honest neutral Instagram/map-pin fallback when it does not. Phase 1 remains bundled and deterministic, with no pre-auth network dependency.

## Quick Check source evidence

The review adapter now searches retained media in this order: canonical frame fields, retained source-thumbnail fields, mention-slot frame, candidate frame, then evidence-frame URL. No destination photo is copied into the source slot. The empty comparison state is reduced to a compact 92-point fallback, while the existing original-post action remains available for a valid URL.

## Saved-nearby thumbnails

Same-source and Saved nearby rows now load the exact user's saved-place snapshot by saved-place/provider identity and accept only destination-provenance local photos. This is cache reuse, not screen-driven provider hydration. A missing snapshot remains an honest pin placeholder.

## Photo and cost controls

The canonical zero/one/two/five-photo inventory, bounded carousel prefetch, restart snapshots, failed-image fallback, and source/destination provenance are unchanged. The new related-row lookup reads local snapshots only. No new Google Places field, five-image request, or provider call was added.

## Theme, diagnostics, and authentication

- `ShareJobsSheet` sets status-bar content from the resolved Fieldnotes theme.
- The dark full-screen `PhotoRolodex` explicitly requests light status-bar content.
- The root continues to own normal light/dark/system status-bar behavior, including account and map surfaces.
- The development QA chip now appears only in a deliberate map-preview route and hides while detail is expanded.
- Signed-in Create your map copy says the account is connected and asks the user to continue, rather than asking them to sign in again.

## Items deliberately not changed

- The map view has stable component identity and no key-driven remount or map-type/theme swap in the reported broad-camera path. The tile-grid flash was not reproduced; native tile loading remains the likely explanation.
- The full Share Extension warning could not be captured without the recording or an iOS extension target. No warning was globally suppressed. `expo-updates` and `expo-dev-client` are excluded from the extension, so an OTA cannot change embedded native extension code; a confirmed native correction would require a new Development binary.
