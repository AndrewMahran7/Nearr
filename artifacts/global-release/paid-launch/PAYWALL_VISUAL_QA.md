# Paid client QA — 29 October 2026

Client implementation and component behavior checks pass. **Native visual qualification is incomplete; no new eligible iOS or Android paywall screenshot is claimed.** No purchase, StoreKit sandbox payment, RevenueCat activation, or Production action was performed by this client task.

## Implemented

- Existing Fieldnotes Screen/Card/Button styles: cream/green/orange, a single scrolling surface, wrapping text, three vertical token cards, no fixed text height or line truncation.
- Three free successful video finds per UTC calendar month, reservation/reset display, separate nonexpiring token balance, verified unlimited Plus and expiry display. Settings links to the same balance/paywall.
- New unlimited monthly product only. Runtime catalog requires an auto-renewable subscription, P1M period, monthly package, no introductory offer; token products require exact configured IDs/packages, 20/50/200 quantities and consumable type.
- All visible prices come unchanged from the native Store product `priceString`. The $1.99/month and token target prices are not production fallbacks. Missing, unqualified, ineligible or incomplete catalogs cannot start purchases.
- Close, legal links, restore, subscription management, loading/offline/errors, pending recovery, cancellation, billing grace, expiry, revocation and age/country restriction copy.
- Pending transaction hints are account scoped and durable before entering StoreKit. Another purchase is blocked until resolution. Server proof must match an exact transaction; without a returned transaction ID, the server receipt must include a transaction ID and the exact attempt binding. SDK customerInfo and existing balances never prove a new purchase. Exactly bound revoked receipts release recovery without granting credit.

## Executed evidence

`client/runtime-tests.json`: 16 groups, including real client SDK/network/storage boundary tests, real usePlus hook identity/offline tests, a real-screen purchase/cancellation interaction and **110 real-screen component renders** (11 states × 10 locales). Native/network boundaries and shared layout/Button primitives are mocked; these are not Apple purchases or pixel layout.

Integration follow-up: the initial hand-written successful Plus receipt fixture hid a server allowlist mismatch that left real subscription purchases pending. That fixture has been removed. All purchase responses now use the actual `reconcilePurchaseHint` helper; Plus proof first passes through actual `verifyPaidSubscriber`. The server now supplies a request-scoped, freshly verified and successfully applied subscription snapshot. Tests cover fresh exact transaction success, old/missing/stale/legacy/mismatched proof remaining pending, no-ID attempt binding, lost SDK callback recovery through restore without a second purchase, and verified revocation resolving without credit. A separate regression switches accounts after the marker write but before the SDK callback: StoreKit is never invoked and the unused marker is cleared. Post-invocation errors remain pending. Full TypeScript passed with these integration changes.

The existing disabled/free-only/offline client suite passed 40 real-screen renders; token UX suite passed 21 cases; general localization suite passed. Full TypeScript passed after the receipt recovery and translated restriction additions. The later subscription-type predicate and its regression passed the paid client suite. Backend endpoint assertions are maintained by the backend owner.

Five representative rendered component trees are in `client/component-trees/`: English free, German pending, Japanese active, Korean revoked and Simplified Chinese unavailable. These contain actual rendered text and enabled/disabled props; they are **not images and do not establish clipping, font scaling or touch-target geometry**.

## Bounded Android attempt and limits

Used the existing Pixel 8a API36 emulator, its existing cached debug APK and the current worktree's shared dependency junction. No tooling reinstall or native build. The native app remained at “Loading from 127.0.0.1:8081…”. `client/android/setup.png` is the unedited framebuffer evidence of that setup failure, **not a paywall screenshot**. No QA account was created by this attempt; preview mode uses no live identity or balance.

Read-only diagnosis found Metro HTTP500: `Unable to resolve expo-router/entry from index.js`, caused by Metro not crawling the real shared node_modules junction target. A QA-process-only ignored resolver hook adds the real target to watchFolders/nodeModulesPaths with symlink support; shipping Metro configuration and dependencies were not changed. A separate local server on port8082 generated the Android bundle successfully (2,090 modules; read-only fetch HTTP200, 19,681,902 bytes, SHA-256 recorded in `client/android/bundle-generation.json`). This proves bundle generation, not emulator installation or display; it preceded the final auto-renewable-type predicate tightening.

The Development preview is behind the existing Development environment guard plus `__DEV__`. It labels every screen “DEVELOPMENT FIXTURE · no live balance or Store price · purchases disabled”. Its purchase/recovery/manage actions are inert. Its sample prices and balances must never be presented as live storefront, entitlement, screenshot-submission or sandbox evidence.

Still required: actual current native paywall inspection on iOS and Android, long German/French copy, Japanese/Korean/Chinese, large font scale, screen reader/touch targets, real qualified storefront prices and actual StoreKit sandbox purchase/restore/pending/revocation. Historical Android standalone qualification is not evidence for these new views.

Cleanup: both task-owned Metro process trees (67540 and 65136, including their four transform workers) were stopped; ADB reverse port8081 was removed. No font, density, notification, location or network setting was changed. The task-owned emulator retains the cached debug APK; the original release APK was not reinstalled after the blocked native action. No live account or cloud fixture needs deletion. `client/android/cleanup.json` records this limited cleanup.

## Automatic approval rejection

An automatic approval review rejected the following combined command with only `blocked by policy`; no reason was supplied. No equivalent native restart was retried. Subsequent work was limited to the separately authorized local resolver fix and read-only bundle diagnostics.

```powershell
& 'C:\Users\andre\AppData\Local\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 shell am force-stop com.nearr.app; & 'C:\Users\andre\AppData\Local\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 shell am start -a android.intent.action.VIEW -d 'nearr://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.nearr.app; try { $paidPreviewBundle = Invoke-WebRequest 'http://127.0.0.1:8081/index.bundle?platform=android&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=true&transform.routerRoot=app' -TimeoutSec 40; Write-Output ('Bundle HTTP '+$paidPreviewBundle.StatusCode) } catch { $_.Exception.Message }
```
