# Native visual findings

All PNGs in screenshots/ are direct ADB captures. Default display: 1080x2400/420dpi; narrow display: 900x1600/375dpi, font scale 1.6. Display settings restored after testing.

| Finding | Correction and evidence |
| --- | --- |
| Skipped optional practice falsely claimed a real saved place | Completion now distinguishes verified owned row from local walkthrough. 17 before, 18 after; renderer tests include missing/stale/real saved IDs. |
| Saved/search omitted local bundled thumbnail | Exact offline fixture identity resolves its bundled photo; never substitutes a demo photo for a real place. 26 before, 31 after; native search also exposed Photo of Dorset Quarry. Real renderer/helper tests added. |
| Visited prompt squeezed into letter-width column at 160% | Actions now own a full-width wrapping row; copy has minimum readable width and button text can shrink/wrap. 48 before, 49–50 after. Regression assertion failed before and passed after. |
| Reminder control | Switch remains inside its dedicated slot at default and 160%; lower controls reachable by scrolling. 28–30 and 48–50. |
| More/Activity | Full detail hides underlying Activity ownership; More menu shows only its actions. 24 and 51; Close/Done returns correctly. No ghosted visible menu in inspected transitions. |
| Empty state/filter | Category-specific zero result does not overlap top filters; reset removes message; Map/Saved dock remains. 45. |
| Photos | Compact-to-detail uses the existing hero; no flash observed in inspected transitions. This is observation, not frame-by-frame certification. Gallery swipe reached page 2 (46). |
| Map camera | Show All Pins, selection, pan/double-tap zoom exercised. Camera padding/edge geometry also has deterministic regression coverage; no exhaustive device-edge certification. |
| Onboarding | CTA/country picker remain reachable at narrow 160%; screens 11–13. Native picker cancel preserves blank value. |
| Status bar | Dark theme inspected with light status text; screenshot 49. |

Some provider category text in Quick Check and several dynamic accessibility phrases still use original/provider English. Do not interpret the locale matrix as a complete accessibility-copy translation audit.
