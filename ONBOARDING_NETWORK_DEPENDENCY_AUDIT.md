# Onboarding Network Dependency Audit

Date: 2026-09-25
Scope: Onboarding V2 from Welcome through the account boundary. Real app sharing after onboarding is explicitly out of scope and remains live.

## Critical invariant

No network response is required to choose a platform/category, render the practice post, perform Share → More → Nearr, run the recognition choreography, create the onboarding-only save, open its detail, or continue through value and permission education.

## Former reachable dependencies and replacements

| Former file/component | Trigger | Did onboarding wait? | Failure affected UI? | Replacement |
| --- | --- | ---: | ---: | --- |
| `OnboardingV2PreAuth` → `bootstrapAnonymousOnboarding` | Opening V2 | Yes | Yes: connection recovery screen | Removed from pre-auth. The sandbox starts with `identityLifecycle: none` and persists through local AsyncStorage. |
| `onboardingTutorialFixture` → Supabase `get-onboarding-tutorial` Edge Function | Completing platform/interests | Yes | Yes: “Practice post unavailable” | Replaced by the synchronous 4-platform × 3-category local fixture matrix. |
| `onboardingTutorialPreview` and provider thumbnail URLs | Rendering challenge/practice | Yes for visual completeness | Yes: spinner/retry/blank preview | Replaced by bundled PNG/JPG assets selected by fixture key. |
| `Linking.openURL` to Instagram/TikTok/Facebook/YouTube | Starting practice | Yes | Yes: source-open error | Removed. The source UI and share sheet are realistic local simulations. |
| `hostShareSubmitter.submit` / `create-share-job` | Choosing Nearr | Yes | Yes: retry state | Replaced by a synthetic `onboarding-scripted-job:*` identifier created in the pure state transition. No request or database row exists. |
| `useOnboardingTutorialJobs` / Supabase share-job polling | Processing | Yes | Yes: spinner, terminal job error, retry | Replaced by the fixed 0/420/900/1380/1850 ms choreography and local result builder. |
| `tutorialResultFromShareJob` | Completed live job | Yes | Yes: no reveal without recognized candidate | Replaced by a render-complete local scripted result bound to the chosen fixture. |
| `PlaceImage` / Google Places photo resolution | Magic reveal/detail | Yes for imagery | Yes: remote fallback/attribution behavior | Replaced by the fixture’s bundled asset. The fixture contains name, address, coordinates, type, note, nearby examples, and map copy. |
| `react-native-maps` map tiles/provider | Magic transformation/detail | No, but visually network-sensitive | Blank/partial map possible | Replaced by a code-native local map card and marker. |
| `saveSavedPlace` | Older tutorial save CTA | Yes | Yes | Not used by the sandbox. The tutorial save is `onboarding-scripted-save:*` in V2 local state only. |
| `syncStateToServer` session lookup + onboarding RPC | Every state transition | No (fire-and-forget), but it still touched Supabase | Warnings/log noise | Adapter skips sync for `identityLifecycle: none` and all `onboarding://` / `onboarding_scripted` states. Legacy authenticated journeys retain their prior checkpoint sync. |
| `prepareSavedPlacesForMapHandoff` | “Making Nearr Yours” | Yes | Changed handoff result | Replaced by a local onboarding-card handoff. The demo never queries real saved places. |
| proximity/geofence/push registration | “Making Nearr Yours” | Yes | Changed readiness UI | Deferred until `auth_success`. Before auth, permission education records only the OS result and local eligibility. |
| onboarding analytics | Each transition | No; dispatched without awaiting UI | No consumer error | Retained as fire-and-forget. Rejection is logged/dropped by the existing analytics policy and cannot affect state. |
| account authentication (Supabase/Apple/Google/email) | Explicit account screen after the demo | Yes, intentionally | Auth errors remain visible on the auth screen | Retained as the deliberate boundary to the real product. It is not required for the magic-moment tutorial or its local detail. |
| compile-time feature/environment flags | Choosing V2 vs legacy bundle | No runtime request | No | Retained. The selected V2 implementation itself no longer depends on EAS, Railway, remote config, or environment health for progression. |

## Reachability result

The sandbox package is guarded by `npm run test:onboarding-no-live-services`. It scans the pre-auth controller, immersive share simulation, compatibility coachmark, fixture registry, and asset registry for live service imports, remote URLs, social launching, remote media, real saves, Places, workers, and share jobs.

OS location/notification prompts remain at their deliberate education screens. A denial or unavailable permission advances normally. Authentication remains online by design only after the complete offline demonstration.
