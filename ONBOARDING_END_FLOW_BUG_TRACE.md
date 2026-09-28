# Onboarding end-flow bug trace

## The failing path

```text
anonymous_active
  -> real practice resolved
  -> permissions resolved
  -> making_nearr_yours
  -> personalized_activation       (incorrect branch)
  -> onboarding_complete
  -> normal map
  -> user opens Settings / Back up your map
  -> requestOnboardingV2MapBackup  (durable route edge)
  + router.push(account)           (second imperative edge)
  -> account screen mounted twice
  -> permanent_account_linking with behavioral completion already recorded
```

The branch condition in `continueOnboardingAfterMakingNearrYours` only sent identity lifecycle `none` to account setup. The anonymous Supabase identity created for the real share boundary was `anonymous_active`, so it was incorrectly treated as a finished Nearr account. That is why the flow looked complete, exposed the normal map, and then required a separate Settings backup journey.

Settings compounded the bug. `requestOnboardingV2MapBackup()` changed the durable stage to `account_required`, which caused AuthGate to replace the route. The same tap also called `router.push('/(onboarding)/account')`. Those two navigation authorities explain the duplicate account/email events and remount signature.

## The repaired path

```text
anonymous_active
  -> real practice resolved or intentionally skipped
  -> one completion beat
  -> permissions resolved or denied
  -> making_nearr_yours
  -> account_required              (all non-permanent identities)
  -> one provider operation
  -> permanent_account_linking
  -> atomic transfer/dedupe
  -> auth_success
  -> personalized_activation
  -> activation_challenge
  -> onboarding_complete
  -> normal map                    (one final route edge)
```

The tutorial fixture retains its local-only identity and is not converted into a synthetic backend save. The real practice saved-place ID remains authoritative through account transfer. An established-account sign-in from Welcome still bypasses anonymous onboarding and goes directly to the normal account lifecycle.

## Why this was not Wi-Fi or recognition

The tunnel and Metro both worked: the device downloaded and bundled JavaScript. The earlier console failure was missing Supabase environment configuration, not Wi-Fi. In the 14:10 journey, the worker's `missing_video` response was recoverable and the real place was saved through Quick Check. The end-flow failure happened afterward in local lifecycle and route ownership, so changing recognition would not have fixed it.

## Regression locks

- Non-permanent identity after setup must route to account, never final activation.
- Settings backup has no imperative account push.
- Active first-practice stages are onboarding-owned.
- Needs-review may preserve only its exact Quick Check detail route.
- Save reconciliation is idempotent across polling/realtime/manual confirmation.
- Final activation contains no push/geofence/proximity initialization.
- Full journey reaches the map once, after permanent account transfer.
