# Fieldnotes accessibility polish — October 15

This report separates executable/source evidence, Android emulator captures, and checks requiring a physical iPhone. It is not a claim of complete accessibility certification.

## Readability and content hierarchy

- **Selected card:** real place name and locality precede the reason. A missing/failed photo does not reserve a generic placeholder. Title is 21/26; locality/source 13/18; real reason 14/20. At fontScale >= 1.5 identity wraps without a line cap and the identity row can wrap. The selected map marker is placed in usable visible map space; accessible text sizes also open the scrollable detail surface.
- **Search:** address and saved-note metadata move from 12pt caption to 13pt semantic metadata. At fontScale >= 1.5 title/address/note stop truncating. Result rows have natural height and the list is virtualized. Keyboard search is explicit, an error has a real retry action, and stale results cannot be mistaken for the new query.
- **Activity:** locality/status/time metadata uses 13pt semantic metadata; title/locality/time stop truncating at accessible scales. Empty content has one caught-up message and map return action, without an extra finding introduction. Real backend status remains authoritative.
- **Source ribbon:** source label 12/17 and caption 13/19; compact title has no line cap at fontScale >= 1.5. Source-frame labeling distinguishes provenance from independently sourced destination photos.
- **Saved:** existing large-text wrapping and content-driven rows are preserved. Featured source-only/no-photo states become compact, and photo features use a shallower 2:1 ratio. Full Saved remains a virtualized list.
- **Settings:** the shared Light/Dark/System theme remains intact. A late stored theme read cannot overwrite a newer user choice. At fontScale >= 1.5, appearance options stack as full-width choices so System does not split inside a narrow third-width pill. Default and 1.3 layouts retain the horizontal row. No screen is covered with a fake theme/splash to hide a transition.

Decorative eyebrows, small photo provenance badges and dense-map marker labels remain intentionally smaller. This pass does not claim every text element is 13pt or that arbitrary native map labels are controlled by Nearr.

## Static contrast measurement

The following ratios were computed from current opaque sRGB semantic colors in `constants/colors.ts` using relative luminance. Artifact: `artifacts/fieldnotes-oct15/accessibility-palette.json`.

| Foreground / background | Light ratio | Dark ratio |
| --- | ---: | ---: |
| Main text / canvas | 13.92:1 | 15.76:1 |
| Secondary text / canvas | 5.30:1 | 8.97:1 |
| Secondary text / surface | 5.72:1 | 7.70:1 |
| Orange accent / canvas | 5.64:1 | 9.06:1 |
| Selected-control text / primary | 12.11:1 | 12.92:1 |

`testFieldnotesFoundation.ts` passed 35 contrast/feedback checks, including text/accent across all three semantic backgrounds and relevant status/gradient pairs. These measurements concern opaque color pairs; they do not establish contrast over destination photographs, translucent surfaces or third-party map tiles.

## Controls, semantics and feedback

| Control / surface | Source or executable evidence |
| --- | --- |
| Show all pins | Visible text plus fit icon; minHeight 44; accessibility label distinguishes all saved vs currently filtered saved pins. Context row wraps. Filter sheet offers explicit All places reset + framing. |
| Search close, paste and clear | 44×44 controls, explicit labels, themed pressed state. Close/selection dismiss the keyboard. |
| Search scope | minHeight 48, selected tab state, wrapping label. Saved/local and discovery semantics remain distinct. |
| Search retry | minHeight 44, Retry place search label; failed query can be retried without editing. No automatic retry loop. |
| Search save | One pending-save action at a time, accessible busy/disabled state and visible spinner; successful haptic remains owned by persistence completion. |
| Selected card | Whole identity/details surface is pressable; label includes actual name/locality and hint identifies details. Separate close control is 44×44. |
| Map/Saved dock | Each tab minHeight 48 and selected state; it is not a second floating sheet layered over full Saved. |
| Category picker | 44pt chip, 52pt choices, 44×44 close; selected state plus checkmark/background, not color alone. |
| Activity | Header back/actions 44×44; existing swipe actions include accessibility alternatives; status/identity labels remain truthful. |
| Settings | Appearance options minHeight 44 with selected state; switches carry labels/hints; QA reset route and action guards are enforced independently of visible sections. |
| Gallery/source | Source vs destination origin is announced truthfully; unavailable/missing frames do not pretend to be independent photos; usable photo count derives from remaining real images. |

