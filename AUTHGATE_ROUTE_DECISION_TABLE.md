# AuthGate post-auth route decision table

The authoritative post-auth value is the persisted Onboarding V2 stage written after the server transfer succeeds. Auth state proves identity, profile/account evidence classifies explicit existing-account entry, and the transition coordinator prevents duplicate work. Neither the coordinator nor its cached route overrides durable onboarding state.

| Authenticated | Account evidence | Durable stage | Transition state | Profile ready | Map owned | Expected owner / route |
|---|---|---|---|---|---|---|
| no | n/a | no resumable stage | none | n/a | no | Welcome: `/(onboarding)` |
| no | n/a | `account_required` | anonymous/linking checkpoint | n/a | no | Account recovery: `/(onboarding)/account` |
| anonymous | fresh | pre-account V2 stage | `anonymous_active` | no | stage-dependent | `expectedOnboardingV2Route(stage)` |
| anonymous | fresh | `account_required` | `anonymous_active` or `permanent_account_linking` | no | no | Create your map: `/(onboarding)/account` |
| permanent | fresh or established | `account_required` | `permanent_account_linking` | yes | account-dependent | While resolver latch is active, hold current account route. Resolver must finish transfer or show a visible error. |
| permanent | fresh or established | `account_required` | failed/incomplete transfer | yes | account-dependent | Keep mounted Create your map with recoverable error. Never silently self-replace. |
| permanent | fresh | `onboarding_complete` | `permanent_account` | yes | yes | Map: `/(tabs)/map` |
| permanent | established | `onboarding_complete` | `permanent_account` | yes | yes | Map: `/(tabs)/map` |
| permanent | established | `graduated` | `permanent_account` | yes | yes | Map: `/(tabs)/map` |
| permanent | established | any stale fresh-user state, explicit existing-account intent qualifies | bypassed to `graduated` | yes | yes | Direct existing map: `/(tabs)/map` |
| permanent | new account | no V2 completion and legacy status incomplete | none | yes | no | First-save activation: `/activate` |
| permanent | any | completed/map-owned stage while already on a product route | `permanent_account` | yes | yes | Preserve the current product route |
| any | any | any | resolver has a pending shared-place intent | any | any | Complete V2 ownership first, then the canonical shared-place route owns the destination |

## Founder comparison

The failing founder attempt matched the fifth row at tap time, then the sixth row after the transfer resolver failed. Permanent auth, profile readiness, established-account evidence, and an existing map were all true. The server grant remained pending and the durable stage remained `account_required`, so AuthGate had no terminal state from which to select the map.

The fixed path changes the durable record atomically after successful transfer to the seventh or eighth row. The resolver requests `/(tabs)/map` once. AuthGate observes the same terminal state and cannot select Create your map.

## Deterministic ordering

1. Establish or refresh the permanent auth session.
2. Complete or destination-bound replay the authorized V2 transfer.
3. Persist terminal V2 state (`onboarding_complete`, permanent identity, completion timestamps).
4. Derive the route from that terminal state.
5. Cache/coalesce the already-derived route only to prevent duplicate navigation.
6. Let AuthGate reconcile from the same durable stage.

An incomplete transfer stops at step 2 and exposes a recoverable diagnostic. It does not mutate completion, cache an account route as success, or remount Create your map.
