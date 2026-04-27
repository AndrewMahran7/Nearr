# iOS Share Extension — Plan & Status

> **Status (V2 beta, 2026-04-27):**
> - **Android: SHIPPING.** Native "Share to Nearr" works end-to-end via a
>   patched `MainActivity.kt` + the
>   [withAndroidShareIntent](../plugins/withAndroidShareIntent.js) config plugin.
> - **iOS: WIRED via `expo-share-extension` (v1.10.7).** Plugin registered
>   in [app.json](../app.json), entry files
>   [index.share.js](../index.share.js) + [ShareExtension.tsx](../ShareExtension.tsx)
>   in repo root, [metro.config.js](../metro.config.js) recognizes
>   `share.js` as a source ext. The extension is a thin pass-through:
>   it grabs the first URL from the shared payload and opens
>   `nearr://share?url=<encoded>` in the host app, where the existing
>   [/share](../app/share.tsx) flow auto-runs.
> - **Manual paste fallback** still works on both platforms.

This document describes how the iOS share extension is wired, the manual
Apple Developer setup required for the App Group, the EAS build steps,
and the manual test matrix.

---

## What's fully implemented today

### Android (V2 beta — shipping)

- Intent filter for `android.intent.action.SEND` with `text/plain` is
  declared in [app.json](../app.json) under `android.intentFilters`.
- [android/app/src/main/java/com/nearr/app/MainActivity.kt](../android/app/src/main/java/com/nearr/app/MainActivity.kt)
  rewrites incoming `ACTION_SEND` intents into our existing
  `nearr://share?url=<encoded>` deep link, in both `onCreate` (cold start)
  and `onNewIntent` (warm start). It extracts the first `https?://` URL
  from `EXTRA_TEXT` (Instagram/TikTok captions often look like
  `"check this out https://www.tiktok.com/..."`) and trims trailing
  punctuation.
- [plugins/withAndroidShareIntent.js](../plugins/withAndroidShareIntent.js)
  re-applies the same MainActivity patch on every `expo prebuild`, so the
  feature survives a clean prebuild. Wired in [app.json](../app.json)
  `expo.plugins`. The plugin is idempotent (gated on a marker comment).
- [app/share.tsx](../app/share.tsx) auto-runs the save flow when a `url`
  param arrives, using a `lastProcessedUrlRef` so a NEW share mid-session
  re-triggers the flow but unrelated re-renders do not.
- Header copy on the share screen swaps to "Saving from share…" when
  launched with a URL param, hiding the manual paste hint.

### Manual paste fallback (always)

- [app/share.tsx](../app/share.tsx) still accepts a pasted URL. This is
  the fallback path on iOS until the share extension is enabled, and a
  defensive backup on Android if the share intent is dropped.
- Calls [parseShare](../lib/shareParser.ts) which fetches public OpenGraph
  metadata (no auth, no scraping), extracts a Google-Places-friendly
  query, and hands off to candidate selection / save.
- Source attribution (`source_type`, `source_url`) is preserved on the
  `saved_places` row.

### Deep-link plumbing (already in place pre-V2)

- `expo.scheme` is `"nearr"` in [app.json](../app.json), so
  `nearr://share?url=...` routes to [/share](../app/share.tsx) and
  auto-parses on mount.

## What's scaffolded but **not** wired in (iOS)

> The legacy hand-rolled scaffold under [native/share-extension/](../native/share-extension/)
> is **superseded** by `expo-share-extension`. It is intentionally kept for
> reference but is no longer compiled into the build. The
> [plugins/withShareExtension.js](../plugins/withShareExtension.js) plugin
> is still a no-op and should NOT be re-enabled.

