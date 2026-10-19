# Fieldnotes navigation and transitions

`Back to your map` now describes its result. The Activity empty-state action dismisses any presented modal stack and replaces the map route with a unique `mapResetId`. The map consumes that request once, closes Search/Nearby/selection/expanded state, minimizes Saved to normal map mode, and leaves the current camera untouched.

The Activity header X remains a contextual close action. Saved place result navigation, Quick Check completion, notification opens, gallery exit, Nearby exit, and compact place selection keep their existing contracts.

The transparent Activity queue and detail routes now use a full-surface fade. This prevents a dimmed rectangular sheet from moving across a still-visible page. The detail More menu uses no additional native fade, so its content and backdrop disappear together. Reduce Motion continues to gate existing map and content movement; animations outside the affected overlays were not disabled.

Dock rules come from the presentation owner: visible on normal map, compact selection, and Saved; hidden under expanded detail, Search, Nearby Explorer, source groups, and onboarding. A route reset restores normal ownership exactly once.

Automated navigation and ownership transitions pass. Native compositing, rapid gesture dismissal, and interactive back behavior need physical iPhone verification.
