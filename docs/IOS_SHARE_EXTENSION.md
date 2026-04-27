# iOS Share Extension — Plan & Status

> **Status:** **scaffolded, not enabled.** The Swift / Info.plist / entitlements
> files exist under `native/share-extension/`, and a no-op config plugin lives
> at `plugins/withShareExtension.js`, but the plugin is **not** registered in
> `app.json`. The app today uses the in-app **paste-link** flow on the
> [`/share`](../app/share.tsx) screen, which works in Expo Go and EAS dev builds.

This document describes what was scaffolded, why each piece exists, what's
still required to ship a real "Share to Nearr" experience from TikTok /
Instagram / Safari, and the specific Expo Go limitations involved.

---

## What's fully implemented today

- **Manual paste-link flow** ([app/share.tsx](../app/share.tsx)):
  - User opens Nearr → "Save from a link" → pastes URL → preview → confirm.
  - Works in Expo Go and EAS builds.
  - Calls [`parseShare`](../lib/shareParser.ts) which fetches public OpenGraph
    metadata (no auth, no scraping), extracts a Google-Places-friendly query,
    and hands off to [`/add-place`](../app/add-place.tsx) for candidate
    selection and save.
  - Source attribution (`source_type`, `source_url`) is preserved on the
    `saved_places` row.
- **Deep link plumbing**: `expo.scheme` is `"nearr"` in
  [app.json](../app.json), so `nearr://share?url=...` already routes to
  [`/share`](../app/share.tsx) and auto-parses on mount (Task 11).
- **Android `SEND` intent filter**: the manifest entry already exists in
  [app.json](../app.json) under `android.intentFilters`, so on Android a user
  can already pick "Nearr" from the system share sheet for `text/plain` data.
  The host app receives the URL as a deep link parameter handled by Expo
  Router. This works today in EAS / `expo run:android` builds (not in
  Expo Go).

## What's scaffolded but **not** wired in

These files exist on disk but are not yet referenced by the build:

| File | Purpose |
| --- | --- |
| [native/share-extension/ShareViewController.swift](../native/share-extension/ShareViewController.swift) | Reads the first `public.url` (or text-with-URL) attachment, persists it to the App Group `UserDefaults` (`lastSharedUrl`), then opens `nearr://share?url=<encoded>` to wake the host app. |
| [native/share-extension/Info.plist](../native/share-extension/Info.plist) | `NSExtensionActivationRule` so "Nearr" appears in the iOS share sheet for URLs / text containing URLs / image+url combos. |
| [native/share-extension/NearrShareExtension.entitlements](../native/share-extension/NearrShareExtension.entitlements) | App Group entitlement (`group.com.nearr.app`). |
| [plugins/withShareExtension.js](../plugins/withShareExtension.js) | No-op config plugin placeholder. Logs a warning if accidentally enabled. |

These are kept under `native/` (not `ios/`) on purpose: `expo prebuild`
**overwrites `ios/`** but leaves `native/` alone. A real config plugin will
copy from `native/share-extension/` into the generated Xcode project on each
prebuild.

---

## What still needs to be done

### 1. Decide on the implementation path

Two viable options:

**Option A — Use `expo-share-extension` (or similar community plugin).**
- Pros: less custom Xcode work, the package handles target creation,
  entitlements, and pbxproj rewrites for you.
- Cons: another dependency; needs vetting; behavior must be tested end-to-end
  with a real EAS build against TikTok/Instagram share sheets.
- Recommended starting point if available on npm at the time of build.

**Option B — Hand-roll using `@bacons/xcode` in our own config plugin.**
- Pros: full control; no extra runtime dep.
- Cons: more code; the plugin must mutate `Nearr.xcodeproj/project.pbxproj`
  to add a second target — non-trivial and brittle across Xcode versions.

Either way, the runtime contract is the same: the extension drops a URL into
the App Group and opens `nearr://share?url=...`.

### 2. Xcode steps the chosen plugin must perform on prebuild

When the config plugin runs, it must:

1. **Create a new app extension target** named `NearrShareExtension`.
   - Bundle id: `com.nearr.app.shareextension`.
   - Deployment target: same as the host app.
   - Add `ShareViewController.swift`, `Info.plist`,
     `NearrShareExtension.entitlements`, and a `MainInterface.storyboard`
     (auto-generated; can be the default empty storyboard).
2. **Add the App Group capability** (`group.com.nearr.app`) to **both**
   targets (host + extension). This requires the App Group to also be
   created and assigned in Apple Developer Portal under the same Team ID
   used for code signing.
3. **Add the extension target as an embedded binary** of the host app so it
   ships inside the .ipa.
4. **Update Podfile** so the extension target inherits Pods needed for Swift
   stdlib (usually nothing else is required for a plain Swift extension).
