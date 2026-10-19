# Fieldnotes physical QA handoff

## Release status

Implementation, repository validation, and the Development OTA are complete. Founder iPhone QA remains required because no iOS renderer or physical device was available.

## Ten-minute iPhone checklist

1. Confirm the installed Development client reports runtime `1.6.59`, then load the latest Development update.
2. Open 2nd Floor and another saved place. Expand each and tap More. Confirm Activity, map controls, and the dock are absent; More and Close respond normally.
3. Toggle `Remind me nearby` off/on in Light and Dark. Confirm the entire rounded track, thumb, and at least a small trailing inset are visible. Repeat at the largest practical Dynamic Type size and scroll the sheet.
4. Choose Outdoors when empty, then rapidly choose All Places and Food & drink. Confirm one empty card sits below the chips only when appropriate and no old no-location message remains over visible pins.
5. Open and close More and Activity rapidly. Confirm no ghost labels, rectangular moving dim layer, or invisible blocked tap. In empty Activity, `Back to your map` must show the normal map and dock.
6. Open Search → Your places for a photographed save. Compare Search, Saved, compact card, and expanded detail. The same destination imagery should remain; no blank flash or unrelated social frame.
7. Find a new place such as Disneyland Park and save it. Confirm the row says `Saving…`, repeated taps create one save, failure keeps the query with `Try again`, and success waits for persistence.
8. After success, confirm the marker is fully visible with useful local context, not at a continent edge. Pan during a later programmatic move and confirm the gesture wins. Run Show All with distant/international saves.
9. Check status indicators on map, Search, Activity, expanded detail, More, gallery, auth return, Light, Dark, and System. Cream surfaces require dark indicators.
10. Confirm `Mark visited` and `Not yet`, `Automatic · Change distance`, compact short-note spacing, and `Near this place`. Verify VoiceOver labels and Reduce Motion once.

Capture screenshots at steps 2–4, 6, 8, and 9 plus a short video of step 5. Record the `[fieldnotes-layout] reminder-switch` line from a Development console if available.

## Release compatibility checked before publication

- Project: `andrewmahran/nearr` (`2ec7a08a-2078-4232-a244-c9d16fb75ffe`)
- Channel/branch: Development / `development`
- App and OTA runtime: `1.6.59`
- Compatible iOS build: `74a22771-5998-485b-ac16-f316caf7491d`, build 59, runtime `1.6.59`
- Newer iOS build `4b64b0ef-483c-455e-b3fa-8caa0c1afa62` uses runtime `1.5.59` and will not receive this update
- Native dependency/config changes: none; OTA is sufficient for the compatible 1.6.59 client
- Production: untouched

## Final Development OTA

- Status: published and post-publish head verified
- Update group: `520be41a-0c53-4d4b-af56-0423e6a473b4`
- iOS update: `01a15320-4d1d-7199-9e3c-5f8a88933117`
- Android update: `01a15320-4d1d-74c1-a01a-5c79f2a0e4d7`
- Runtime: `1.6.59`
- Application source: `77d704c438e13ca7e32343e53deb3cb626ab50b6`
- Git branch: `fix/nearr-1.6-physical-ui-qa`
- Message: `Fix Fieldnotes physical UI ownership and continuity`
- Dashboard: https://expo.dev/accounts/andrewmahran/projects/nearr/updates/520be41a-0c53-4d4b-af56-0423e6a473b4

The post-publish list shows this group directly ahead of `3cc30077-3ff3-46d8-9d74-e923ee1592a0`, confirming one Development advancement. Production was not queried for mutation and was not changed.