| File | Purpose | Status |
| --- | --- | --- |
| [native/share-extension/ShareViewController.swift](../native/share-extension/ShareViewController.swift) | Hand-rolled Swift extension (App Group + deep link). | **Superseded** — `expo-share-extension` generates an equivalent target during prebuild. |
| [native/share-extension/Info.plist](../native/share-extension/Info.plist) | Hand-rolled extension Info.plist with activation rules. | **Superseded.** |
| [native/share-extension/NearrShareExtension.entitlements](../native/share-extension/NearrShareExtension.entitlements) | App Group entitlement. | **Superseded.** |
| [plugins/withShareExtension.js](../plugins/withShareExtension.js) | Original no-op placeholder plugin. | **Do not enable** — `expo-share-extension` replaces it. |

---

## How the iOS share extension works now

1. `expo-share-extension` is registered in [app.json](../app.json) under
   `expo.plugins` with activation rules `url` (max 1) and `text`.
   - On `expo prebuild` it creates a second iOS target (`NearrShareExtension`,
     bundle id `com.nearr.app.ShareExtension`).
   - It adds the App Group entitlement `group.com.nearr.app` to **both**
     targets automatically.
   - It writes the extension Info.plist with the activation rules above.
   - It updates the Podfile to include the extension target.
2. Metro is configured ([metro.config.js](../metro.config.js)) to recognize
   `share.js` as a source extension. This lets [index.share.js](../index.share.js)
   become the entry point of the extension bundle, distinct from the host
   app's [index.js](../index.js).
3. [ShareExtension.tsx](../ShareExtension.tsx) is the extension's root
   React component:
   - Reads `url` and/or `text` from `InitialProps` (Safari → `url`;
     IG/TikTok → `text` containing the URL).
   - Extracts the first `https?://` URL via regex (with trailing
     punctuation trim, mirroring the Android logic).
   - Calls `openHostApp("share?url=<encoded>")` — `expo-share-extension`
     prepends the app scheme automatically, so this becomes
     `nearr://share?url=<encoded>`.
   - Calls `close()` after a short delay so iOS can finish the openURL
     handoff before the sheet is torn down.
4. [app/share.tsx](../app/share.tsx) (already in place from V2 beta)
   reads the `url` param via `useLocalSearchParams<{url}>()` and
   auto-runs the existing save flow.

The extension never asks the user to tap anything. The total user-visible
time inside the share sheet is roughly the openURL latency + the 250ms
debounce — typically < 1s.

---

## Apple Developer Portal setup (one-time, manual)

`expo-share-extension` configures the build, but the App Group itself must
exist in the Apple Developer Portal under the same Team ID used to sign
the app:

1. **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**.
2. Click **+ → App Groups → Continue**.
3. Description: `Nearr Share Group`. Identifier: `group.com.nearr.app`.
   Continue → Register.
4. **Identifiers → App IDs**: edit `com.nearr.app` and `com.nearr.app.ShareExtension`
   (the latter is created by EAS on the next build) and check the
   **App Groups** capability, assigning `group.com.nearr.app` to both.
5. Re-generate provisioning profiles for both bundle ids. EAS will do
   this automatically the next time you run `eas build` — answer "Yes"
   when prompted to update credentials.

That's the entire one-time setup. There is no UserDefaults bridge to
maintain because the share extension hands off via the deep link path,
not the App Group container. (The App Group entitlement is still
required by `expo-share-extension` for shared-bundle plumbing.)

---

## EAS build steps

```sh
# 1. Regenerate the iOS project so the share-extension target is created.
npx expo prebuild --clean --platform ios

# 2. Build a dev client. EAS will prompt to provision the new
#    com.nearr.app.ShareExtension bundle id; accept.
eas build --platform ios --profile development

# 3. Install the resulting .ipa on a physical device (Safari / IG / TikTok
#    do not appear in the share sheet on the simulator).
```

After install, sign in to Nearr at least once so the host app's auth
context is initialized — otherwise the deep link will land on the auth
gate and the user has to re-share after signing in.

---

## App Group reference

- **Identifier**: `group.com.nearr.app`
- **Generated by**: `expo-share-extension` (entitlements + Info.plist
  written automatically during prebuild for both targets).
- **Used for**: required by iOS for the share-extension plumbing (shared
  container, font sharing, etc.). Nearr does not currently read or write
  to the container itself — handoff is via the `nearr://share?url=...`
  deep link.

