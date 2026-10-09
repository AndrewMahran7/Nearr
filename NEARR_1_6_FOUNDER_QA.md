# Nearr 1.6 Fieldnotes — founder visual QA

Use the new **Development** native build and the Development backend. This is a review build; there is no Production release, Production OTA or App Store submission. Build identity and installation link are recorded in `FIELDNOTES_NATIVE_BUILD_REPORT.md`.

Compare the app with the approved Fieldnotes Light boards first, then Dark. Native Android screenshots provide additional implementation evidence; they do not approve iOS host geometry, VoiceOver, Dynamic Type or tactile feedback.

| # | Check | Acceptance |
|---|---|---|
| 1 | Home screen icon | Ivory field, solid botanical pin, one orange sparkle; no old glowing mark |
| 2 | Fresh installation | Visible startup, Light default, stable navigation; record any extension/account replacement behavior |
| 3 | Phase 1 onboarding | Photo-led practice, offline/local deterministic result, clear demonstration language |
| 4 | Phase 2 real practice | Real curated post opens; actual share/job/result; Skip/Later and interrupted return remain valid |
| 5 | Google sign-in | One provider launch; success preserves prior saves and routes correctly; cancellation recovers |
| 6 | Apple sign-in | Native button, cancellation/error/success, existing/new account ownership intact |
| 7 | Main map | Calm chrome, correct map camera, at most three local photo pins, readable clusters |
| 8 | Select several pins | Exact place identity, compact photo card, stable camera and sheet dismissal |
| 9 | Saved | One featured memory for a small unfiltered collection; compact rows without duplication |
| 10 | Search Saved | Exact selection, useful empty state, keyboard never hides the action |
| 11 | Place detail | Place/photo first; Directions; original; why saved; reminders; visit; management under More |
| 12 | Gallery | Swipe a real five-photo cached place; count is truthful; also check zero/one/two photos |
| 13 | Watch original | Correct source/platform; deleted/private/offline source offers an honest recovery |
| 14 | Directions | Correct destination in the external maps app; return preserves detail |
| 15 | Activity processing | Honest indeterminate state; no invented percentages or save confirmation |
| 16 | Needs your check | Clear reason and accessible next action |
| 17 | Quick Check | Original evidence and destination images labelled separately; Possible match; Save and Not this remain distinct |
| 18 | Multi-place | Independent inspect/checkbox; Select all; zero selected disabled button; partial retry does not repeat durable successes |
| 19 | Find a new place | Saved/new sections clear; active query only; select and save correct identity |
| 20 | Fresh Instagram share | Extension acknowledges acceptance, then actual job persists and completes/recovers |
| 21 | YouTube / TikTok / Facebook | Exercise each supported input; verify source identity and failure recovery |
| 22 | Force-close and reopen | State restores; no duplicate saves, stuck spinner, blank screen or camera jump |
| 23 | Dark mode | Every surface adapts, including onboarding, authentication, gallery, modals and Settings |
| 24 | Large text | Test at 150%, 200% and largest accessibility sizes on a small iPhone; critical text/actions remain reachable |
| 25 | Reduce Motion | Set before launch and while open; no curved flight/pulse; final state remains clear |
| 26 | 20+ saves | Smooth search/scroll; test 51+ to confirm fully compact virtualized library |
| 27 | No / one photo | Honest fallback/count; no duplicated or unrelated images |
| 28 | Share Extension | Instagram/TikTok/Safari host height, safe areas, keyboard, error scroll, Done/Open Nearr, app appearance continuity |
| 29 | Haptics | Subtle selection/committed success/recovery feedback; no polling or repeated burst buzzes |
| 30 | Nearby | Existing permissions, notifications, denied-state recovery, location freshness and visit/reminder behavior |

For a defect, record the build ID, appearance, device/iOS version, text size, Reduce Motion setting, exact taps, and screenshot/video. Compare screenshots at the same content state: missing photos and uncertain matches should remain truthful.

Expected platform differences are listed in `FIELDNOTES_VISUAL_DEVIATIONS.md`. Stop after founder review; do not automatically start another redesign, merge or deploy to Production.
