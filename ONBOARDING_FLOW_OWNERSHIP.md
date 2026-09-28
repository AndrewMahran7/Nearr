# Onboarding flow ownership

The durable onboarding state is the authority. UI components request state transitions; AuthGate performs route reconciliation once. Screens do not compete with AuthGate by pushing the route that a state transition already implies.

| Durable stage/family | Visible owner | Allowed child route | Navigation authority |
|---|---|---|---|
| Welcome through scripted fixture payoff | `/(onboarding)` | None | AuthGate |
| `phase2_intro` | `/(onboarding)` | External social app is an OS handoff, not a Nearr route | AuthGate for Nearr return |
| `practice_ready`, first external-opened, first share-returned | `/(onboarding)` continuous real-practice screen | `/share-jobs/{matchedJobId}` only when the durable job needs review | AuthGate plus explicit user Quick Check push |
| First real save complete for the new anonymous journey | `/(onboarding)` completion beat | None | Durable save transition + AuthGate |
| Education and permissions | `/(onboarding)` | OS permission sheet only | Durable state + OS |
| `account_required` | `/(onboarding)/account` | Provider browser/system auth sheet | AuthGate; account screen owns exactly one provider operation |
| `auth_success` through activation challenge | `/(onboarding)` | None | AuthGate |
| `onboarding_complete` | `/(tabs)/map` | Normal product routes | AuthGate performs the one final replace; product navigation owns itself afterward |
| Legacy permanent 2-of-3 checkpoints | `/(tabs)/map` | Normal map product routes | Compatibility behavior retained for already-released state |

## State sequence for a new user

```text
Welcome -> choices -> offline scripted save -> map payoff card
  -> Phase 2 intro -> one real-practice surface
     -> direct save OR Quick Check OR intentional opt-out
  -> one completion beat -> permission education/OS sheets
  -> Making Nearr yours -> account_required
  -> provider once -> transfer once -> auth_success
  -> activation -> onboarding_complete -> normal map once
```

## Invariants

1. A persisted state has one expected Nearr route.
2. A state transition that changes the expected route produces at most one AuthGate replace edge.
3. Settings may request account backup but may not also push the account route.
4. After a valid practice job is matched, the primary CTA cannot launch the social post again.
5. Polling, realtime, and Quick Check may all observe the same job, but reducer idempotency permits one save/completion.
6. Provider double taps and duplicate callbacks are consumed by the auth transaction latch.
7. Authentication alone does not perform a one-shot proximity evaluation.
8. After final map entry, no onboarding overlay or camera owner remains active.

Development diagnostics emit bounded `[onboarding-transition]` entries with transition, phase, route, action, and duplicate fields, plus `[onboarding-render]` entries with `screen`, `mount_id`, and `reason`. These markers let physical QA distinguish a durable stage update from an actual React remount.
