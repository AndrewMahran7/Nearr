# Place Detail and image review — October 15

Baseline: `f51dfdb75dcdee3e02ceb848875e2cea46632d42`. No generated replacement imagery, database migration, provider-field expansion or new native dependency.

## Confirmed image issues

1. Saved rows supplied a retained photo and source thumbnail but left `PlaceImage` at its source-first default. They now prefer the known local photo while retaining source provenance.
2. `hydrateSavedPlace` persisted source fallback into `localPhotoUris`; subsequent detail code treated every retained URI as an independent destination photo. A source frame could therefore get a destination gallery label and count. Device snapshot v3 now accepts optional `photoProvenance`; this is a backward-compatible local metadata extension, not a database schema change. New provider photos, source frames and ambiguous legacy images stay distinguishable after restart.
3. An already acquired destination in the in-memory rich-details cache was ignored if a source fallback had previously been persisted. It can now replace that fallback without making a Google metadata request. The promotion retains cached opening hours and UTC offset, falling back to existing snapshot metadata when absent; it does not mark a metadata-empty replacement complete while discarding those already acquired details. This is conditional on real cached imagery; the frontend cannot assert that a particular founder device already has a clean Mad Yolks photo.
4. Source-only hero image errors were not handled by the provider/video error branches. The fallback now removes failed URIs and progresses to the next retained source or neutral state. Thumbnail and gallery errors also remove failed photos from the detail's usable gallery count.

## Truthful hierarchy

| Surface | Policy |
| --- | --- |
| Map selected card | Cached local image with destination/source/unknown kind supplied by map owner. Source says From your post (and visible Post label); unknown says Saved image. Image failure retains identity without blank image space. |
| Saved | Known retained image first, source thumbnail fallback. Source-only feature stays compact; labeled Post. Destination feature keeps warm Fieldnotes photography at 2:1. |
| Place Detail | Retained destination/unknown saved photos lead. Known source frames are excluded from the independent photo gallery and remain explicitly labeled From your post. Source-only hero opens the actual original when available. |
| Gallery | Destination photo label only for known destination provenance; ambiguous old payloads say Saved photo. Counts reflect actual nonfailed images, up to five; no fake five-image gallery. |
| Activity | Source thumbnails are provenance for the shared post. No replacement or provider-photo fetch is justified for status rows. |
| Quick Check | Existing exact-place-photo-first, source-frame-fallback policy is preserved; no additional active/inactive hydration change. |
| Map markers | Bounded photo-marker allocation remains unchanged; root map geometry/presentation work owns marker visibility. |

Legacy `google_fallback` is known destination; legacy `durable_fallback` with an image is known source; legacy `save_payload` without metadata is deliberately unknown because the old serializer mixed destination photos and source frames. Cached files are not purged or refetched to invent certainty.

## Preserved detail design

Gallery → identity → Directions → original post → why saved → reminder → visit → More remains intact. The 4:3 hero, source ribbon, original-post action, personal-note provenance and non-destructive visit state are preserved. Source label/caption increase to 12/13pt with comfortable line heights. Compact source ribbon removes its title-line cap for large text. Long detail descriptions remain readable in the existing scroll container. Gallery keeps bounded loading, adjacent prefetch disabled for saved detail, swipe dismissal and Reduce Motion behavior.

The expanded map-owned detail now preserves 156pt of geographical context below Queue, with a usable scrollable detail body. `test:place-detail` replaces the obsolete “at least 84% sheet coverage” assertion with explicit marker clearance; all hierarchy and navigation assertions remain.

## Tests

Passed:

- `test:saved-place-snapshots`: primary-first/progressive 2–5 persistence, 0/1/2/5 actual images, restart, account isolation, missing files, failed writes, bounded recovery, legacy source-only snapshots, unknown legacy provenance, cached-destination upgrade with zero new provider calls, and cached hours/UTC preservation through restart (including zero UTC offset and snapshot fallback).
- `test:place-photo-contract`: up-to-five stable ordering, reference deduplication and honest 1/1.
- `test:place-image`: source/destination selection and cache behavior.
- `test:photo-carousel`: paging, bounded prefetch and gesture/focus wiring.
- `test:place-detail`: unchanged Fieldnotes hierarchy, notes, management actions and corrected viewport clearance.
- Saved/selected mounted-component suites: source-only, no-photo, failed-photo, cached photo and 3 text scales.

Native comparisons: `artifacts/fieldnotes-oct15/before/light-photo-place.png`, `before/light-real-place.png`, `before/light-selected.png`, corresponding `after/` captures, and `after-dark/` dark-mode captures. Final capture status is recorded in `FIELDNOTES_VISUAL_BEFORE_AFTER.md`; no physical-iPhone approval is claimed.
