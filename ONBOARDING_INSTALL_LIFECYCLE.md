# Onboarding installation lifecycle

Nearr deliberately treats an app-process restart and an app reinstall as different identity boundaries.

- A force close, background/foreground cycle, or device reboot keeps the same installation ID and may resume an incomplete anonymous onboarding checkpoint.
- An uninstall/reinstall receives a new native installation timestamp and a new random installation ID. Anonymous onboarding, temporary routes, and locally persisted auth are invalidated before they can own startup.
- A real Nearr account and its server data are never deleted by install bootstrap. A reinstalled user starts at Welcome and can use **Already have an account? Sign in** to restore the account experience.

## Installation authority

`lib/onboardingInstallLifecycle.ts` stores `nearr:onboarding:installation:v1` in AsyncStorage. The marker contains:

- a cryptographically random UUID (`installationId`), and
- `expo-application`'s native installation timestamp.

The native timestamp is unchanged by application updates and changes after uninstall/reinstall. It therefore detects a backup-restored AsyncStorage marker as stale. The random UUID is copied into every Onboarding V2 checkpoint and server mirror. Neither a Supabase user ID, device hardware ID, advertising ID, Keychain item, nor App Group value is accepted as installation authority.

If native installation time is unavailable, the local marker remains the best-effort authority for that platform. If lifecycle storage cannot be read, startup fails safe to an in-memory Welcome state and refuses to restore persisted auth.

## Startup precedence

1. Inspect the install marker and native install timestamp.
2. On a new install, clear only install-scoped anonymous/auth-routing artifacts and the App Group access token.
3. Gate Supabase persisted-session reads until step 2 has completed.
4. Accept a local or server onboarding checkpoint only when its `installationId` exactly matches the current marker.
5. Materialize `cohort=new_user_v2`, `stage=overview` when the checkpoint is absent, malformed, version-incompatible, or stale.
6. Process an explicit current auth/deep-link callback.
7. Route an explicitly authenticated established account normally; otherwise show Welcome.

Diagnostic reasons include `fresh_install_stale_onboarding_discarded`, `checkpoint_installation_mismatch`, `checkpoint_version_mismatch`, and `checkpoint_missing`. These conditions are recoverable and must not select `ERROR_RECOVERY`.

## Persistence classification

