# Existing-account onboarding auth audit

Audit date: 2026-09-26.

## Entry and root cause

Welcome already stored an existing-account marker and routed to `/(onboarding)/account?intent=existing`. The account screen ignored that route intent. If Phase 2 had created an anonymous Supabase session, every magic-link, password, Google, Apple, and developer-login action called `prepareOnboardingAccountTransfer()` before authenticating.

That function requires an anonymous session whose ID matches the onboarding checkpoint, a funnel session, and a tutorial save. It flushes state and calls the `begin_onboarding_account_transfer` RPC. Missing/stale install-scoped identity, incomplete checkpoint sync, or an RPC error produced `anonymous_onboarding_transfer_not_ready` or `transfer_grant_failed`. The account screen stopped before the provider request and showed map-protection/backup copy. This is the founder-QA failure; no missing backend deployment is required to fix it.

The same anonymous-session test also selected **Keep your Nearr map** / **Back up your map** copy, even though the user had explicitly asked to sign into an established account.

## Intent model

One auth screen now resolves one of three entry intents:

- `existing_account_sign_in`: Welcome’s **Already have an account? Sign in** route or its persisted round-trip marker.
- `backup_current_map`: an anonymous completed map entering backup from the product.
- `account_creation`: normal onboarding/signup entry.

Existing-account framing is **Sign in to Nearr**. Backup copy remains available only for the backup intent. Shared-place intent copy still has priority.

## Corrected ordering

For `existing_account_sign_in`:

1. Do not prepare or cancel anonymous transfer state.
2. Authenticate with the selected provider.
3. Read established-account evidence: profile age, saved place, or completed onboarding session.
4. If established, mark onboarding as bypassed, discard local tutorial/practice state, and open `/(tabs)/map`.
5. If non-qualifying/new, sign out and return to Welcome with the existing onboarding-required explanation.

The persisted marker is checked again at the operation boundary, so a magic-link/OAuth round trip cannot race the React effect and accidentally invoke transfer preparation.

For `backup_current_map` and ordinary account creation, the existing transfer infrastructure remains intact. No parallel auth system was added.

## Failure behavior

- Provider cancellation remains a normal no-error return.
- Provider/network errors continue through `toUserFacingAuthError`; connection wording is not used for every failure.
- Account-evidence resolution failure reports that the signed-in account could not yet be verified and remains retryable.
- An existing-account auth failure does not cancel, link, upload, or mutate the local onboarding checkpoint.
- New identities are signed out before returning to onboarding, so they are not stranded in a partial transfer state and can later sign up normally.

## Fixture and data boundary

An established account never receives the scripted tutorial fixture or anonymous independent-save bookkeeping. The bypass transition clears local tutorial/practice/save state. No fake starter row is inserted into the established account, and no anonymous transfer RPC is required to enter it.

## Backend conclusion

The transfer RPCs and migrations exist and remain appropriate for explicit map backup/account conversion. The bug was client ordering and intent loss, not an absent Supabase row/function. No Supabase, Railway, or auth backend change is needed.
