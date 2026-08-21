# MULTI-SELECT-QA — Multi-Place Selection Validation

Run on a physical iPhone against Nearr-Dev after integration. Do not use production data or deploy from this branch.

## Independent-place review

- [ ] Open a result containing exactly 2 independent places; verify both can remain selected simultaneously.
- [ ] Open a result containing 5 or more independent places; verify Select all and Clear all appear.
- [ ] Select a subset, tap Save selected, and verify only that subset is saved.
- [ ] Clear all, verify Save selected is disabled, then use Save all and verify every eligible resolved place saves.
- [ ] Deselect one row after Select all; verify the other selections survive scrolling and row expansion.
- [ ] Back or cancel after changing selections; verify nothing is saved.

## Identity, dedupe, and partial results

- [ ] Verify an already-saved item is clearly marked and no duplicate saved-place row is inserted.
- [ ] Verify repeated mentions with the same provider ID persist one saved place.
- [ ] Verify same-name branches with different provider IDs/addresses can both be selected and saved.
- [ ] Verify a hybrid result supports one candidate from each ambiguous scene plus every selected resolved scene.
- [ ] Verify choosing candidate B in one scene deselects candidate A in that scene only.
- [ ] Verify two resolved rows can save while an unresolved third row remains available for search/review.
- [ ] Inject one batch-save failure; verify successful rows stay saved and the failed row stays selected with a retry message.
- [ ] Verify scene/timestamp labels remain attached to the correct logical place while scrolling and expanding details.

## Accessibility and layout

- [ ] With VoiceOver, confirm independent rows announce checkbox state and “Select/Deselect [place].”
- [ ] With VoiceOver, confirm same-scene alternatives announce radio state and “Choose [place] as the match for [scene].”
- [ ] Verify Select all, Clear all, Save selected, and Save all have unambiguous labels.
- [ ] Test the largest iOS accessibility text size; verify controls remain reachable, labels wrap, and the sticky action area does not cover rows.
- [ ] Verify selected state remains apparent without relying on color alone.
