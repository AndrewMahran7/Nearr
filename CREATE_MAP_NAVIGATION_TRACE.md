# Create your map navigation trace

## Scope and baseline

- Branch: `feat/nearr-1.6-fieldnotes`
- Start SHA: `61c6d958d109e8a85ac1a5ca32d58852b935865b`
- Runtime: `1.6.59`
- Screen owner: `app/(onboarding)/account.tsx`
- Durable route owner: `AuthGate` in `app/_layout.tsx`, using `expectedOnboardingV2Route()`
- Post-auth destination owner: `completeAuthentication()` on the account screen, using the process-level coordinator in `lib/onboardingAccountTransition.ts`

The account screen has no changing React `key`, route generation parameter, or local mount effect that intentionally reloads it. The visible refresh was a route replacement back to the same screen after the first route action conflicted with durable state or lost its navigation owner.

## Route ownership map

| Event | Durable or process state | Navigation action | Destination | Effect that can reassert the account route |
|---|---|---|---|---|
| Onboarding reaches `growing_map` and continues | `continueOnboardingToAccount()` commits `stage=account_required` | No screen-owned navigation | `AuthGate` replaces to `/(onboarding)/account` | `AuthGate` continues to select account while the durable stage remains `account_required` |
| App starts or account screen remounts while signed out | Persisted V2 stage is read by `useOnboardingV2()` | `AuthGate.replaceOnce()` | `/(onboarding)/account` | The same `AuthGate` effect runs when auth or onboarding state resolves |
| Anonymous Supabase session changes or refreshes | `isAnonymousSession=true`, V2 stage remains `account_required` | `AuthGate.replaceOnce()` | `/(onboarding)/account` | `useAuth().onAuthStateChange()` updates the session consumed by `AuthGate` |
| Permanent session appears during provider auth | Post-auth routing latch is raised | `AuthGate` holds while the resolver runs | None yet | When the latch falls, a still-current `account_required` stage can select the account continuation route |
| Successful new-account transition | `completeOnboardingV2PermanentAccountLink()` durably commits permanent identity and `auth_success` | The account transition owner replaces once | `/(onboarding)` | `AuthGate` holds while the post-auth resolver latch is raised, then agrees because `auth_success` maps to `/(onboarding)` |
| Successful established-account transition | Existing-account bypass/completion is durably committed | The account transition owner replaces once | `/(tabs)/map` | The established state maps to the map and no longer selects account |
| Auth callback, listener replay, double tap, or remount while transfer is running | Coordinator is `ACCOUNT_TRANSITION_PENDING` or `ACCOUNT_TRANSITION_IN_PROGRESS` | Observer awaits the owner's promise; no navigation | Owner's resolved route | Passive replay cannot dispatch another route |
| Signed-in Continue after transfer already completed but its route dispatch was lost | Coordinator is `ACCOUNT_TRANSITION_COMPLETE` with a cached route | One explicit recovery claimant replaces once, without rerunning transfer | Cached resolved route | Subsequent recovery, listener, and foreground replays get no navigation ownership |
| Back before permanent auth | `backOnboardingV2FromAccount()` commits a stable previous stage and anonymous identity | No button-owned router action | `AuthGate` replaces to `/(onboarding)`; map-backup cancellation maps to `/(tabs)/map` | The account route cannot reassert because durable stage is no longer `account_required` |
| Back after permanent auth | Permanent identity and transfer cannot be undone | Back affordance is hidden; queued handler returns | Current forward flow | No invalid reverse action is dispatched |
| Existing-account sign-in entry | This is not an anonymous onboarding transfer | Existing `router.back()` or onboarding fallback remains | History entry or `/(onboarding)` | The fresh-user durable account gate does not own this entry path |
| App foreground | Notification/location jobs run; no account navigation is emitted | None | Current route | `AuthGate` only reconciles if auth or durable onboarding inputs actually changed |

## Continue before the fix

1. Authentication or account transfer completed once.
2. The process coordinator cached `ACCOUNT_TRANSITION_COMPLETE` and the resolved route.
3. A remount or auth-session update left the visible account screen mounted again.
4. The signed-in Continue handler called `completeAuthentication(..., { retry: true })`.
5. The coordinator returned the completed promise as a non-owner replay before considering retry.
6. The account screen awaited the promise and returned because `claim.owner` was false.
7. No code dispatched the cached destination, so the user saw the same screen after a visible refresh.

## Continue after the fix

