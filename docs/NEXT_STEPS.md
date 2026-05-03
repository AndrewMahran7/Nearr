# Nearr — Next Steps

> Last updated: 2026-05-02
> Source of truth: current codebase and current beta state

This list is for the next beta-validation cycle, not a historical wishlist.

## Done recently

- Added a real `/auth-callback` route to avoid unmatched-route auth failures
- Enabled focused-map routing after save using `savedPlaceId`
- Added map-side one-shot focus for `savedPlaceId`
- Added activation guidance on Home for the first 3 saves
- Added notification count tracking and legal-acceptance schema scaffolding
- Added OS-level geofencing alongside the background location fallback
- Re-enabled the `expo-share-extension` plugin in config
- Reduced map/log churn with throttled logging and sync coalescing

## Next validation work

1. Test the current auth-callback build on iOS and Android and confirm there is no unmatched-route regression.
2. Test save-to-focused-map on all save entry points:
   - manual save
   - host-app link save
   - Android share intent
   - iOS share extension fallback path
3. Test duplicate-save -> focused-map behavior on real device builds.
4. Test map dismissal paths: swipe down, X, and map tap.
5. Test geofencing on a real iPhone with Always Location and notifications granted.
6. Re-check idle stability on Android emulator and a real Android device.

## Release / ops work

1. Push the next TestFlight build after the manual checklist is green.
2. Verify Supabase Auth redirect URLs include both `nearr://auth-callback` and `nearr:///auth-callback` plus the Expo dev callback.
3. Confirm `process-share-link` is deployed in the target environment before expecting iOS silent save to work.
4. Verify App Group and provisioning are correct for the current iOS share extension build.
5. Confirm EAS environment variables are present for preview/production builds.

## Product / business follow-up

1. Decide whether to keep investing in silent iOS share-extension save now that the host-app fallback is working.
2. Build a simple website once the beta flow is stable enough to send people somewhere trustworthy.
3. Review naming / trademark risk before broader public rollout.
4. Keep legal acceptance disabled until the product and legal docs are ready for a real gate.

## Deferred until beta is stable

- real transcription provider
- visit/completion features
- social or collaborative features
- automated test suite beyond manual beta validation
