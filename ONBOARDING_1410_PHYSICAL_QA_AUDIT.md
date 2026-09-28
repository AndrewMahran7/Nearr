# Nearr onboarding 14:10 physical QA audit

Date: 2026-09-28 (America/Los_Angeles)
Scope: Development onboarding only. Production, Jev, gallery, monetization, and recognition architecture were not changed.

## Evidence boundary

The referenced founder recording was not present in the repository or attachments available to this worktree, so this audit does not claim frame-by-frame playback. It correlates the founder's supplied observations with Development telemetry, the persisted onboarding session, the exact share job, and source inspection.

The correlated session belonged to anonymous user `2fa029e0-d23e-4624-90f2-fc37849d27f6`. Its real-practice share job was `7de2b37f-0aa5-41d0-9443-db5310f458a5`, for Instagram post `CM2QChDn2Nk` and Country Roads Antiques. The worker could not acquire video through yt-dlp or ScrapeCreators and produced `missing_video`, but the normal Quick Check path resolved the job and saved place `1aa42ac9-5245-41c8-b990-7a82223304c9`. Recognition was therefore not the end-flow failure.

## Correlated timeline

| Local time | Durable evidence | Interpretation |
|---|---|---|
| 14:10:37.664 | onboarding session started | Fresh onboarding journey |
| 14:10:53.880 | map opened | First premature map ownership |
| 14:10:54.051–14:10:55.270 | practice started, map opened again, anonymous session established, exact source opened, share received | Phase 2 crossed routes while the external post was launching |
| 14:11:00.585 | map opened | Another map flash during active practice |
| 14:11:08.430–14:11:08.460 | real save and real practice completed | Country Roads Antiques was successfully saved |
| 14:11:09.299–14:11:15.840 | education, permissions, setup, map-ready events | Second half completed without a backend blocker |
| 14:11:15.844–14:11:18.698 | activation challenge, growing map, personalized activation, onboarding complete | State machine graduated the anonymous identity too early |
| 14:11:18.693–14:11:18.699 | map opened twice around completion | Duplicate final-map presentation |
| 14:11:27.527–14:11:27.540 | map backup started, email/account/auth viewed; email-started emitted twice | User had to enter Settings to finish the account lifecycle; the account screen remounted |
| 14:11:29.274–14:11:29.289 | auth and Google started | One provider attempt began; no completion/failure followed in the inspected interval |

The persisted session ended with outer lifecycle `permanent_account_linking`, JSON stage `account_required`, JSON identity lifecycle `anonymous_active`, and behavioral onboarding already complete. That impossible combination is the primary P0 evidence.

## Root causes and disposition

| Priority | Failure | Root cause | Repair |
|---|---|---|---|
| P0 | End flow reached normal map before account linking | `continueOnboardingAfterMakingNearrYours` treated `anonymous_active` as ready for final activation | Every non-permanent identity now transitions to `account_required`; successful transfer returns to activation and the map once |
| P0 | Duplicate account route/remount from Settings | Settings requested the durable backup state and also imperatively pushed the account route | Settings only changes durable state; AuthGate is the sole navigation owner |
| P0 | Phase 2 flashed the map around the social-app handoff | Practice stages were declared map-owned | Active first-practice stages now belong to `/(onboarding)` and render one persistent practice surface |
| P1 | A received share could still present a launch-oriented CTA | Map coachmark combined launch and processing responsibilities | The continuous practice screen changes its sole primary action after receipt and cannot relaunch the post while processing/reviewing |
| P1 | Final activation repeated notification/proximity initialization | Final UI duplicated session-owned side effects | Final UI no longer registers push, geofences, or proximity; authenticated root lifecycle owns initialization |
| P1 | Final payoff could look synthetic | Final UI used generic tutorial treatment | Resolved real practice uses the durable saved-place name and media; opt-out retains tutorial wording |
| P1 | Installed icon was the old fork/pin artwork | Tracked canonical asset/config did not contain the founder's starred artwork | Exact supplied `assets/icon.png` is canonical for iOS and Android adaptive foreground; version/runtime advanced to 1.4.57 |

## Verification completed in source

- The deterministic full journey covers direct success, needs-review, opt-out, existing account, new account transfer, permission denial, force-close/resume, and offline Phase 1.
- Quick Check is the only preserved child route during needs-review; all other active practice product-route detours reconcile to onboarding.
- Google auth still has one provider browser launch site and one in-flight operation latch.
- Account loading initializes watches/tokens/geofences but does not call `checkProximityOnce`; only a genuine foreground transition performs a one-shot proximity evaluation.
- The local fixture poster remains underneath a bundled video whose opacity stays zero until ready.
- Development Supabase remained `qnfxnmvxpjzfydgudtvs` (Nearr-Dev). Production was not touched.
- Development Railway media-worker was read-only checked healthy; no backend deploy was required for this source-only repair.

## Remaining physical proof

A new Development binary is required because OTA updates cannot change the installed home-screen icon. The branch must be installed on a physical device and the founder journey rerun before Production approval. Source tests and generated native assets can prove configuration and state ownership; they cannot prove the icon displayed by SpringBoard/Launcher or substitute for watching the unavailable recording.
