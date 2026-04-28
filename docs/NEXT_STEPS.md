# Nearr — Next Steps

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

> Ordered by what blocks the next TestFlight / Play Internal cut.
> Don't shuffle — items below #5 assume #1–#5 are done.

## Pre-build hardening (do this first)

0. **Re-enable the iOS Share Extension (post first TestFlight).** The
   `expo-share-extension` plugin entry was removed from
   [app.json](../app.json) so the first iOS TestFlight build could
   ship as a single-target app. The exact JSON snippet + re-enable
   checklist (App Group, EAS credentials for the extension bundle ID,
   dev-build verification on a real device) is in the TODO at the top
   of [app.config.js](../app.config.js). Until then iOS share-sheet
   saves are unavailable; the host-app paste-link flow on `/share`
   and the Android share intent both still work.

1. **Rotate the leaked Google Maps key** that is hard-coded in
   [app.json](../app.json). Replace the literal value with
   `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (consider migrating
   `app.json` → `app.config.ts` so env interpolation is first-class).
   Restrict the new client key to `com.nearr.ios` + the Android SHA-1
   fingerprints, and to Maps SDK iOS / Maps SDK Android / Places only.
   Issue a separate, IP-restricted server key for the Edge Function's
   `GOOGLE_PLACES_KEY` secret.
2. **De-duplicate `UIBackgroundModes`** in
   `expo.ios.infoPlist.UIBackgroundModes`. It currently contains
   `location, fetch, location, fetch`. Should be just `["location",
   "fetch"]`.
3. **Delete dead share-extension scaffold** at
   [native/share-extension/](../native/share-extension/) (uses
   `group.com.nearr.app`). Keeping it around risks somebody re-enabling
   `plugins/withShareExtension.js` and breaking the real
   `expo-share-extension`-managed target.
4. **Deploy the Edge Function** and set its secrets:

   ```sh
   supabase secrets set GEMINI_API_KEY=… GOOGLE_PLACES_KEY=…
   supabase functions deploy process-share-link
   ```

   Capture the resulting URL and set it as
   `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` in `.env` and EAS env
   profiles.
5. **Verify the iOS App Group bridge end-to-end** on a real device:

   - Confirm `group.com.nearr.ios` is enabled on both targets in the
     Apple Developer portal AND in the generated entitlements.
   - Sign in to the host app, kill it, share a URL via Safari, watch
     for the "Saved to Nearr ✓" confirmation.
   - Sign out → share → confirm graceful host-app handoff.
   - See [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md) for the
     verification recipe.

## Build + verify

6. Run `npx expo prebuild --clean`.
7. `eas build --profile development --platform ios`. Install on a
   real device.
8. `eas build --profile development --platform android`. Install on a
   real device.
9. Walk the entire [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md). Any
   ❌ blocks the cut.
10. Cut `eas build --profile production` for both platforms once the
    checklist is green.

## Submit

11. TestFlight: `eas submit --platform ios --profile production` after
    confirming Privacy Manifest, age rating, and the
    "Always" location-permission justification copy.
12. Play Internal: `eas submit --platform android --profile production`
    after confirming the data-safety form mentions location +
    URL-share-target usage.

## V2 candidates (post-launch)

These were intentionally cut from V1 — see
[V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md). Pick at most two for the
first V2 milestone:

- True OS geofencing (iOS region monitoring + Android
  `addGeofences`); replace the polled location task.
- Real transcription provider behind
  [lib/transcription/](../lib/transcription/) (Whisper / AssemblyAI),
  feeding into the same `process-share-link` pipeline so audio reels
  can be processed.
- Photos on places (`place_photos` table + Storage bucket + UI on
  Place detail).
- Push notifications via `expo-notifications` push tokens + a
  Supabase Edge Function dispatcher; lets us notify from the server
  instead of relying on local scheduling.
- Emit `'entered'` / `'exited'` / `'silenced'` events into
  `notification_events` (CHECK constraint already allows them) and
  build a history view in Settings.
- Apple / Google OAuth sign-in.
- An automated test suite. Start with Jest unit tests for `lib/`
  pure helpers (`geo`, `shareParser`, `placeExtractor`,
  `externalMaps`) and Detox e2e for the manual-save and share-paste
  flows.
- Lists / collections (saved places grouped by trip, theme, etc.).
- Friends + shared lists + comments.
