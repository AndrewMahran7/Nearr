# Onboarding account-transition trace

## Scope and evidence

The founder recording file was not present in the supplied attachment directory, so the recording could not be re-extracted locally. The Development database contained one onboarding run whose timestamps and visible behavior match the reported recording: it began at 2026-10-10 03:15 UTC (20:15 Pacific on October 9), authenticated with Google, then emitted two account-transition failures and returned to the account screen.

All identifiers below are omitted or one-way hashed. No provider token, transfer secret, email address, raw user ID, or source URL was logged.

## Founder-run trace

| Time (UTC) | Event | State before | Action / backend call | Result | State after | Navigation effect |
| --- | --- | --- | --- | --- | --- | --- |
| 03:15:22 | Anonymous onboarding session starts | Fresh install | `upsert_onboarding_v2_session` | Development session created | `anonymous_active` | Onboarding continues |
| 03:15:34 | Real-practice share accepted | Phase 2 | Durable share job and media task created | Job reaches `needs_help`; no saved place is created | Real transferable save count remains 0 | Phase 2 remains recoverable |
| 03:15:45 | Practice deferred | Phase 2 job exists | Local/state transition records `background_processing` | Successful | Stage advances toward account requirement | Account step becomes available |
| 03:15:58 | Google attempt starts | Anonymous account-required state | `begin_onboarding_account_transfer_v2` | One pending V2 grant created | Session becomes `permanent_account_linking` | Google chooser opens |
| 03:16:05–03:16:06 | Google callback completes | Transfer grant pending | Supabase establishes the permanent Google session | `onboarding_google_completed` is recorded; permanent account/profile exists | Authenticated permanent session is active | Initiating account screen owns post-auth routing |
| 03:16:07 | Account transfer begins | Permanent session + pending grant | `complete_onboarding_account_transfer_v2` | Transaction rolls back | Grant remains pending; onboarding session remains linked to anonymous source | Account screen catches `account_transition_failed` and replaces itself |
| 03:16:09 | Resume/Continue retries | Same pending grant | Same V2 completion RPC | Same rollback | Same pending state | Account screen recurs; Development `console.warn` creates another LogBox banner |

## Exact failing transition

Google auth itself succeeded. The failure is category **C: anonymous/account transfer**, after auth and profile availability and before onboarding completion persistence/navigation.

The V2 RPC moved child ownership in this order:

1. `share_media_tasks.user_id = destination`
2. `share_jobs.user_id = destination`

The `share_media_tasks_owner_guard` trigger reads the parent job during step 1 and requires the task owner to equal `share_jobs.user_id`. At that instant the task had the permanent owner while its parent still had the anonymous owner, so the trigger raised an owner-mismatch exception. PostgreSQL rolled back the entire function.

The exact founder shape was confirmed read-only in Development: one source `needs_help` share job, one child media task, one media run, zero real saved places, and a pending transfer grant. A disposable Development fixture with the same shape reproduced the owner mismatch before the hotfix.

## Call-path ownership

`app/(onboarding)/account.tsx` is the explicit provider-success owner. Apple, Google, password, and resume all converge on `completeAuthentication`, which calls `resolvePostAuthRoute`, which calls `finishOnboardingAccountTransition`, which calls `complete_onboarding_account_transfer_v2`.

`AuthGate` in `app/_layout.tsx` is the automatic route guard. It correctly waits while `isPostAuthRoutingPending()` is true. The Fieldnotes redesign did not move AuthGate, auth providers, onboarding providers, navigation containers, or state providers. The visual work did not cause the database failure.

Before this fix, `completeAuthentication` had only a component-local tap guard. Remount, callback replay, or foreground replay could start the transition again, and every owner rendered/logged the same failure. The retry latch prevented AuthGate from escaping to the map, producing the observed loop.

## Post-fix trace

| Event | State before | Action | State after | Navigation |
| --- | --- | --- | --- | --- |
| Auth success | Authenticated session | Claim transition generation | `ACCOUNT_TRANSITION_PENDING` | None |
| First owner runs | Pending | Profile/existing-account resolution and V2 transfer | `ACCOUNT_TRANSITION_IN_PROGRESS` | None; Continue shows progress |
| Replay/remount/foreground | In progress | Reuses the same promise | Unchanged | None |
| RPC completes | In progress | Parent job moves before guarded task; onboarding state commits | `ACCOUNT_TRANSITION_COMPLETE`, then onboarding complete | Owner performs one `router.replace` |
| RPC fails | In progress | Owner records sanitized Development reason | `ACCOUNT_TRANSITION_ERROR` | One recoverable account screen, one explicit retry |
| Explicit retry | Error | Starts the next generation once | Pending → in progress → complete/error | Owner navigates at most once |