Native map markers are intentionally density-scaled (20/26/32 category, 46 photo, 60 selected). These visual sizes are not represented as universally compliant 44pt hit targets. Saved/search provide textual routes to the same places. Physical VoiceOver/TalkBack exploration and dense-pin touch accuracy remain explicit QA items.

## Motion and camera interaction

- Show All respects Reduce Motion with zero-duration/direct camera behavior.
- Selected-marker correction uses actual map projection and measured obstruction geometry. It does not hardcode a latitude shift, continuously force zoom, or continue stale correction after the user pans.
- Existing camera transaction ownership remains in force; repeated Show All cannot stack competing commands.
- Existing Saved sheet uses direct animated-value updates when reduced motion is enabled. Sort and filter modals now use `animationType="none"` under the same preference.
- Gallery already suppresses fade/scale/spring navigation under Reduce Motion; this behavior is preserved.
- Search changes add no animation. Press feedback is a color/opacity state. Existing haptics coalesce within 600ms, skip background/web, and never block the action.
- `useReduceMotion` starts conservatively until the platform preference resolves and observes live preference changes; startup/auth behavior was not changed.

## Executable coverage

- Search real component + real hook: fontScale **1, 1.5, 2.2**, exact saved identity, close semantics, retry, save lock and query continuity.
- Selected card real component: fontScale **1, 1.5, 2.2**, four image-origin/missing states, identity order, details/close and failure fallback; **90 assertions** passed.
- Saved real components: small/large/empty libraries, exact selection, three text scales, source/no-photo/failed-photo density; **74 assertions** passed.
- Saved sheet real component: sizes 0/1/3/5/20/125, snaps, gestures, selection and Reduced Motion; **155 assertions** passed.
- Theme real provider: first-install Light on dark system, stored Dark, System changes, late-read race, invalid preference/storage failure.
- Activity source/presentation: candidate/extraction fallback, lifecycle grouping, metadata/line-limit contract, no synthetic progress or additional photo lookup.
- Existing foundation: **35 contrast/feedback checks** passed.
- Camera geometry and production-callback tests separately cover measured visible area, long/taller card implications, keyboard/safe-area changes, stale projections and user ownership. Counts/final pass records are in the camera regression report.

React Native host doubles validate JS props/state and lifecycle; they do not measure native text rasterization, focus order, actual screen-reader announcements or physical touch hit-testing.

## Native evidence and pending physical checks

Baseline Android debug captures at fontScale 1 exist under `artifacts/fieldnotes-oct15/before/` and `before-dark/`. Metadata identifies Pixel 8a AVD, 1080×2400, baseline SHA `f51dfdb75dcdee3e02ceb848875e2cea46632d42`, and `physicalIos: false`.

Actual after captures at Android fontScale 1.3 and 2.0 were taken after restarting the app so React Native text adopted the setting; paths and observed outcomes are recorded in `FIELDNOTES_VISUAL_BEFORE_AFTER.md`. At 2.0, Saved identities visibly wrap and the selected marker remains above the expanded, scrollable detail. Baseline large/accessibility captures used a hot OS configuration change and did not reliably rescale app text, so they cannot establish a matched typography improvement. Their mislabeled selected-place frames are excluded from selected-card evidence. Native Settings at 2.0 additionally exposed an awkward split in the System label; the final `19cb9a0` recapture confirms three full-width stacked choices, whole-word System/Light/Dark labels, and preserved Light selection.

Founder physical-iPhone QA should include: largest comfortable system text size, Light/Dark/System navigation, VoiceOver labels and focus order, Show All/filter reset, selecting a pin with compact/expanded card, deliberate pan during movement, search keyboard/retry/failed-save recovery, Activity close/scroll, original-post labels, and Reduce Motion transitions. Physical results must not be inferred from Android debug or component tests.
