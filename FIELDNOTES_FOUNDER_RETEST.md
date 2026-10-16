# Founder physical iPhone retest — 10–15 minutes

Use Development build `74a22771-5998-485b-ac16-f316caf7491d`, version/runtime `1.6.59`, build `59`. Load the Development update recorded in `FIELDNOTES_DEVELOPMENT_OTA_REPORT.md`, then fully close/reopen once. Do not use Production.

1. **Launch/account (1 min):** verify icon/splash, completed account lands on the map, and Create your map Continue does not loop. Existing saved places remain. Do not reset onboarding or perform a new transfer on an account you want to preserve.
2. **Show All (2 min):** tap Show all pins; every saved location should be in the clear map area, including a distant save. Tap three times quickly. Choose a category, tap Show all pins, then use the filter menu's All places · Show all pins. Confirm Recenter still means your current location.
3. **Selected marker (2 min):** select a low-on-screen pin, then a different pin. Check photo/no-photo and a long name. Open details, collapse, reopen, dismiss. The marker should remain above the card; dismissing must preserve the camera. Pan during a correction and verify the app stops following the selection.
4. **Saved (1 min):** open Saved from the dock, scroll, filter, sort and select a place. The featured item should not immediately repeat in the rows. Return to Map and use Show All. Check the sheet and dock do not compete for gestures.
5. **Search (2 min):** search a saved name/note and select it; the compact card should remain attached to its map location. Search a new place and save. Simulate offline/failure, retry the same query, and confirm a failed save retains the query/results. Check no results and keyboard dismissal.
6. **Photos/detail (2 min):** open places with 0/1/2/5 known photos. Open/swipe/close gallery. Counts must match available photos; source frames must say Post/original post. Reopen offline after restarting to check locally retained images. Directions, original post, reason, reminder, visit and More should remain in the established order.
7. **Activity/Settings (1–2 min):** view processing/review/saved/failed states and a real share if convenient. Retry only a known failed test item. Open Settings in Light, then Dark, then Light; check for flash, correct backgrounds and Development tooling boundaries.
8. **Accessibility (1–2 min):** temporarily enable a large/accessibility text size and Reduce Motion. Repeat selected-card expansion and Show All. Check source labels and Settings; restore preferences afterward. Check VoiceOver announces Show All/filter state and selected place identity.

Apple Maps antimeridian/world-scale framing, actual small/large iPhone layouts, physical haptics/VoiceOver, real social Share Extension handoff, account-provider sign-in and transfer are physical acceptance items. Android debug and component tests are supporting evidence, not substitutes.

## Optional LAN Metro

```powershell
Set-Location "C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct15-polish"
git pull --ff-only
npm start -- --dev-client --lan --clear
```

Use the phone and workstation on the same LAN. The temporary QA Metro servers use ports 8082/8083 during automation; stop them before starting the normal interactive session if needed. Do not enable `EXPO_PUBLIC_MAP_PREVIEW_MODE` for founder live-data QA.
