# Nearr — iOS Share Extension

> Last updated: 2026-05-02
> Source of truth: current codebase

## Status

Current status: `partial`

What that means in practice:

- the share extension is enabled in [app.json](../app.json)
- the JS entrypoint is live
- the fallback host-app handoff path is real
- silent-save support exists in code
- end-to-end success still depends on native build provisioning, App Group setup, auth token bridge, deployed Edge Function, and real-device validation

This is not disabled anymore, but it is also not something the docs should describe as universally proven.

## Current wiring

- package: `expo-share-extension`
- config entry: [app.json](../app.json)
- JS entry: [index.share.js](../index.share.js)
- root component: [ShareExtension.tsx](../ShareExtension.tsx)
- native controller: `expo-share-extension` patched by [patches/expo-share-extension+1.10.7.patch](../patches/expo-share-extension+1.10.7.patch)
- auth bridge: [modules/nearr-shared-auth](../modules/nearr-shared-auth)
- host-app publisher of the access token: [lib/supabase.ts](../lib/supabase.ts)
- server-side processor: [supabase/functions/process-share-link/index.ts](../supabase/functions/process-share-link/index.ts)

## Expected flow

1. User shares a URL or caption containing a URL into Nearr.
2. Extension extracts the first URL.
3. Extension checks for:
   - `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`
   - App Group access token from the host app
4. If both exist, extension POSTs to `process-share-link`.
5. Result handling:
   - `saved` -> open host app directly to `/(tabs)/map?savedPlaceId=...` when available
   - `ambiguous` -> open host app share screen
   - `failed_requires_app` -> open host app share screen
   - `open_app` / missing setup / failure -> open host app share screen

## Fallback behavior

Fallback is not an error path in the product sense. It is the expected resilience path.

The extension should fall back to the host app when:

- the Edge Function URL is missing
- the shared auth token is missing
- the function returns `ambiguous`
- the function returns `failed_requires_app`
- the function returns `open_app`
- the network request fails
- response parsing fails

The host app then processes the shared URL on [app/share.tsx](../app/share.tsx).

## App Group / native requirements

You need a fresh native build for any share-extension change or verification run.

Required:

- host app and extension both provisioned correctly
- App Group configured on both targets
- `nearr-shared-auth` linked in the native build
- user signed in to the host app at least once so the access token can be bridged

## Compact presentation

The active native controller is supplied by `expo-share-extension`, not the legacy
`ShareViewController.swift` scaffold under `native/share-extension/`. After the
package creates the extension target, `withCompactShareExtension` copies Nearr's
authoritative `ShareExtensionViewController.swift` into it. The generated controller
is the principal class for `com.apple.share-services`; there is no storyboard and
no Nearr-owned modal or sheet presentation controller.

The share host owns that controller's outer presentation. Nearr requests the
configured 360pt `preferredContentSize`, but does not rely on the host honoring the
request. The principal view is transparent and non-opaque, while a native dark
surface is constrained to the bottom at 360pt (420pt for accessibility Dynamic
Type, or the available height when smaller). The loading indicator and transparent
React root are both constrained inside that surface. This keeps the visible Nearr
UI compact without painting the host-sized controller black.

iOS still owns the extension host and transition. The app can make its visible
content compact, but cannot guarantee that every source app or iOS version exposes
the underlying source UI in exactly the same way.

Physical-device checks required for a release build:

- small iPhone and large iPhone
- light and dark source apps
- Instagram, TikTok, Safari, and Photos share sheets
- submitting, accepted, setup, signed-out, expired-session, and network-error states
- close, Done, Open Nearr, retry, and swipe dismissal

## Known blockers / unknowns

- Silent save is still unverified end-to-end in the current checkout unless a real-device test proves otherwise.
- Compact native presentation requires a fresh iOS build and physical-device review; Windows cannot verify the system extension frame.
- A missing or stale App Group token should degrade to host-app fallback, not strand the user.
- Environment setup and deployment matter as much as code here.

## Legacy scaffold note

`native/share-extension/ShareViewController.swift` and its adjacent scaffold plist
remain legacy/dead. `ShareExtensionViewController.swift` is the authoritative
controller copied by the active compact-presentation config plugin.
