# October 15 Fieldnotes polish

This change preserves the approved Fieldnotes design and starts at `f51dfdb75dcdee3e02ceb848875e2cea46632d42`, verified against Development OTA `4ab58c67-de91-4cf1-bab2-51d68d16aaea`.

Worktree: `C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct15-polish`
Branch: `fix/nearr-1.6-oct15-polish`

The original dirty Nearr worktree and clean external Fieldnotes worktree were preserved. The latter supplied the before Metro bundle. The isolated branch avoids overwriting either workspace.

## Implementation checkpoints

1. Map: an always-visible Show all pins action replaces repeated count copy. Filtering and restoring All are explicit; bounds include outliers, validate coordinates, and handle the date line. Measured overlays and native projection keep selected markers above compact/expanded cards without resetting zoom. The camera coordinator still arbitrates commands and gestures. Identical in-flight Show All requests coalesce.
2. Selected/Saved: identity-first compact cards, smaller photography, no empty photo placeholder, explicit View details, restrained haptics. Saved keeps its existing coordinated full sheet, virtualization, and featured-ID exclusion. No saved data or navigation architecture changes.
3. Images: optional local snapshot provenance distinguishes destination/source/unknown; retained destination imagery wins without another Google lookup. Source frames stay labeled. Failed gallery images leave the usable inventory. Five-photo persistence and cost contracts remain.
4. Search/Activity/Settings: same-query Retry, stale-result protection, save-in-flight feedback and failed-save continuity; Activity retains extraction frames and compacts the empty sheet; theme hydration cannot overwrite a newer preference; Development controls and actions retain strict backend gates.
5. Accessibility/motion: larger source metadata, three-scale component coverage, wrapping map actions, measured layout correction, reduced motion across camera commands and sheet/filter transitions.
6. Validation/release: exact prebuild command set, focused behavioral integration, actual Android before/after framebuffer captures, matched debug interaction samples, one Development OTA. See the individual reports for evidence and explicit platform limits.

## Boundaries

No backend, database schema, worker behavior, recognition, monetization, native configuration, dependency versions, icon, auth/account transfer, Create Map navigation, or root/splash lifecycle implementation changed. Test scripts exercise existing contracts. The onboarding retrieval lesson retains its separate preparatory camera focus; ordinary selected-card focus no longer derives zoom from a notification radius.

## Validation records

- `artifacts/fieldnotes-oct15/validation/aggregated-results.json`: **134 unique commands passed, zero unresolved failures, 144 recorded executions**. Its inputs preserve the initial 130/134 run (`results.json`), all four successful retries (`environment-retry-results.json`), and six final integration checks (`final-integration-results.json`). `retry-results.json` is the latest runner output, not the immutable record of the original four retries.
- `artifacts/fieldnotes-oct15/validation/oct15-suite.log`: focused geometry/camera/card/Saved/search/settings/Activity and existing map/detail/photo suites.
- `FIELDNOTES_VISUAL_BEFORE_AFTER.md`: actual native evidence and intentional differences.
- `FIELDNOTES_PERFORMANCE_COMPARISON.md`: debug measurements, without release/iPhone claims.
- `FIELDNOTES_DEVELOPMENT_OTA_REPORT.md`: authoritative published source and update identifiers.

The recording named in the request was not found in attachments, Downloads, Videos or Desktop. Founder-confirmed issues were treated as confirmed reports; additional hypotheses were checked against the verified source and available emulator. Physical iPhone, Apple Maps and live account/share acceptance remain founder QA.
