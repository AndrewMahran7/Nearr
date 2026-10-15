# Create your map Continue runtime trace

## Scope

- Lane: Development only (`Nearr-Dev`, project ref prefix `qnfx…`)
- Physical attempt: 2026-10-15 14:11:46 America/Los_Angeles (21:11:46 UTC)
- App/runtime: 1.6.59
- Starting source: `e87c08cc2052e5c1b63a0f41d187018936f93000`
- Production was not queried or changed.

Identifiers below are short one-way correlation hashes. No UUID, email, token, or transfer secret is included.

## Retained runtime evidence

The Development analytics stream records app 1.6.59 starting at 21:11:12 UTC. The account screen then emitted `onboarding_email_started` at 21:11:12, 21:11:27, 21:11:31, 21:11:33, 21:11:35, 21:11:37, 21:11:40, 21:11:42, 21:11:49, 21:11:51, 21:12:48, and 21:12:50. That sequence proves repeated account-screen mounts/reassertions during the recording window; it is not a splash transition.

The permanent auth user (`14bdc9308ad7`) was valid and non-anonymous. Its auth row was refreshed at 21:12:49.662 UTC, matching the signed-in Continue handler's `refreshSession()` call. The permanent profile existed and the account already owned three saved places. Authentication, profile readiness, account establishment, and map ownership were therefore available.

The active local journey (`df8511474a75`, anonymous owner `8b80e3910719`) remained:

| Field | Value after the failing tap |
|---|---|
| auth session | valid permanent session |
| durable stage | `account_required` |
| transition state | `permanent_account_linking` |
| grant | `pending`, past its original 24-hour expiry |
| destination on grant | unset |
| grant completion | unset |
| real source saves | 0 |
| deferred source jobs | 1 |
| deferred media tasks | 1 |
| permanent profile | ready |
| established account | true |
| destination map | already owned, 3 saves |

The journey began on October 10. It recorded Phase 2 deferral, permissions, Create your map, Google completion, then auth failure/resume events. Its raw transfer secret was held only on device; the old client discarded that secret when its local 24-hour timestamp elapsed. The subsequent resume RPC can only replay a grant already marked `completed`, while this grant was still `pending`. The transfer resolver therefore could not produce a completed destination.

## Exact pre-fix path

1. `handleContinueSignedIn()` claimed the account transition and entered loading.
2. `completeAuthentication()` confirmed the permanent user and called `resolvePostAuthRoute()`.
3. The durable V2 state was still `account_required` / `permanent_account_linking`.
4. `finishOnboardingAccountTransition()` refreshed the valid permanent session.
5. `readTransfer()` found the locally expired marker, deleted it, and returned no bearer secret.
6. The resolver called `resume_completed_onboarding_account_transfer()`.
7. The server had only a pending, expired-by-time grant, so there was no completed result to replay.
8. The error path set retry state, then imperatively replaced the current route with `/(onboarding)/account?reason=account_verification_failed`.
9. That self-replacement remounted Create your map. The retained analytics sequence shows the remounts.
10. AuthGate observed the unchanged authoritative stage `account_required`. Its signed-in-second-half branch held or resolved to `/(onboarding)/account`, which was correct for the stale durable record.

The exact bounce condition was `durable stage === account_required` after transfer resolution failed, combined with the error handler replacing the account route with itself. The route cache was not stale: no successful destination had been cached. It replayed nothing because the transition failed.

## Auth success versus account ready

| Question | Result |
|---|---|
| A. Supabase authentication valid? | Yes. Permanent, non-anonymous session refreshed during Continue. |
| B. Permanent account/profile available? | Yes. Profile existed; account was established and owned a map. |
| C. Account transfer complete? | No. This was the false/stale condition. |
| D. Onboarding marked complete? | No. It remained `account_required`. |
| E. Map destination resolvable? | Yes in account data, but the V2 resolver could not return it before transfer authorization completed. |
| F. What remained false? | Transfer completion, and consequently durable onboarding completion. |

## Fix and post-repair state

The fix makes the server authoritative for expiry and retains the 256-bit bearer secret for a bounded 30-day recovery period. The server still requires that secret, binds completed replay to the recorded destination, and preserves one-time semantics. The Development migration retains the corrected parent-job-before-media-task update order and accepts zero saved places.

After a successful transfer, `completePermanentAccountLink()` now persists `onboarding_complete`, `behavioralCompletedAt`, and `onboardingV2CompletedAt` before navigation. `resolvePostAuthRoute()` returns the transition's `/(tabs)/map` destination directly. The transition coordinator only coalesces/replays that resolved destination; it does not choose one independently. AuthGate derives its route from the same durable stage.

A mounted resolver failure now leaves Create your map mounted and displays its recoverable error. It no longer replaces the route with itself. Only an OAuth completion whose screen is already unmounted restores the account error route.

The founder's already-lost local secret could not be reconstructed. A guarded Development-only repair selected exactly the one October 10 session and one October 15 permanent destination, asserted zero source saves plus one source job and one source task, moved the job before the task, and marked the existing grant completed for destination-bound replay. Verification after repair showed:

| Field | Verified value |
|---|---|
| grant | `completed` |
| server lifecycle | `permanent_account` |
| source saves/jobs/tasks | 0 / 0 / 0 |
| destination saves | 3 (unchanged) |
| destination jobs/tasks | 3 / 4 (each increased by one) |
| durable JSON stage | `account_required` until the fixed client consumes replay |

On the next fixed-client Continue, the completed replay is consumed, the client writes terminal durable state, and the single requested route is `/(tabs)/map`.

## Development instrumentation retained for founder retest

`[create-map-continue]` emits bounded Development-only records for:

- screen mount/unmount ID and route;
- Continue tap, auth session kind, hashed user ID, durable stage, and transition lifecycle;
- grant state (`pending_active`, `pending_recovery_grace`, or `local_secret_missing_resume_only`);
- profile/account classification where queried;
- terminal durable stage, map ownership, and resolved destination;
- AuthGate branch, route before, and route requested;
- structured diagnostic reason on a genuine failure.

The trace helper accepts only bounded scalar fields. Call sites pass hashes rather than raw user IDs and never pass URLs, tokens, or transfer secrets.