| Store / field | Class | Force close | Device reboot | Uninstall / reinstall | Intended to survive uninstall? | Owner | Cleanup / validation rule |
|---|---|---:|---:|---:|---:|---|---|
| React state, V2 subscriber cache, mutation queue | Process only | No | No | No | No | JS process | Rebuilt from validated install-scoped checkpoint. |
| AuthGate pending navigation ref, auth-link run/duplicate latches | Process only | No | No | No | No | Root layout | Recreated on process launch. |
| `nearr:onboarding:installation:v1` | Install scoped | Yes | Yes | Normally no; may be backup-restored | No | Install lifecycle | Native installation timestamp mismatch rotates UUID and invalidates anonymous state. |
| Native installation timestamp | Install scoped native fact | Yes | Yes | Changes | No | OS / `expo-application` | Primary reinstall discriminator; updates do not change it. |
| `nearr:onboarding:v2:state` including phase, platform, interests, fixtures, tutorial result/save, map payoff, Phase 2, job IDs, pending share, navigation stage | Install-scoped anonymous | Yes | Yes | Normally no; may be backup-restored | No | Onboarding V2 | Checkpoint `installationId` must equal current install. Mismatch/version failure resets to Welcome. |
| `nearr:onboarding:v2:funnel-id` | Install-scoped anonymous analytics | Yes | Yes | Normally no; may be backup-restored | No | Onboarding funnel identity | Cleared on new install; regenerated for the new journey. |
| `nearr:onboarding:v2:account-transfer` | Install-scoped secure transition | Yes | Yes | Normally no; may be backup-restored | No | Anonymous account conversion | Cleared on new install. Server grant expires independently and is never accepted without current state. |
| `nearr:onboarding:demo_completed:v1` | Install-scoped legacy onboarding | Yes | Yes | Normally no; may be backup-restored | No | Legacy onboarding | Cleared on new install. |
| `nearr:onboarding:existing-account-intent:v1` | Install-scoped navigation intent | Yes | Yes | Normally no; may be backup-restored | No | Existing-account sign-in | Cleared on new install; current user tap recreates it. |
| `nearr.pendingPremiumRequestJobId.v1` | Install-scoped temporary route | Yes | Yes | Normally no; may be backup-restored | No | Pending request routing | Cleared on new install so an old job cannot own startup. Monetization remains suspended. |
| `nearr.sharedPlace.pending.v1` / acquisition intent | Install-scoped temporary route | Yes | Yes | Normally no; may be backup-restored | No | Public share-link routing | Cleared on new install; an explicit current launch URL recreates the intent. |
| Supabase `sb-*-auth-token` and code verifier in AsyncStorage | Secure/auth session, locally persisted | Yes | Yes | Normally no; may be restored by backup | No for automatic cross-install restore | Supabase auth | Reads are gated by install bootstrap; all matching keys are removed on new install. Server account is untouched. |
| `nearr:auth:lastAuthenticatedUserId:v1` | Local account/cache pointer | Yes | Yes | Normally no; may be backup-restored | No | Offline identity | Cleared on new install so a restored pointer cannot auto-open private cached data. User-scoped caches remain intact. |
| App Group `supabase_access_token` | Secure/shared short-lived token | Yes | Yes | May outlive/reappear independently | No | Host app + Share Extension | Cleared on new install. It is never installation or onboarding evidence. |
| App Group `shared_auth_initialized` and bounded diagnostic trace | Shared diagnostic | Yes | Yes | May outlive/reappear independently | Not authoritative | Host app + Share Extension | May remain for extension messaging/diagnostics; cannot restore auth or onboarding. No token is retained. |
| `nearr:onboarding:completed:v1:<userId>` | Local account-scoped hint | Yes | Yes | Normally no; backup may restore | Yes as a hint only | Post-auth routing | Not cleared by fresh-install bootstrap. It is keyed to an established account and cannot authenticate a user. |
| Saved-place list/image/snapshot/reminder caches keyed by user ID | Account-scoped local cache | Yes | Yes | Normally no; backup may restore | Safe to preserve; inaccessible until sign-in | Saved places / offline mode | Never wiped merely because anonymous onboarding is stale. Offline identity pointer is cleared on new install. |
| Nearr profile, provider names, onboarding completion, real saved places | Account-scoped server durable | Yes | Yes | Yes | Yes | Supabase account | Never deleted by install bootstrap. Restored after explicit sign-in. |
| `onboarding_v2_sessions.state` | Server mirror of anonymous checkpoint | Yes | Yes | Yes | No across installations | Supabase onboarding session | New writes contain `installationId`; hydration requires exact current-install match. Legacy/mismatched rows are ignored, not deleted. |
| Anonymous `auth.users` row and tutorial/server rows | Server durable anonymous | Yes | Yes | Yes until cleanup policy | No automatic resume across installs | Supabase | May age out through existing cleanup. A new install does not use it as startup evidence or delete it blindly. |
| Real Phase 2 share jobs | Server durable, identity scoped | Yes | Yes | Yes | Only as real account/anonymous server history, not as a route | Share pipeline | Same-install checkpoint can resume the route. A new install discards its local route and does not delete the backend job. |

## Fresh-install cleanup set

The bootstrap removes the V2 checkpoint, funnel ID, pending account transfer, legacy demo flag, existing-account intent, temporary premium/share routes, offline identity pointer, legacy Dev auth flag, and Supabase auth storage keys. It also clears the App Group access token.

It does **not** delete server profiles, saved places, provider names, purchases, RevenueCat state, server jobs, per-user saved-place caches, or server onboarding rows.

## Migration note

Checkpoints written before this contract have no `installationId` and are intentionally not resumable. In the Development lane this creates a one-time reset of an incomplete anonymous journey when the fix first arrives. That conservative migration is required because an old checkpoint cannot prove which installation created it. Established account records and user-scoped data are unaffected.