---

## How shared URLs are passed to the main app

A single channel: the extension calls `openHostApp("share?url=<encoded>")`,
which `expo-share-extension` translates into `nearr://share?url=<encoded>`
(using the host app's `expo.scheme`). iOS launches/foregrounds the host
app, Expo Router parses the URL, the [/share](../app/share.tsx) screen
reads `useLocalSearchParams<{url}>()` and auto-runs the existing save
flow.

The legacy hand-rolled scaffold also wrote the URL into
`UserDefaults(suiteName: "group.com.nearr.app")` as a fallback. We
deliberately removed that channel here because:

- `openHostApp` is reliable in practice; the deep link is delivered cold
  and warm.
- Adding a UserDefaults bridge requires another native module
  (`react-native-shared-group-preferences` or hand-rolled), which is
  more code and more risk than it's worth for a redundant safety net.

If we ever observe dropped shares in the wild, the App Group container is
already provisioned (required by `expo-share-extension`), so adding the
fallback later is a small follow-up, not a re-architecture.

---

## Limitations of Expo Go

- **Custom native targets are unsupported.** Expo Go cannot host the
  share extension target. Use an EAS dev build (`eas build --profile
  development`) or a local prebuild (`npx expo run:ios`).
- **What still works in Expo Go**: the manual paste-link flow on
  [/share](../app/share.tsx).

---

## Honesty checklist (current state, 2026-04-27)

- [x] Manual paste-link flow works end-to-end in Expo Go and EAS dev builds.
- [x] Android system share sheet is **shipping**.
- [x] iOS share extension wired via `expo-share-extension` v1.10.7
      (plugin registered, entry files + metro config in repo, App Group
      auto-configured during prebuild).
- [x] Hand-rolled iOS scaffold under `native/share-extension/` deprecated
      with a note in this doc; not compiled into the build.
- [ ] App Group `group.com.nearr.app` created in Apple Developer Portal
      (one-time manual step — see "Apple Developer Portal setup" above).
- [ ] EAS dev build verified end-to-end with a real share from TikTok /
      Instagram / Safari **on iOS** (cannot be verified without an Apple
      developer account + physical iOS device; see test checklist below).

---

## Manual test checklist

### Android (after `npx expo run:android` or EAS dev build)

1. Install the dev build on a physical Android device.
2. Safari/Chrome → any URL → **Share** → **Nearr** → expect "Saving from
   share…" header and auto-save/picker.
3. Instagram Reel → **Share** → **More** → **Nearr** → same.
4. TikTok video → **Share** → **Nearr** → same.
5. While Nearr is already open on Home, repeat step 2 — `onNewIntent`
   handles the warm-start case.
6. Verify saved row carries the original `source_url` and right
   `source_type`.

### iOS (after `npx expo prebuild --clean --platform ios` + `eas build --platform ios --profile development`)

Requires a **physical iOS device**. The share sheet does not present
extensions on the simulator for Safari/IG/TikTok.

1. Install the EAS dev client `.ipa` on a real device.
2. Open Nearr once and sign in (so the auth gate is satisfied).
3. **Safari**: open any URL → tap **Share** → scroll the second row →
   tap **Save to Nearr**. Expect: a brief "Saving to Nearr…" sheet, then
   Nearr opens to `/share` with the URL param and auto-runs the save
   flow.
4. **Instagram**: open a Reel → **Share** (paper-airplane) → scroll
   apps → **Save to Nearr**. Instagram passes a `text` payload
   containing the URL; the regex extractor picks it out.
5. **TikTok**: open a video → **Share** → **Save to Nearr**. Same
   text-with-URL path as Instagram.
6. Verify the saved row has the correct `source_url` and matching
   `source_type` (instagram / tiktok / link).
7. Force-quit Nearr, then repeat step 3 — confirm cold-start delivery
   of the deep link.

If "Save to Nearr" does not appear in the share sheet, long-press the
last item in the second row → **Edit Actions** → enable **Save to Nearr**.
This is standard iOS behavior the first time a new extension is installed.
