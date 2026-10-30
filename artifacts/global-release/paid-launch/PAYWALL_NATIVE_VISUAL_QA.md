# Native paywall qualification — 29 October 2026

**Current result: the bounded Android paywall fixture matrix is complete: all ten languages in Light and Dark at default size, plus German Light and Japanese Dark at narrow width/1.5× text. Real StoreKit purchases remain zero; no Android image is an eligible Apple review screenshot.** The initial transport and export failures below are historical attempts, superseded by verified offline packaging and normal UI launch. The disposable `com.nearr.paidqa` application has been removed after verification, with original-app package metadata preserved. Final capture coverage is in `payment-qualification/native/fixture-captures/`.

The current QA artifact uses Development JavaScript source `6a2a38d19637d3058d5ab130b18865892641bd3b`, an embedded complete bundle and assets, OTA disabled, and a distinct package/UID from the existing Nearr app. The genuine paywall renders synthetic balances and prices with a Development fixture banner and disabled purchase controls. Its Development-only theme selector was qualified with 11 renderer scenarios, the existing client regression suite, TypeScript and full prebuild before packaging. Current receipts are `theme-host-regeneration.json`, `theme-input-verification.json`, `theme-build.json`, `theme-apk-inspection.json` and `theme-install.json`.

| Artifact | Verified fingerprint |
| --- | --- |
| Current QA APK | 86,867,516 bytes; SHA256 `999d2816100b8b7700d1851657c3ec5bd6682bff99637c9bff88661e8ae12470` |
| Complete embedded JavaScript | 19,248,113 bytes; SHA256 `b747d84414403caaf8df1b502bcd64d060cfb7f8247e343a52b9130dafc39e34` |
| Embedded current Expo Constants | SHA256 `d3cbe45092308cc84090d01e5d16667e0c610b89ab60295c5bc1645a58d3f080` |
| Signing certificate | Android debug certificate; SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`; APK signature verified |
| Prior light/state QA APK | Source `63600e8`; SHA256 `647ed3c1f170a8fed504e11a85118cc306ac1f7fd37a09146ad3655a98e2f795`; retained separately in ignored scratch |

The cached native project is source `3dbf10278368c2074afa095627b71be21f24aaa3`. Its package-lock and the current worktree both hash to `023782d169101d044b08e40d6cdc1d9d83168f125b1f6095cbd6ffaa4b773bd8`; tracked native-cache files remained clean. The isolated Gradle override changes only QA packaging, supplies current verified JS/Constants/assets and skips the previously stalled Expo export. Runtime is `1.7-onboarding-date-android-v2`, Android target 34. Although x86_64 was requested, the APK contains four native ABIs; actual execution uses the x86_64 API36 Pixel 8a emulator. This is a non-shipping fixture artifact, not a release candidate or a fresh iOS/native-project qualification.

The initial fixture link resumed the birthday screen because `PreAccountEligibility` had not mounted the root navigator. A synthetic adult QA birthday (29 October 1999) and US country were entered through the fresh QA app's normal UI. This component stores only a local age-range/country declaration. The session stopped normal onboarding at Welcome and retried the observed fixture link successfully. No real person's age was asserted; no backend account, Nearr/Apple agreement acceptance, provider request or purchase was created. The initial route warning is retained as historical evidence and is no longer the runtime blocker.

The theme-package update was refused with `INSTALL_FAILED_INSUFFICIENT_STORAGE` while emulator `/data` had 476 MiB free. There was no task APK left in `/data/local/tmp`; no unrelated files were deleted. After verifying the exact task-owned QA package/UID, only `com.nearr.paidqa` was uninstalled and the inspected new APK freshly installed. Its synthetic local state was recreated through normal UI using a synthetic adult birthday of 29 October 2005 and US country. New QA UID is 10229. Original `com.nearr.app` UID 10228, first-install time and last-update time remained unchanged. No byte-for-byte original userdata comparison was performed because that data was not accessed. The failure and successful replacement have separate receipts.

## Current display qualification notes

The current-source Light/default sweep covers all ten languages in five unedited frames per language, including the absolute top fixture banner and the lower purchase/restore/footer content. Independent review of all 50 frames found no material clipping, overlap, missing glyphs, truncated controls or obscured footer. Japanese and Korean hero copy has minor readable wrapping: the final Japanese `と` occupies its own line and the Korean heading wraps within its final word.

German Light was also captured at 840×2160 pixels, density 420 (about 320 dp wide), and font scale 1.5. The twelve scroll frames show the lower content and footer; repeated bottom frames are not additional test conditions. Independent review found readable copy and controls within horizontal bounds. The final `n` of `Nutzungsbedingungen` wraps onto its own line, a cosmetic observation rather than hidden content.

The first Dark sweep was stopped because native text retained approximately 1.5× metrics after the German stress test, despite both the stored setting and Activity configuration reporting 1.0. The same-source English fixture banner measured 124 pixels high versus 83 at default, while hero line height was approximately 149 versus 100 pixels. Seven completed sets are retained as `dark-retained-large`, explicitly excluded from default-size coverage. This is a measurement limitation of that live configuration transition; it is not evidence that Dark typography intentionally differs. Normal QA-only Recents swipe gestures did not dismiss the selected card. No forced activity command or original-app operation was used.

Reinstalling only the disposable QA package from the unchanged inspected APK created UID 10230 and a fresh process at the restored default configuration. Its Dark English fixture banner, hero and free-find label bounds exactly matched the known same-source Light/default baseline. `default-font-baseline-verification.json` records the comparison and Activity configuration. The synthetic 29 October 2005/US local declaration was recreated without identity or Nearr/Apple agreement acceptance. The repeated Dark/default sweep then completed all ten locales. Independent review and hash verification covered all 100 default frames: 20 language/theme combinations at 1080×2400, density 420 and effective font scale 1.0. The readable Japanese/Korean heading wraps recur in both themes; no material clipping, overlap, missing glyph, truncated control or obscured footer was observed in those captured frames.

The synthetic presentation sweep also covers unavailable catalog, pending, offline, active, cancelled, grace, expired, revoked and restricted states in English/Light. Those initial state captures use source `63600e8`; `app/plus.tsx`, the paid client/model and locale files have no difference from current source `6a2a38d`. Their first frames can be slightly scrolled. A current-source pending sweep separately includes the complete Terms and Privacy footer. These are presentation checks of disabled fixture controls, not successful purchase, restore, manage-subscription or account-recovery actions.

Japanese Dark at 840×2160, density 420 and font scale 1.5 has eleven frames through the complete legal footer. Independent review of the top and scroll3/6/7/10 found readable CJK and wrapping Plus/token/restore controls within horizontal bounds, without material overlap or clipped text. Both stress sweeps use about 320 dp width. They do not cover every language/state/font/device combination or qualify seamless live font-setting transitions.

| Recorded condition | Exact scope | Frames |
| --- | --- | ---: |
| Current default Light/Dark | Ten locales, two themes; 1080×2400, 420 dpi, verified font 1.0 | 100 |
| Current narrow/large | German Light (12), Japanese Dark (11); 840×2160, 420 dpi, font 1.5 | 23 |
| Current pending footer | English Light, complete restore/manage/Terms/Privacy presentation | 8 |
| Earlier state/locale presentation | Nine English Light states (45), Chinese Light offers (5), source `63600e8` | 50 |
| Supplemental retained-font observations | Seven Dark locales with measured approximately 1.5× text; excluded from default coverage | 35 |

The [final runtime receipt](payment-qualification/native/side-by-side-runtime.json) verifies all 216 PNG hashes/dimensions across 40 capture manifests. Frames are scroll positions, not 216 independent test conditions; repeated bottom frames are retained. Four earlier manual English fixture images also remain outside that manifest total. The fully reviewed default matrix comprises 20 actual language/theme conditions. Fixture balances/prices are synthetic, controls are disabled, and no live entitlement, purchase, restore, management sheet, provider result or screen-reader interaction was exercised.

Final cleanup at 01:30:27 UTC restored physical size 1080×2400, density 420 and font scale 1.0; system night mode remained `no`. Only disposable QA UID 10230 was removed, deleting its synthetic declaration/preferences and ensuring no stale QA process remained. Original `com.nearr.app` UID 10228 and installation/update timestamps remained unchanged; its userdata was not read or byte-compared. The exact task UI dump was removed. Native-cache tracked files remained clean; both inspected APKs were retained in ignored scratch with verified hashes. A subsequent host check found no known task Node helpers and no listeners on 8082/8094/8095. Signed-out Chrome and its local helper tab remain; browser first-run setup had been completed and notifications declined, with no account added. See the [final cleanup receipt](payment-qualification/native/side-by-side-cleanup.json).

## Initial transport attempt — historical

The worktree and local remote-tracking branch both resolved to `49f559d488f133a744c7cd21809cc65c15cf9b8d` at inspection. The existing Pixel 8a API36 emulator had `com.nearr.app` version 1.7.0, versionCode 1, marked debuggable. Its initial screen was an older Expo module-resolution error. No APK, tool or dependency was installed.

The supported Windows computer-use inventory exposed no targetable emulator window, so Android's existing ADB interface supplied unedited framebuffer captures and normal input. The session responded to its visible Reload/Home controls and manual Development-server entry. No force-stop, activity relaunch command or app-data reset was used. The earlier rejected combined force-stop/relaunch command was not retried.

The established ignored Metro resolver hook loaded the shared dependency junction and enforced the Nearr-Dev environment. The local server used two workers. Host bundle generation passed: HTTP 200, 2,087 modules, 19,246,420 bytes, SHA-256 `7f963695301008362323ad99c48b8d0f21c2986f2f1a30c612e4fb59fcc38620`. An emulator-localhost connection timed out; the launcher then discovered and opened the standard emulator-host URL at port 8082.

The native downloader failed in `BundleDownloader.processMultipartResponse` with `ProtocolException: Expected leading [0-9a-fA-F] character but was 0xd`. A process-local, ignored Metro middleware test forced plain JavaScript and identity encoding for bundle requests. Even when the requesting client advertised multipart/gzip, the host returned the complete bundle with exact Content-Length and no content/transfer encoding. The native retry then failed in `BundleDownloader.storePlainJSInFile` with `ProtocolException: unexpected end of stream`. The final framebuffer remained on “Loading from 10.0.2.2:8082…”. Metro's inspector listed no connected JavaScript target during the failed startup.

The coordinating backend agent's public RevenueCat config mapping edit landed before the last local server restart. `plain-bundle-response.json` records its app.config.js hash; the final screenshot receipt records all relevant source hashes. This Android fixture experiment does not qualify an Apple SDK key or catalog. Shipping Metro configuration and installed dependencies were not changed by native QA.

## Initial transport coverage — historical

| Required native check | Result in this attempt |
| --- | --- |
| Unlimited Plus, 20/50/200 packs, descriptions and truthful price state | Not reached |
| Restore, Manage Subscription, errors, pending recovery, balance and UTC reset | Not reached |
| Light/Dark, large text, narrow layout, clipping and overlap | Not run; no visual conclusion |
| en-US, es-MX, es-ES, pt-BR, fr, de, it, ja, ko, zh-Hans | All ten were unqualified on native pixels in this initial attempt |
| Actual Apple StoreKit presentation/transactions | Not run; no connected iOS execution route |

The historical 110 component renders and current regression suites are separate evidence. They do not establish native geometry, font scaling, accessibility or successful payments. No fixture balance, sample price or mocked transaction is counted as a live purchase.

Evidence is in `payment-qualification/native/`: `initial-emulator-state.png` and `bundle-download-failure.png` are genuine 1080×2400 Android failure captures with provenance/hash receipts; neither contains the paywall. `bundle-generation.json`, `plain-bundle-response.json` and `bundle-transport-diagnostic.json` preserve bounded technical results. Raw logs remain in ignored local scratch. **No image from this attempt is eligible for Apple product review or iOS storefront screenshots.**

## iOS route and initial transport cleanup

Read-only Windows device inventory found no connected iPhone/iPad and no `xcrun`, `xcodebuild`, `idevice_id`, `ideviceinfo`, `ios` or `go-ios` executable on PATH. The installed Apple Devices application explicitly displayed “Connect an Apple device to get started.” The previously inspected internal Development IPA 1.7.0 (73) exists, but it is not installed on an available Apple device and its host application JavaScript is not embedded. Account-side TestFlight/remote-device availability belongs to the coordinating account audit; this local inventory makes no claim about it. `ios-route-availability.json` records the exact scope.

At the end of the initial transport attempt, cleanup stopped only verified task-owned Metro processes and workers, removed the two task-owned ADB reverse mappings, and verified no port-8082 listener remained. Device size 1080×2400, density 420 and font scale 1.0 were unchanged at that stage. No network/permission settings, accounts, purchases or cloud fixtures had been changed. `cleanup.json` records that historical local state. Later isolated native display tests deliberately changed and restored emulator size/font settings.

The Android runtime requirement was subsequently resolved by the isolated offline build. The Apple execution route remains unavailable. Initial failure captures cannot substitute for paywall or transaction evidence.

## Bounded standalone follow-up

The follow-up ran from 23:22:23 to the fixed 23:37:23 UTC deadline. It reused the existing ignored native cache at source `3dbf10278368c2074afa095627b71be21f24aaa3` with the current paid JavaScript/configuration source `b7b59ab366fb0227dd3f035bf7786676c39ba320`. Both existing cached APKs contained the older source and were ineligible unchanged. An ignored Gradle init script redirected the app output into this worktree's `.tmp`, selected current `index.js` and current Expo Constants generation, and configured x86_64, one worker, offline dependency resolution, a `dev=true` fixture bundle and a release native shell. This was a planned Development fixture artifact, never a shipping candidate.

Two short setup failures (Windows command quoting and applying the init script to an included build without an `:app`) were corrected. Gradle then rejected the output directory appearing inside the JavaScript input tree; excluding ignored `.tmp` and `artifacts` inputs resolved that validation. The installed Expo export implementation did not pass the supplied custom-config argument through its active export path, so the next bounded attempt used the existing process-local resolver hook. Shipping configuration, dependency sources and junctions were not edited. The task logged the current source root and `dev=true`, but remained in `createBundleReleaseJsAndAssets` / Metro cache rebuild until the absolute deadline. **Neither an embedded bundle nor an APK was produced. The precise remaining export stall was not established.** The deadline was not extended after retries.

[Final build receipt](payment-qualification/native/standalone-build.json) records timeout/exit 1 and unchanged mobile source hashes. Four earlier failed-attempt receipts retain their timestamps and outcomes. [Attempt summary](payment-qualification/native/standalone-attempt-summary.json) records the diagnostics without claiming a successful package, signature, runtime or fixture render. Raw build logs and isolated scripts remain in ignored local scratch.

The installed debug APK was pulled read-only and its certificate SHA-256 verified as `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. This does not verify an unbuilt replacement. No APK was installed; no package/account data, display setting, process or activity in the emulator was changed during this follow-up. All 17 known build-related process IDs were confirmed absent, and the cached native worktree's tracked files remained clean. [Cleanup receipt](payment-qualification/native/standalone-cleanup.json) records the result; the native build CPU window was released at 23:37:34 UTC.

The historical automatic review rejected the combined force-stop, activity-launch and host-bundle-request command with only `blocked by policy`; it supplied no underlying reason. [The exact rejected command](PAYWALL_VISUAL_QA.md) is preserved. No equivalent restart or replacement of the existing app was attempted. The later independently packaged QA application uses a distinct UID/storage and normal launcher/link taps, leaving the original app intact.

The founder confirmed no Apple test device is currently available and chose to leave the pending Developer Program agreement unaccepted. The confirmed Apple prerequisites remain separate from the working Android fixture runtime. Final Android coverage supersedes the historical untested matrix above.
