# Onboarding account-transition fix

## Root fix

Development migration `20261009000001_onboarding_transfer_owner_order.sql` replaces the existing V2 completion function without changing its name, parameters, return object, grants, tables, columns, or client contract. The function now moves `share_jobs.user_id` before `share_media_tasks.user_id`, so the existing database owner guard sees matching parent/child ownership.

This backend change was necessary: an authenticated client cannot update the anonymous user's service-owned queue rows through RLS, and skipping or deleting the Phase 2 job would lose user data. The change is backward compatible and was applied only to Supabase project `qnfxnmvxpjzfydgudtvs` (Nearr Development). No Production migration or function deployment occurred.

## Single-flight client transition

`lib/onboardingAccountTransition.ts` adds a process-level coordinator with explicit phases:

- `ACCOUNT_TRANSITION_PENDING`
- `ACCOUNT_TRANSITION_IN_PROGRESS`
- `ACCOUNT_TRANSITION_COMPLETE`
- `ACCOUNT_TRANSITION_ERROR`

The first request owns the backend transition, error publication, and navigation. Concurrent auth-listener, remount, foreground, or callback requests reuse its promise. A completed generation returns its cached result without navigating again. An error remains stable until the signed-in Continue action requests one explicit retry.

The account screen now shows the existing button progress state while the owner runs. The raw Development LogBox was removed by changing the operational failure from `console.warn` to structured `console.log` with only the transition generation and error message. The existing clear, recoverable user-facing error remains.

## Preserved behavior

- Google and Apple still use the same provider adapters and shared completion path.
- Existing-account intent still skips anonymous transfer preparation and routes qualified accounts to the map.
- New identities still complete the V2 transfer and onboarding state.
- The install-local scripted tutorial ID never enters an RPC or `saved_places`.
- Zero real saves are valid.
- Real UUID-backed saves and their queue work transfer atomically.
- AuthGate remains the sole automatic route owner; the transition claimant is the sole imperative post-auth navigation owner.
- Fieldnotes colors, type, spacing, map, place detail, Saved, Activity, Quick Check, share extension, camera behavior, and provider presentation are unchanged.

## Files changed

- `app/(onboarding)/account.tsx`
- `lib/onboardingAccountTransition.ts`
- `supabase/migrations/20261009000001_onboarding_transfer_owner_order.sql`
- `scripts/testOnboardingAccountTransitionRegression.ts`
- `scripts/proveOnboardingAccountTransitionDev.ts`
- `package.json`
- Required handoff and visual evidence files

