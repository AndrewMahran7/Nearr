# Filter and empty-state reconciliation

The empty card no longer owns a fixed vertical coordinate. Its top is calculated after layout as:

`max(visible top chrome bottom, visible Activity bottom, safe-area clearance) + Fieldnotes medium spacing`

This keeps the card below the rendered chips and Activity row as safe areas and Dynamic Type change their height. Only the active map/onboarding owner can render this feedback, so Search, Saved, Nearby Explorer, source groups, and place detail cannot show a competing empty message.

The stale founder sequence came from Show All on an empty category. That action created `No saved map locations in this view yet.` as a transient message; selecting a new category changed pins but did not retire the prior filter's message. Category selection now clears the transient message synchronously before installing the next filter. There is no asynchronous filter request on this path, so no old filter callback exists that can recreate it.

The current card distinguishes loading, an empty whole library, and an empty selected category. A true empty category presents one message and an All Places action. The card is derived from `visiblePlaces`, so it cannot claim emptiness while eligible current-filter pins exist.

Focused coverage checks Outdoors empty, All Places populated, rapid selection ordering, stale-message clearing, measured top ownership, and the absence of concurrent feedback surfaces. Native chip height at accessibility text sizes remains a founder-device check.
