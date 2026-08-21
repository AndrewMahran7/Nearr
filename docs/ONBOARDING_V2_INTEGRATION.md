# Onboarding V2 integration notes

Onboarding V2 remains isolated behind `EXPO_PUBLIC_ONBOARDING_V2_ENABLED` and
is off by default. This branch contains code and local Supabase artifacts only;
it does not deploy or alter either Supabase project, Railway, or EAS.

## Final architecture

The early identity is Supabase Anonymous Sign-Ins via
`supabase.auth.signInAnonymously`. It is not an unauthenticated or fake-local
identity. Supabase issues the same persisted access/refresh session shape used
by permanent users. Its JWT uses the `authenticated` database role, carries
`auth.uid()`, and marks the user `is_anonymous=true`.

This choice preserves all existing owner checks:

- `saved_places`, `share_jobs`, `share_media_tasks`, notification events, and
  result ledgers remain attached to an actual `auth.users.id`.
- owner-only RLS continues comparing `auth.uid()` with `user_id`.
- worker-only tables/RPCs remain inaccessible to clients.
- no public persistence policy and no client service-role credential exists.

The existing App Group bridge copies the current short-lived access token on
every auth event/refresh. It does not distinguish anonymous from permanent
tokens, so the Share Extension submits the anonymous Bearer token through the
same guarded `create-share-job` backend lane. Refresh tokens are still never
stored in the App Group. No extension or environment-routing change is needed.

## Identity lifecycle and journey

```text
no session
-> persisted Supabase anonymous session (anonymous_active)
-> overview -> platform -> interest
-> the selected platform's one configured tutorial
-> real social Share -> Nearr
-> real share job/media task/Nearr result/saved_places row
-> account_required (magic moment has happened)
-> permanent_account_linking
-> permanent_account
-> real place-detail tour
-> first independent save
-> second independent save / graduation
```

The anonymous session persists in the existing Supabase AsyncStorage adapter,
survives restart/background/social-app handoff, and is reused instead of
re-created. Local state is mirrored through the owner-checked
`upsert_onboarding_v2_session` RPC. A privacy-safe UUID identifies the funnel
independently from `auth.users` and is added to every analytics insert.

Anonymous sessions are never reconstructed as offline permanent sessions, do
not trigger legal/setup/location/push/geofence flows, and are not pulled out of
onboarding by the normal permanent-session AuthGate rule.

## Permanent account methods

| Method | New identity behavior | Established-identity collision | Transfer |
| --- | --- | --- | --- |
| Apple | `linkIdentity` with the verified native ID token keeps the anonymous user ID | fall back to normal Apple ID-token sign-in | required only when the provider belongs to another user |
| Google | `linkIdentity` OAuth keeps the anonymous user ID | fall back to normal Google OAuth | required only when OAuth establishes another user |
| Magic link/email | `updateUser({email})` links email to the anonymous user | fall back to normal email OTP | required when callback establishes another user |
| Password create | `updateUser({email,password})` upgrades in place | duplicate email is not treated as a new account | use the explicit Sign in mode for an existing account |
| Password sign in | not a creation path | normal password sign-in establishes the existing user | required |

Every method converges through `resolvePostAuthRoute`. In-place upgrades call
`finalize_onboarding_identity_link`. Different-user outcomes call
`complete_onboarding_account_transfer` with a short-lived one-time grant made
while the anonymous JWT was still active.

## Transfer security and ownership

The client generates 256 random bits and sends the secret over its authenticated
TLS request. Postgres stores only SHA-256. The grant is bound server-side to the
authenticated anonymous source, exact onboarding session, and tutorial place;
it expires after 24 hours. Completion derives the destination exclusively from
the current non-anonymous JWT.

The `SECURITY DEFINER` completion function locks the grant/session, performs one
transaction, records its result, and returns that result on an authorized
replay. A separate destination-bound resume RPC covers a process death after
commit but before local acknowledgement.

The allowlist is intentionally narrow:

- the exact tutorial `saved_places` row (deduped by destination `place_id`);
- notification rows attached to that saved row;
- tutorial `share_jobs` selected by saved-place pointer or exact source URL;
- `share_media_tasks`, `share_media_runs`, and
  `share_job_place_results` attached to those job IDs;
- tutorial-source `share_agent_runs` and `share_extraction_failures`;
- the `onboarding_v2_sessions` ownership/checkpoint;
- analytics conversion linkage (the original event owner is not rewritten).

Profiles are never merged. The destination profile remains authoritative; an
in-place anonymous profile has its email synchronized from `auth.users`.
Feedback, push tokens, unrelated saves/jobs, and arbitrary source-user rows are
not transferred.

For an established destination, the tutorial place is attached only if its
canonical place is absent; otherwise the destination row is reused. The user
is marked as an existing-account bypass and goes to normal Nearr without two
forced practice saves. For a new permanent destination, the exact tutorial
saved-place ID returned by the transaction is written back into onboarding and
the real place tour begins.

## Funnel and analytics retention

The measurable sequence is:

1. `onboarding_overview_viewed`
2. `onboarding_platform_selected`
3. `onboarding_interest_selected`
4. `onboarding_tutorial_opened`
5. `tutorial_video_opened`
6. `tutorial_share_received`
7. `tutorial_detective_started`
8. `tutorial_detective_result_shown`
9. `tutorial_detective_result_confirmed`
10. `onboarding_account_viewed`
11. `onboarding_signin_started`
12. `onboarding_signin_completed`
13. `first_independent_save_completed`
14. `second_independent_save_completed`
15. `behavioral_onboarding_completed`

All events carry `onboarding_session_id`. Conversion fills
`converted_user_id` server-side. Anonymous cleanup allows `user_id` to become
null but does not delete analytics, so the funnel and conversion remain
queryable without an abandoned auth identity.

