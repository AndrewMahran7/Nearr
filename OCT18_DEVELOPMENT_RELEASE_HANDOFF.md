# October 18 Development release handoff

## Release scope

- Development frontend OTA only
- App/runtime: `1.6.59`
- Starting source: `5d55966e33c889699fe19ef4e7a6b0b9655712c3`
- Runtime implementation commits: `0be13b5` and `c3de563`
- Branch: `fix/nearr-1.6-oct18-detail-review`
- Worktree: `C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct18-detail-review`
- Native build: no new binary required for the JS/TS changes
- Production, backend, Railway, recognition, monetization, app icon, and main: untouched

## Validation

The focused October 18 suite, October 15 regression suite, full prebuild preflight, full prebuild main matrix, and safe-Development deployment guards pass. The environment guards identify the Development application/backend pairing without printing secrets. The runtime policy is app-version based and resolves to `1.6.59`.

Native visual capture was unavailable. Founder physical iPhone QA remains required. The unresolved Share Extension appearance warning is not claimed fixed and would require a new binary if a native source correction is ultimately confirmed.

## Development OTA

Status: published and post-publish head verified.

- Previous group: `0cb3a6cb-f50f-4d35-a635-c6b87102ad57`
- New group: `3cc30077-3ff3-46d8-9d74-e923ee1592a0`
- Runtime: `1.6.59`
- Platforms: Android and iOS
- Android update: `01a15263-2d22-7643-b25f-36ab9693841b`
- iOS update: `01a15263-2d22-729c-83d1-b723b29df7c0`
- Message: `October 18 place detail and Quick Check completion`
- Published application source: `aa96cdbdc558ba48980fe9cca3d418773f3c7eb5`
- Dashboard: https://expo.dev/accounts/andrewmahran/projects/nearr/updates/3cc30077-3ff3-46d8-9d74-e923ee1592a0

The first export attempt failed before publication because Metro could not follow the borrowed `node_modules` junction; the Development head remained on the previous group. A lockfile-defined local install fixed module resolution, and the sole successful publication created the group above. The post-publish list shows it directly ahead of the October 15 group, so shared Development advanced exactly once.

## Metro and local launch

No listeners were found on ports 8081–8083 during this session. A founder Metro on 8081 may exist later or in another session; verify ownership before starting and do not kill it automatically.

```powershell
Set-Location "C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct18-detail-review"
git status --short
git rev-parse HEAD
git pull --ff-only
npm start -- --dev-client --lan --clear
```

Project dependencies were already available through the isolated worktree setup. The media-worker's locked dev dependencies were installed only to run the repository prebuild matrix; no dependency-install command is needed for ordinary app launch.

## Founder retest

1. Open a saved pin near a screen edge. Confirm the compact marker is fully visible, expand the card, and verify the destination page fills about 90–95% of the usable screen.
2. Scroll from the gallery through the final visit row. Confirm the fixed header retains the actual place name, no fragments leak under it, and the last row clears the home indicator.
3. Repeat with a long name and large Dynamic Type. Toggle Remind me nearby and confirm the full switch and wrapped copy remain inside the sheet.
4. Open Quick Check for a new place and for an already-saved place from a new post. Tap Save twice quickly. Confirm one persistence result, one completion, and return to the exact saved place.
5. Exercise a stale/completed review and a cancelled review. Confirm completed work offers View place/Done and cancelled work does not claim success.
6. Exit through success, Back, and dismiss. Confirm the Map/Saved dock and normal map controls return every time.
7. Check the 2nd Floor Phase 2 practice card, missing-source fallback, original-post action, Saved nearby thumbnails, 5/5 gallery persistence, light-mode status bar, and relaunch.
8. Reproduce the iOS Share Extension warning and capture its full text/call context separately; the OTA does not update native extension code.
