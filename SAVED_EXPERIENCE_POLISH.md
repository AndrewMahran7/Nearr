# Saved experience — October 15 Fieldnotes polish

Baseline: `f51dfdb75dcdee3e02ceb848875e2cea46632d42`. Work is frontend-only and preserves the existing coordinated Map/Saved dock and expandable library.

## Findings and decisions

| Observation | Verdict and evidence | Implementation | Validation |
| --- | --- | --- | --- |
| Featured item repeated in adjacent rows | Dismissed for the verified baseline: `SavedPlacesLibrary` already uses `results.slice(1)` whenever the leading result is featured. No saved-data deduplication change is justified. | Preserve the rule. Add an exact rendered-ID uniqueness assertion rather than merely checking row count. | Mounted production components at 0, 1, 3, 5, 20, 50, 51 and 125 saves. |
| Feature consumes too much space | Confirmed in code when a retained image is available: the 1.55 aspect ratio allocates more image height than the compact library needs. | Keep the editorial memory, use 2:1 imagery (22.5% less image height at equal width). A source-only frame stays a compact, explicitly labeled row. Missing/failed images already had compact fallback; preserve it. | Saved component tests cover real-photo/source/no-photo/failed-photo presentations. Native screenshot comparison below. |
| Source thumbnail wins over cached destination | Confirmed: Saved passed both `sourceUri` and `initialPhotoUrls` to `PlaceImage` without `preferPlacePhoto`. | Prefer the known retained photo. Preserve source context with a Post label when the displayed imagery is source media. | Mounted Saved component asserts destination preference and snapshot-only rendering. No additional Google hydration on image failure. |
| Selected card is tall and identity is secondary | Confirmed: fixed 156pt hero, then reason, then identity and full address. | Compact 88×96 thumbnail beside name/locality; reason below; explicit View details. Missing/failed imagery reserves no blank hero. Source/unknown photos receive truthful labels. | 90 mounted-component assertions cover 3 text scales, 4 image states and exact open/close callbacks. Parent map measures resulting height for camera clearance. |
| Generic saved-count card when a real pin is selected | Not reproduced in the baseline branch conditions: `MapBottomSheet` is excluded when `selected` is truthy; `SelectedPlaceCard` requires a real saved object. | Preserve mutual exclusion; no invented selection fallback. | Root map runtime tests/visual evidence cover selection and dismissal. |
| Large collections are not compact/virtualized | Dismissed: feature is disabled above 50 saves; FlatList renders batches of 7 with windowSize 7. | Keep bounded virtualization and stable saved IDs. No nested ScrollView added. | 125-place component case and matched Android Saved-scroll observation. |
| Search/filter/sort are difficult to reach | No structural access defect: search and both controls precede feature content. Controls are 46pt minimum. | Preserve their positions. Sort/filter modals now honor Reduce Motion. | Search/empty cases; sheet snapping and Reduce Motion tests. |
| Map and Saved compete for gestures | Existing split is sound: only sheet header owns the pan responder; expanded library owns scrolling; selected detail suppresses Saved sheet. | Retain coordinated combination. Root map changes manage the usable viewport. | 155 mounted sheet assertions: open/collapse/minimize/reopen, selection identity, orientation height, horizontal-vs-vertical header gestures, Reduce Motion, 0/1/3/5/20/125 saves. |

## Focused validation

Run from the active worktree:

```powershell
npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesSavedComponents.ts
npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesSelectedCard.ts
npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesSavedSheet.ts
npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesMapSearch.ts
npm.cmd run test:saved-place-snapshots
```

All commands passed during implementation. These are actual React component behavior tests with native host doubles, not screenshots or physical-iPhone evidence. Default, 1.5× and 2.2× text assertions verify untruncated identity at large scales; native text layout is assessed separately.

## Native evidence

Matched Android debug capture paths: `artifacts/fieldnotes-oct15/before/light-real-saved.png`, `before/light-selected.png`, and corresponding files under `after/`. Detailed image comparisons and final capture status live in `FIELDNOTES_VISUAL_BEFORE_AFTER.md`; performance samples are `performance-before.json` and `performance-after.json` in the same artifact directory. These are emulator observations, not founder physical-iPhone approval.

Data, saved ordering, source URLs, account transfer, navigation ownership and saved-place removal semantics are unchanged.
