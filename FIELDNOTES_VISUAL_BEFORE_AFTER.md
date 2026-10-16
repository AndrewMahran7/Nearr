# Actual native before/after evidence

All frames are `adb exec-out screencap -p` from the existing Pixel 8a Android debug Development app, 1080×2400 at density 420 unless metadata says otherwise. The before bundle came from the untouched `f51dfdb` worktree on Metro 8082. The after bundle came from the isolated polish worktree on Metro 8083. JSON companions identify route, source and font scale; XML companions record the native accessibility tree. These are not iPhone screenshots.

The founder recording was unavailable. No frame timestamps or physical QA are invented. The previews use bundled demo saves, 25 read-only public place names, bundled Dorset Quarry imagery, and read-only Activity fixtures. Settings is signed out: its account-preferences error and Development LogBox warning are expected in this QA host, not proof of authenticated Settings. Some before/dark frames retain this visible diagnostic banner; it was not retouched out.

## Visual comparison

| Surface | Before | After | Observed result |
| --- | --- | --- | --- |
| Map | `before/light-map.png` | `after/light-map.png` | Repeated collection heading replaced by directly visible Show all pins; warm palette, controls, map and dock retained. |
| Compact selection | `before/light-selected.png` | `after/light-selected.png` | Bantam identity now leads; no generic no-photo panel; locality/reason and View details remain readable. Marker clears card, and selection preserves broader map context. |
| Expanded selection | No valid matched baseline expanded-card capture | `after/light-expanded.png` | Selected orange marker is fully above the expanded sheet; detail remains scrollable. This is after-only native evidence supported by the source/geometry regression, not a matched expanded-card comparison. |
| Saved | `before/light-real-saved.png` | `after/light-real-saved.png` | Existing compact no-photo rows and list access retained; featured item appears once. Photo-feature/source behavior is additionally covered in component tests. |
| Photo detail | `before/light-photo-place.png` | `after/light-photo-place.png` | Gallery, identity, Directions, original post and reason maintain approved hierarchy; two known bundled images remain 1/2. Ribbon text is larger. Bundled practice images are labeled Saved photo, without claiming independently acquired photography. |
| Open gallery | `performance-before/gallery.png` | `performance-after/gallery.png` | Actual fullscreen gallery is open with two real bundled Dorset Quarry images. Count and navigation remain intact; ambiguous bundled imagery receives the truthful Saved photo label. The native swipe measurement is separate from the still frame. |
| No-photo detail | `before/light-real-place.png` | `after/light-real-place.png` | Long real place identity, no-photo fallback and action order preserved. |
| Saved-place search | `performance-before/search.png` | `performance-after/search.png` | Local `pizza` note search returns Bantam with the keyboard visible. Your places / Find somewhere new separation and result identity remain intact; metadata is larger. No provider lookup or live save is needed for this capture. Retry and failed-save recovery have executable behavioral evidence. |
| Activity | `before/light-activity.png` | `after/light-activity.png` | Larger metadata with same authoritative lifecycle groups. `after/light-activity-empty.png` separately captures the compact empty state. |
| Settings | `before/light-settings.png` | `after/light-settings.png` | Light canvas and appearance selection remain consistent. Hydration-race fix has executable provider evidence; still screenshots cannot prove absence of a transient flash. |

Paths in the table are relative to `artifacts/fieldnotes-oct15/`. Dark equivalents live in `before-dark/` and `after-dark/`. Actual restarted-app large and accessibility rendering is recorded in `after-large/` and `after-accessibility/` at Android fontScale 1.3 and 2. The selected-place after frame at 2.0 uses the existing large-text expanded-detail policy: the marker is visible above the scrollable card, and the long Saved identities wrap.

Final `after-accessibility/light-settings.png` was recaptured from `19cb9a0` at fontScale 2.0 and visually verified: System, Light and Dark are three full-width stacked choices, each label fits as a whole word, and Light remains visibly selected.

Baseline `before-large/` and `before-accessibility/` were captured after changing the OS font setting without restarting the app. Their metadata records the OS setting, but the React Native text did not consistently rescale. They are raw diagnostic records, **not matched large-text before/after evidence**. Two baseline files also failed route verification: `before-large/light-selected.png` shows the generic map/Saved peek, and `before-accessibility/light-selected.png` shows Settings. Neither is selected-place or expanded-card evidence. Requested route and font-scale metadata must always be read alongside the actual PNG and native XML.

`comparisons/` contains labeled side-by-side boards made by resizing these original frames only. `comparisons/manifest.json` records the original file hashes. No UI was simulated or painted into a screenshot.

Supplemental native action evidence is in `performance-after/show-all-20.png`, `pin-selection.png`, and `card-expansion.png`. Show All frames the 20 synthetic saves as ten visible clusters of two in the clear map area. Actual native marker selection and the subsequent details tap leave the selected marker above the card. These are after-only action captures, not invented matched baseline comparisons.

`performance-after/zoom-start.png` and `zoom-end.png` show actual native zoom from city to street scale. At the starting dense view, some outer cluster rings slightly overlap, while the number-four labels remain readable; no obscured count or missing-member defect was established. After Show All, the ten number-two clusters are separated and clear of header/dock overlays. The restrained marker/cluster design is retained.

## Validation boundaries

- Camera geometry has independent tests for small/large phone rectangles, orientation, keyboard overlap, outliers and the date line. Native evidence is Android Google Maps; physical Apple Maps padding/world limits remain founder acceptance.
- Source fixtures do not authenticate or create live saves. Provider sign-in, V2 transfer, real sharing and notification handoff are guarded by existing regression suites and require physical account/device retest.
- Photo 0/1/2/5, failed/missing image and restart persistence are exercised in component/service tests. Native gallery swipes use the two real bundled practice images; no extra Google photos were fetched for QA decoration.
- A cold Metro timeout initially produced invalid candidates; the final capture script validates screen identity and refuses missing/error screens. Final artifact paths were recaptured from the loaded app.
