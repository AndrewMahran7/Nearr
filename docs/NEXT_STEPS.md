# Nearr — Next Steps

> Last updated: 2026-05-03
> Source of truth: current codebase and current beta state

This list is for the next product cycle. It is not a historical wishlist and it is not permission to build everything that sounds interesting.

## Current product vision

Nearr is a memory-to-action app for real-world places.

Core loop:

- See a place online
- Want to try it
- Save it
- Nearr remembers it
- Nearr reminds you when you are nearby
- You go, save it for later, or archive it

Product stance:

- Wrong silent saves are worse than asking the user to choose.
- The app should not ask for confirmation constantly.
- Auto-save when evidence is strong.
- Ask only when evidence is weak or conflicting.
- Do not turn Nearr into a generic map utility.
- Do not monetize regular users with subscriptions or traditional ads.

## Recently shipped

### 1. Restaurant extraction v2

- Extraction now prefers evidence over handle guessing.
- Address-first logic is in the decision path when an address is present.
- Exact-name verification goes through Places when possible.
- `@` handles count as evidence, not truth.
- Poster identity distinguishes restaurant vs influencer vs unknown.
- Weak or conflicting evidence falls back to candidate selection instead of silent save.

### 2. Group nearby notifications

- Overlapping saved-place reminder areas now collapse into one grouped nearby notification.
- Current geometry is circle intersection, not adaptive blobs.

## Next product work

### 1. Build the opportunity loop

- Treat nearby reminders as opportunities, not just notifications.
- Give each place up to 3 nearby reminder opportunities.
- Notification tap should land on an intentional opportunity screen.
- Primary actions: Get directions, Maybe next time, I went here, Adjust radius.

### 2. Build archive and visited states

- After 3 missed or skipped opportunities, turn reminders off.
- Mark the place archived instead of deleting it.
- Surface archived places behind an Archive filter.
- Mark visited places as visited, turn reminders off, and allow a lightweight reward moment.

## Done recently

- Added a real `/auth-callback` route to avoid unmatched-route auth failures
- Enabled focused-map routing after save using `savedPlaceId`
- Added map-side one-shot focus for `savedPlaceId`
- Added activation guidance on Home for the first 3 saves
- Added notification count tracking and legal-acceptance schema scaffolding
- Added OS-level geofencing alongside the background location fallback
- Re-enabled the `expo-share-extension` plugin in config
- Reduced map/log churn with throttled logging and sync coalescing

## Validation work that still matters

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
7. Validate grouped nearby notifications on real devices before treating delivery behavior as proven.
8. Re-test extraction quality on a small batch of real Instagram/TikTok links, especially handle-only and influencer-post cases.

## Release / ops work

1. Push the next TestFlight build after the manual checklist is green.
2. Verify Supabase Auth redirect URLs include both `nearr://auth-callback` and `nearr:///auth-callback` plus the Expo dev callback.
3. Confirm `process-share-link` is deployed in the target environment before expecting iOS silent save to work.
4. Verify App Group and provisioning are correct for the current iOS share extension build.
5. Confirm EAS environment variables are present for preview/production builds.

## Product / business follow-up

1. Decide how aggressive to be about silent iOS share-extension save versus fast host-app fallback.
2. Build a simple website once the beta flow is stable enough to send people somewhere trustworthy.
3. Review naming / trademark risk before broader public rollout.
4. Keep legal acceptance disabled until the product and legal docs are ready for a real gate.
5. Keep monetization thinking pointed at restaurants, creators, and businesses that benefit from offline intent and attribution.

## Future ideas to log, not build yet

- Adaptive ellipse/blob zones for overlapping saved places
- More advanced cluster geometry beyond simple circle intersection
- Audio transcription fallback for restaurant names
- Tagged-account profile inspection
- Restaurant/creator attribution dashboard
- Archived/visited map visibility controls
- Social/shared maps
- Creator dashboards
- Restaurant campaign reports
- Monetization through restaurants/creators/businesses, not regular users

## Deferred until beta fundamentals are stable

- Real transcription provider in production
- Automated test suite beyond manual beta validation
