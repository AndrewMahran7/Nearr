# REMINDER-DISTANCE-QA — Nearby Reminder Cleanup Validation

Owner: Physical QA owner (unassigned)

Timing: After this change is integrated into a device-build candidate and before release promotion. Run on at least one physical iOS device; add Android coverage when the Android candidate is available.

## Preconditions

- Use an account with existing saved places in at least the restaurant and outdoor/natural categories.
- Where reproducible, upgrade over an older build that has a non-default profile reminder distance and existing registered geofences. Do not edit production data directly to manufacture this state.
- Grant notification, foreground-location, and background-location permissions.

## Steps

1. Launch the upgraded build while preserving the older local reminder state, if reproducible; confirm launch completes without an error or reset loop.
2. Open Settings and confirm there is no profile-wide reminder-distance control or obsolete distance explanation.
3. Confirm the master notification and Nearby alerts preferences remain available and retain their states.
4. Save or enable reminders for a restaurant and confirm its automatic V2 reminder zone/registration remains available.
5. Save or enable reminders for an outdoor/natural place and confirm its automatic V2 reminder zone/registration remains available.
6. Confirm the restaurant and outdoor/natural automatic radii remain different where the V2 category policy designs them to differ.
7. Background the app, move through a representative monitored region, and confirm expected reminder behavior.
8. Kill and relaunch the app; confirm it restores without an error and reminders remain registered.
9. Confirm existing eligible saved places continue receiving geofence registration.
10. Add a new eligible saved place and confirm it receives geofence registration.
11. Open a delivered notification and confirm it routes to the correct nearby saved-place flow.
12. Inspect Settings, save flow, place detail, map, and notification copy; confirm no obsolete profile-default or unexpected "X miles" claim appears.

## Acceptance criteria

- A legacy profile reminder-distance value cannot affect V2 radius selection.
- Settings is cleaner while notification and Nearby alerts preferences remain intact.
- Category-aware radii, eligibility, geofence registration, arbitration, notification copy, decline/archive behavior, and nearby routing behave exactly as V2 intends.
- Background/resume and kill/relaunch produce no crash, repeated cleanup mutation, lost eligible geofence, or duplicate notification.

Code automation does not constitute a physical PASS for this ticket.
