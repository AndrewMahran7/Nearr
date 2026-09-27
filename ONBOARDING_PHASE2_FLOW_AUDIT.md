# Onboarding Phase 2 flow audit

Audit date: 2026-09-26. Scope: Development onboarding lineage beginning at `7eb7d64475701957b86daabbf3ee67df898619c7`.

## Before this fix

The scripted Phase 1 flow ended at `fixture_map_payoff`. Closing its place card transitioned `fixture_map_payoff -> phase2_intro`; choosing real practice bootstrapped anonymous auth and transitioned `phase2_intro -> practice_ready`. Expo Router then assigned `practice_ready` and the other real-practice stages to `/(tabs)/map`.

The map coachmark opened a platform home URL (`instagram://app`, `https://www.instagram.com/`, or another selected social app). No exact source was registered before leaving Nearr. An incoming share was attached later by `prepareOnboardingV2RealPracticeShare` and then used the normal share screen, Development job, recognition, candidate review, and saved-place reconciliation.

The local tutorial pin was injected only while `isOnboardingV2Phase2MapState` was true. Skipping Phase 2 immediately changed the stage to `why_nearr`, so the pin disappeared even though the product had said it was on the map. A long-lived map tab could also retain an expanded tutorial detail after onboarding, and `shouldRenderMapTopChrome` correctly hides filters behind an expanded detail. The retained onboarding selection therefore made canonical filters appear permanently missing. A remount with no injected tutorial pin could start from the continental-US fallback.

## Selected real practice source

- Internal source ID: `instagram-2nd-floor-post`
- Exact source: `https://www.instagram.com/p/DYpcd2ZBTsZ/`
- Expected recognition: **2nd Floor**, 126 Main St, Huntington Beach
- Evidence: this source is an existing known-good anchor in `scripts/shareRegressionFixtures.ts`, with candidate/address expectations.
- Reachability: direct HTTP HEAD returned 200 on 2026-09-26.
- Suitability: public, place-focused, already curated by Nearr, no private user content, and covered by an existing recognition regression contract.

## Current flow and state transitions

1. Phase 1 stays deterministic and local: `fixture_map_payoff` renders the scripted place/card without a live service.
2. Closing the card: `fixture_map_payoff -> phase2_intro`.
3. **Try with a real video** establishes/reuses the Development anonymous identity, registers the curated practice fixture, and transitions `phase2_intro -> practice_ready`.
4. Router ownership moves to `/(tabs)/map`. The local tutorial place remains injected.
5. **Open practice video** registers an exact pending attempt, then opens the exact HTTPS universal/app link. If the OS rejects it, an in-app browser opens the same exact post, never Instagram home.
6. The user performs the real boundary: Instagram Share -> Nearr share extension.
7. `app/share.tsx` remains authoritative for the real Development job, recognition, auto-save/candidate selection/multi-review/manual fallback, and saved-place result.
8. The exact source is marked as guided-practice success only after the authoritative saved-place ID exists.
9. A different real post replaces only the guided attempt and proceeds through normal Nearr behavior. It may complete optional Phase 2, but does not emit the exact guided-practice-success event.
10. A successful save or **I’ll try this later** transitions to the lightweight `first_magic_moment_complete` acknowledgement. **Set up Nearr** then continues to `why_nearr` and permission/value education.
11. Final completion transitions `activation_challenge -> onboarding_complete` and returns to `/(tabs)/map`.

## Recovery and review behavior

- Return without sharing: state stays `first_independent_external_video_opened`; the compact practice card remains available for retry or opt-out.
- Exact source shared: source identity/normalized URL must match the registered attempt before guided success can be claimed.
- Different source shared: the normal pipeline accepts it and the guided source is not falsely credited.
- Recognition needs review: the normal share screen’s candidate/multi-review state remains authoritative; onboarding does not auto-complete until a real saved-place ID is reconciled.
- Open/network failure: inline recoverable copy is shown and opt-out remains enabled.
- Skip: no real-share completion is recorded and no error is shown.

## Tutorial-place lifecycle and viewport

The scripted save is explicitly an install-local starter place, not a backend `saved_places` row. It is visible for `new_user_v2` from map payoff through Phase 2 and `onboarding_complete`/`graduated`. It is removed when the install-scoped onboarding state is reset/deleted/reinstalled, or when an established account bypasses onboarding. It is never merged into that account.

Because this local place remains in the map dataset, a map remount has a sensible first-place camera anchor instead of the broad fallback. When the long-lived tab crosses from Phase 2 ownership to completion, it collapses the onboarding detail in place; it does not animate or reset the camera.

## UI ownership

The normal map owns search, canonical category filters, Queue, gestures, bottom-sheet/carousel behavior, and the Settings tab. The compact Phase 2 dock is rendered only for `practice_ready` and return-without-share. It is placed below the existing search/filter/Queue bands. Completion hides the coachmark and restores normal chrome by ending expanded onboarding-detail ownership.
