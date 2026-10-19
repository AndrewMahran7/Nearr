# Fieldnotes image and theme continuity

The compact selected card passes its resolved image URI and provenance kind into expanded detail. Expanded detail uses that URI only for the same `SavedPlaceWithPlace` identity and only until its destination/source gallery resolves. A failed bridge URI is discarded. This avoids a blank hero without allowing an image from another destination.

Saved search reuses the persisted local snapshot. It does not request a Google photo, does not relabel social evidence as destination photography, and keeps an honest placeholder when no usable local image exists. Existing five-photo ordering, deduplication, persistence, bounded prefetch, and provider-cost tests pass.

The map now owns an explicit `StatusBar`: dark content for Fieldnotes Light and light content for Fieldnotes Dark. System mode flows through the resolved theme. Activity and other modal surfaces continue to own their visible top surface while mounted; returning to the map restores the map policy.

Source-level continuity, snapshot, five-photo, Google-cost, Light/Dark/System, and modal ownership tests pass. Exact frame-to-frame image and status-bar behavior still need a physical iPhone capture.
