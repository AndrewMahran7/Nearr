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

## Known blockers / unknowns

- Silent save is still unverified end-to-end in the current checkout unless a real-device test proves otherwise.
- A missing or stale App Group token should degrade to host-app fallback, not strand the user.
- Environment setup and deployment matter as much as code here.

## Legacy scaffold note

There is old native share-extension scaffold code under `native/share-extension/`. Treat it as legacy/dead scaffolding, not the active implementation path.