5. **Add `LSApplicationQueriesSchemes`** entry in the host Info.plist if we
   ever want the host app to call back into other share targets (not needed
   for our current flow).

### 3. Host app changes

- **App Group entitlement**: must be added to the host app's entitlements
  (the config plugin should also patch `ios/Nearr/Nearr.entitlements` or the
  equivalent generated file).
- **Read the App Group on launch / foreground**: in [`app/_layout.tsx`](../app/_layout.tsx)
  add (when iOS) a tiny native module call (or a JS bridge using
  `react-native-shared-group-preferences`) to read `lastSharedUrl`, then
  navigate to `/share?url=...` and clear the key. This is a redundant safety
  net in case the `nearr://share` URL is dropped while the app was killed.
- **Deep-link handling for `nearr://share`** is already wired via Expo
  Router (the `/share` route + `useLocalSearchParams<{url}>()`); no change
  needed there.

### 4. Build & test

- `npx expo prebuild --clean` must succeed and produce an `ios/` project
  with **two** targets (`Nearr`, `NearrShareExtension`).
- `eas build --platform ios --profile development` must pass code signing
  for both targets. Both need provisioning profiles tied to the App Group.
- Manual test matrix:
  - Share from Safari → URL → Nearr appears → tap → app opens on `/share`
    with URL prefilled and metadata preview rendered.
  - Share from TikTok → "Copy link" path: the share sheet sometimes
    delivers plain text containing a URL rather than a URL attachment;
    `ShareViewController.firstUrl(in:)` handles this.
  - Share from Instagram → similar to TikTok; some posts deliver only an
    image attachment with no URL — in that case the extension does
    nothing (acceptable for V1).

---

## App Groups

- **Identifier**: `group.com.nearr.app`
- **Where it appears**:
  - [native/share-extension/NearrShareExtension.entitlements](../native/share-extension/NearrShareExtension.entitlements)
  - [native/share-extension/ShareViewController.swift](../native/share-extension/ShareViewController.swift) `appGroupId` constant
  - The host app's entitlements (added by the config plugin during prebuild)
  - Apple Developer Portal → Identifiers → App Groups (must exist there)
- **Used for**: persisting `lastSharedUrl` so the host app can recover it
  even if the `nearr://share?url=...` deep link is dropped (e.g. host app
  was force-killed).

---

## How shared URLs are passed to the main app

Two complementary channels, both safe to use simultaneously:

1. **Deep link (primary)**: the extension calls
   `nearr://share?url=<urlencoded>`. iOS launches the host app or
   foregrounds it, Expo Router parses the URL, the [`/share`](../app/share.tsx)
   screen reads `useLocalSearchParams<{url}>()` and auto-runs `parseShare`.
2. **App Group `UserDefaults` (fallback)**: the extension also writes
   `lastSharedUrl` and `lastSharedAt` into
   `UserDefaults(suiteName: "group.com.nearr.app")`. On host app foreground,
   we can read these via a JS bridge and navigate to `/share?url=...` if
   the deep link was missed. **This bridge is not yet implemented** — see
   "Host app changes" above.

Both paths converge on the same Expo Router screen, so the rest of the
flow (metadata fetch, preview, candidate selection, save) is identical to
the manual paste flow.

---

## Limitations of Expo Go

- **Custom native targets are unsupported.** Expo Go ships a fixed bundle of
  native modules; you cannot add a second iOS target (the share extension)
  without leaving Expo Go.
- **Background tasks are unsupported in Expo Go.** This is already noted for
  the proximity notifications feature (Task 10), but it applies here too:
  any feature that requires custom native code requires an **EAS dev build**
  (`eas build --profile development`) or a local prebuild
  (`npx expo run:ios`) once the share-extension plugin is enabled.
- **What still works in Expo Go**: the entire paste-link flow on
  [`/share`](../app/share.tsx), including OpenGraph metadata extraction,
  candidate search, and save. No regression from scaffolding the extension
  files since they aren't compiled in Expo Go.

---

## Honesty checklist (current state, 2026-04-26)

- [x] Manual paste-link flow works end-to-end in Expo Go and EAS dev builds.
- [x] Android system share sheet entry exists in `app.json` and works in EAS
      builds (not Expo Go).
- [x] iOS Swift / Info.plist / entitlements scaffolds written under
      `native/share-extension/`.
- [x] Config plugin file exists at [plugins/withShareExtension.js](../plugins/withShareExtension.js)
      as a no-op placeholder.
- [ ] Config plugin actually creates the iOS target on prebuild.
- [ ] App Group is created in Apple Developer Portal.
- [ ] Host app reads `UserDefaults(suiteName:)` on foreground as a fallback.
- [ ] EAS dev build verified end-to-end with a real share from TikTok /
      Instagram / Safari.

The unchecked items are the work required to turn the scaffold into a
shipping feature. None of them block the rest of the app today.