## Anonymous cleanup contract

Recommended defaults are configurable environment/RPC inputs:

- abandoned anonymous onboarding: 30 days since last activity;
- successfully transferred source identity: 24-hour recovery grace.

`list_anonymous_onboarding_cleanup_candidates` is service-role only.
`cleanup-anonymous-onboarding` additionally requires a dedicated worker secret,
rechecks `user.is_anonymous`, deletes service-only source diagnostics, deletes
the anonymous auth user (allowing normal FK cascades), and compacts the retained
onboarding session to a non-PII terminal milestone. Analytics is not deleted.
The scheduler and secret are intentionally not created in this branch.

## Tutorial versus practice content

`ONBOARDING_TUTORIAL_CONFIG` has explicit slots for Instagram, TikTok, YouTube,
and Facebook. Instagram points to an existing repository regression fixture
explicitly labeled as an unvalidated development placeholder. The other three
slots are `null`. There is no random rotation or cross-platform fallback.

The broader typed practice catalog is separate. Missing practice content shows
a recoverable empty state; no recommendation engine is part of this ticket.
Content matching prefers provider + immutable post/video ID, then canonical
normalized URL. It never matches only a creator/profile. AI-note arrival is not
a prerequisite for opening the place or progressing the tour.

## Thin integration points

- `app/share.tsx`, `components/ShareJobHandoff.tsx`, and
  `app/share-jobs/[jobId].tsx` only observe the existing real share/result.
- `app/(tabs)/map.tsx` reconciles authoritative saved rows and opens the existing
  detail surface only after permanent conversion.
- `app/_layout.tsx` is the sole automatic V2 route owner. It maps durable stage
  to onboarding, tutorial, account, or map and suppresses same-route and already
  pending replacements; it does not change environment routing or recognition behavior.

## Manual tickets

1. **Canonical Tutorial Videos**
   - Owner: Product + recognition QA.
   - Action: provide one exact URL for Instagram, TikTok, Facebook, and YouTube,
     with category, known place, expected Nearr result, and live/dead check.
   - Acceptance: each direct post is desirable, public, reliable, produces the
     expected real saved place, and is marked `productionValidated: true`.
   - When: before enabling Onboarding V2 in any release lane.

2. **Starter/Practice Catalog**
   - Owner: Product/Content.
   - Action: provide platform/category practice links and metadata.
   - Acceptance: each configured platform has enough validated, non-tutorial
     items for two distinct saves; missing platforms continue to fail closed.
   - When: before behavioral-onboarding launch, independent from code merge.

3. **Physical Onboarding QA**
   - Owner: Mobile QA.
   - Action: run fresh install, restart/background, interrupted conversion,
     new account, existing account, duplicate share, and declined permissions
     on physical iOS/Android devices.
   - Acceptance: one anonymous ID resumes; real result/save survives account
     transition; tutorial does not count; two independent saves graduate.
   - When: after migration/function deployment to the dev lane and before flag-on.

4. **Share Favorites QA**
   - Owner: iOS QA.
   - Action: verify Nearr visibility, More, and add-to-Favorites instructions.
   - Acceptance: screenshots/device record confirm the instructions and
     persisted Favorite; no analytics claim literal iOS taps are observable.
   - When: each release candidate.

5. **Permission Timing QA**
   - Owner: Mobile QA.
   - Action: test notification/location denied, not-determined, and granted.
   - Acceptance: no setup reminder or location prompt interrupts tutorial,
     account preservation, or first place tour; decline never blocks graduation.
   - When: after integration with the final Safe Development baseline.

6. **Anonymous Cleanup Scheduling**
   - Owner: Backend/Infrastructure.
   - Action: provision `ANONYMOUS_CLEANUP_WORKER_SECRET`, deploy the function,
     and schedule it with reviewed 30-day/24-hour settings and alerting.
   - Acceptance: dry run and dev test remove only verified anonymous users,
     retain funnel events, compact sessions, and report partial failures.
   - When: before production flag-on.

7. **Supabase Anonymous Auth + Schema Enablement**
   - Owner: Backend/Security.
   - Action: review/enable Anonymous Sign-Ins and manual identity linking (with
     abuse controls/CAPTCHA as appropriate), apply the migration and deploy the
     cleanup Edge Function to Nearr-Dev first.
   - Acceptance: anonymous JWT has `authenticated` role and `is_anonymous=true`;
     RLS tests, grant replay, dedupe, and cleanup dry run pass in Nearr-Dev.
   - When: before Physical Onboarding QA; production only after approval.

8. **Provider Conversion Matrix QA**
   - Owner: Auth QA.
   - Action: exercise Apple, Google, magic-link new/existing, password create,
     and password existing sign-in, including cancellation and callback replay.
   - Acceptance: new identity links keep the ID where supported; collisions use
     the grant; no duplicate place or cross-user access occurs.
   - When: after dev backend enablement and before release approval.

9. **Integration-Lane Schema Re-audit**
   - Owner: Integration engineer.
   - Action: compare the allowlist with any user-owned tables added by
     recognition-core, AI-note, TikTok, or Facebook lanes.
   - Acceptance: every new onboarding-created record is explicitly transferred,
     explicitly ephemeral, or documented as intentionally not owned.
   - When: during final safe-base reconciliation, before migration deployment.

10. **Legal Acceptance Timing Review**
   - Owner: Product + Legal.
   - Action: if `LEGAL_ACCEPTANCE_REQUIRED` is enabled, choose and approve the
     consent point for an anonymous user before the real share/backend call.
   - Acceptance: approved copy/timing is implemented without letting a legal
     modal cover the Nearr result or first place tour.
   - When: before enabling legal enforcement or Onboarding V2, whichever comes first.