1. Every provider and signed-in recovery still enters the same `completeAuthentication()` path.
2. The first claimant alone executes profile resolution and account transfer.
3. Listener, double-tap, in-flight remount, and foreground replays remain observers and cannot navigate.
4. The first explicit signed-in Continue against a completed coordinator may claim `navigationOwner` for the cached result.
5. It raises the post-auth routing latch, awaits the already-resolved route, commits the authenticated transaction, and calls `router.replace(route)` once.
6. The transfer is not repeated. Further completed-state replays cannot claim navigation.

The screen keeps direct ownership of the post-auth edge because it alone knows the save-aware resolved destination. `AuthGate` is held by the existing post-auth latch until that destination is dispatched.

## Back before the fix

1. The handler cancelled an in-progress account link, which restored anonymous identity.
2. For a normal fresh-user journey, cancellation did not change `stage=account_required`.
3. The handler called `router.back()`.
4. `AuthGate` observed the unchanged durable stage and replaced `/(onboarding)/account` again.
5. The account screen unmounted and remounted, producing the visible refresh.

## Back after the fix

1. Back first cancels any unfinished link operation.
2. `goBackOnboardingV2FromAccount()` durably moves the fresh-user journey to a stable previous stage:
   - current second-half journey: `notification_education`
   - older tutorial checkpoint: `first_magic_moment_complete`
   - early fallback: `overview`
   - completed map-backup entry: `onboarding_complete`
3. The reducer clears `accountLinkStartedAt`, restores `identityLifecycle=anonymous_active`, and records the cancellation.
4. The handler does not issue a competing route action.
5. `AuthGate` sees the new durable stage and performs the one route replacement.

The immediately preceding `making_nearr_yours` and `growing_map` presentations auto-advance, so returning to either would create another forward bounce. `notification_education` is the existing stable decision screen in the current flow.

Once a permanent session exists, Back cannot reverse authentication or the transfer. The account screen therefore omits the Back affordance in that state, as allowed by the existing flow semantics.

## State ordering

Continue uses this order:

1. Supabase establishes the permanent authenticated session.
2. The single account-transition owner resolves account status and durably completes or bypasses the transfer.
3. Fresh-user V2 state becomes `auth_success`; an established/completed account becomes map-owned.
4. The resolver returns the destination only after those writes finish.
5. The account screen's navigation owner replaces to that destination once.
6. `AuthGate` subsequently observes and agrees with the durable state.

Back uses this order:

1. Any uncommitted link attempt is cancelled.
2. The stable previous onboarding stage is persisted.
3. `AuthGate` observes that state and replaces once.

## Higher-level gate audit

- `AuthGate` is the only automatic owner of durable V2 stage routing. Its `pendingOnboardingNavigationRef` suppresses repeated replacements for the same edge. During account resolution it explicitly yields to the post-auth routing latch, including the signed-in second-half continuation branch.
- `useAuth` publishes session changes but does not navigate.
- `useOnboardingV2` publishes durable state changes but does not navigate.
- The installation lifecycle and theme/layout providers do not choose the account route.
- The app-foreground listener in the root layout runs notification, token, geofence, and proximity work. It has no account route action.
- `app/index.tsx` only selects an initial route and agrees that `account_required` belongs to the account screen; ongoing reconciliation remains with `AuthGate`.
- The account screen has no route `key` or generation prop that explains the refresh independently of route reconciliation.
- The single-flight coordinator exposes `PENDING`, `IN_PROGRESS`, `COMPLETE`, and `ERROR`. Passive completed/error replays remain no-ops; only one explicit completed-route recovery can navigate.

## Regression coverage

`scripts/testCreateMapNavigationRegression.ts` covers:

1. one Continue claimant and one navigation owner;
2. double-tap coalescing;
3. auth-listener replay;
4. remount during a slow transition;
5. one cached-route recovery without a repeated transfer;
6. duplicate recovery and foreground replay suppression;
7. durable Back to the stable previous stage;
8. Back stability across `AuthGate` reconciliation and remount;
9. established-account map routing;
10. fresh-user account routing and signed-in Back removal.

## Physical evidence

The existing native Android account reference at `artifacts/fieldnotes-implementation/onboarding-account-transition/android-account.png` remains the visual baseline. A live Pixel 8a development session on 2026-10-13 exposed the same hierarchy and copy (`Create your map`, Google, More options, and pre-auth Back) from the current working-tree bundle. This change does not modify layout, typography, colors, icon, spacing, or button styling. End-to-end permanent authentication was not submitted on the emulator; the founder retest remains the authority for the physical iPhone auth round trip.
