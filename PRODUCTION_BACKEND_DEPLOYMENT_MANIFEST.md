# Nearr 1.5 Production backend deployment manifest

Prepared for the iOS 1.5.58 release candidate. This is a plan only: no
Production backend change is authorized by this document.

## Release sources

- Founder-approved client and October 8 notification source:
  `45cedb7fc3e5d391e68295f60e2e097640008faa`
- Production Supabase project: `rlqvxdwtetxsqxhqztkw`
- Development Supabase project: `qnfxnmvxpjzfydgudtvs`
- Production Railway service: `Nearr` (`59234570-e2ec-4a7e-86de-22826da86c66`)
- Development Railway service: `media-worker` (`3c8cd190-b118-4ee4-9338-407843ef4e1f`)

## Observed state on October 8, 2026

- Production's migration ledger ends at `20260907000003`.
- Development's migration ledger ends at `20260928000001`.
- Development `process-share-jobs` is version 142 and includes the approved
  immediate notification drain.
- Production `process-share-jobs` is version 123 and does not contain that
  October 8 change.
- The approved client queries `profiles.first_name` and `profiles.last_name`
  and calls the V2 onboarding account-transfer RPCs. Production does not yet
  have the migrations that add those fields and replace those RPCs.
- The October 8 client changes add no new database migration. Photo snapshots,
  five-photo persistence, Nearby radius filtering, and canonical categories
  are client-side contracts over existing Production data.
- No Railway worker source change is present in commit `45cedb7`.

## Important migration constraint

Do not run an unreviewed `supabase db push` from this branch against Production.
The unapplied ledger range contains Development-only tutorial, qualification,
and monetization migrations. In particular, migrations `20260910000001`
through `20260910000008` are not approved for Production, and the release must
not enable or alter monetization.

## Required Production parity work

Each item requires separate founder approval and a Production backup/change
window. Apply in this order, proving each step before continuing.

1. **Client schema compatibility**
   - Review and promote the additive provider-name change from
     `20260925000001_profile_provider_names.sql`.
   - Verify `profiles.first_name` and `profiles.last_name` through the
     Production API, including a new Apple/Google account and an existing
     account with null values.

2. **Onboarding account-transfer compatibility**
   - Review and promote the V2 transfer function definitions from
     `20260928000001_onboarding_real_saved_place_transfer.sql`.
   - Do not replay Development-only practice-entitlement or monetization
     migrations as a shortcut.
   - Prove anonymous-to-new-account transfer, existing-account sign-in, empty
     transfer, duplicate destination place convergence, and idempotent replay.

3. **Notification dispatch parity**
   - Backport only the notification-authority and immediate-drain change from
     commit `45cedb7` onto the currently deployed Production
     `process-share-jobs` source.
   - The source units are
     `supabase/functions/process-share-jobs/index.ts` and
     `lib/shareJobNotificationAuthority.ts`.
   - Do not deploy the complete Development function wholesale: its history
     also contains later recognition and experiment work that is outside this
     release authorization.
   - Deploy `process-share-jobs` with JWT verification disabled, matching the
     existing function setting. Preserve all existing Production secrets and
     feature flags. Required bearer inputs remain
     `SHARE_JOBS_WORKER_SECRET` and `MEDIA_FINALIZE_SECRET`.
   - Prove terminal-result immediate dispatch, current-row authority,
     duplicate prevention, retry/backoff, and the per-minute recovery path.

4. **Recognition schema/function review (only if the backport requires it)**
   - The full Development function reads `share_jobs.recognition_run_mode` and
     `share_media_tasks.source_geography`, introduced by migrations
     `20260909000001` and `20260914000002`, and relies on recognition function
     work in `20260914000001`.
   - These changes affect recognition behavior and are intentionally excluded
     from this release manifest. Escalate for a separate review instead of
     deploying them implicitly.

5. **Railway**
   - No deploy is required for the October 8 release changes.
   - Confirm the Production `Nearr` deployment is healthy and that its worker
     callback secret still matches the Supabase function before notification
     smoke testing. Do not copy Development variables into Production.

## Release ordering after approval

1. Apply and verify the two client-compatibility database changes.
2. Deploy and verify the isolated Production notification backport.
3. Run Production smoke tests with non-destructive test accounts.
4. Make iOS 1.5.58 available to founder QA through TestFlight.
5. After founder approval, submit/release through the normal App Store process.
6. Publish a Production OTA only if separately approved and only for runtime
   `1.5.58`.

## Explicitly not included

- No Production database migration was applied.
- No Supabase Edge Function was deployed.
- No Railway service or variables were changed.
- No Production OTA was published.
- No monetization, Jev recognition, user data, or feature flag was modified.
