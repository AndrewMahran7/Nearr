# Nearr 1.7 final release execution report

Verified on 2026-10-26 against `integration/nearr-global-fieldnotes-monetization`, starting from `d1c500593f1e4c38fe69c287ae6c75141c0eed3a`.

Recovery addendum: [`SESSION_RECOVERY_20261026.md`](./SESSION_RECOVERY_20261026.md) records the clean recovered checkpoint at `8bcd0bdb6fa4973da66ba77672592593511e97c0`, the additional Feedback mojibake correction, live service readbacks, and bounded cold-reopen evidence. It also narrows an earlier catalog claim: all live/canonical keys pass, but German, French, and Italian retain 51 unreferenced legacy duplicate keys apiece containing U+FFFD. Those dead extras require later cleanup before claiming every catalog key is clean.

## A. Overall release status and exact blockers

**HOLD — Nearr 1.7 is not qualified for App Review or public release.** The unified app and Development backend are substantially prepared, and Android runtime QA is complete for the safe paths. Four external gates remain:

1. No recognition provider is contractually qualified for Nearr's intended 13+ audience. Recognition flags remain disabled and no live provider calls were made.
2. The Apple Paid Applications Schedule still requires Account Holder acceptance. This blocks In-App Purchase completion and submission.
3. App Store Connect currently declares “Data Not Collected,” which conflicts with accounts, saved places, location/reminder data, language preference, diagnostics, and future purchase records.
4. The unified Railway Development worker cannot be deployed until a human completes Railway OAuth. Two device-login attempts expired without authorization.

Production, public distribution, recognition, and purchases remain unchanged and disabled.

## B. Account access

| Service | State | Evidence / limitation |
| --- | --- | --- |
| Expo EAS | Authenticated | Account `andrewmahran`; signed internal iOS build is readable. |
| Supabase | Authenticated | Account `mahranandrew@gmail.com`; Development `qnfxnmvxpjzfydgudtvs`, Production `rlqvxdwtetxsqxhqztkw`. |
| Railway | Login expired | Two normal OAuth/device-login windows timed out. No deployment or variable change was made. |
| App Store Connect | Read access | Version 1.5.58 remains Prepare for Submission, with no build selected and manual release enabled. Paid agreement requires Account Holder action. |
| RevenueCat | Required setup not permitted | Existing catalog/webhook does not match the 1.7 proposal; the connected role could not complete the mapping. |

No passwords or secret keys were placed in the repository or report.

## C. Android Studio and emulator installation status

Windows 10 build 26200, Android Studio 2025.3, Android SDK/platform-tools, emulator, and hardware acceleration were available and used successfully. A clean Android Development APK was built and freshly installed as `com.nearr.app`.

## D. Emulator model, Android version, and screenshots

Runtime device: Pixel 8a Google Play AVD, Android 16 / API 36, x86_64, 1080×2400 at density 420, 2048 MB RAM. Default appearance was light with font scale 1.0; dark mode and font scale 1.3 were tested separately and restored.

Evidence is in [`android-emulator/`](./android-emulator/). Key captures include:

- `02-eligibility.png` through `08-after-practice.png`: eligibility and full guided onboarding.
- `10-search-results.png`, `11-real-map.png`, `12-selected-pin.png`: real Development search, map, save, and pin framing.
- `13-place-detail.png` and `14-place-detail-fixed.png`: confirmed apostrophe defect before and after correction.
- `15-reminder-enabled.png`, `16-photo-gallery.png`, `17-activity.png`, `23-place-more.png`, `25-show-all-pins.png`: reminder, gallery, Activity, More, and map controls.
- `18-settings-dark.png`, `19-settings-{de,ja,zh-Hans}.png`, `20-settings-large-font.png`: dark, CJK/European localization, and accessibility text.
- `21-offline-eligibility-recovery.png`, `22-offline-saved-fixed.png`: cold offline eligibility recovery and cached Saved library.

## E. UI defects found and fixed

1. Place detail displayed `you?re`; related error keys used the same corrupt apostrophe. Corrected the affected English keys across all ten catalogs and the add-place/place-detail call sites.
2. Enabling a reminder could spin forever because an Android native foreground-location request never settled. Every notification/location permission read or prompt now has a 10-second boundary. Existing grants are read before opening a new prompt. On the same emulator, the failure path recovered at 10 seconds and the granted path then completed, persisted the reminder, and displayed “Automatic · Change distance.”
3. Authenticated users could not change language after onboarding because `LanguageSelector` was mounted only on the eligibility gate. Settings now exposes it.
4. Settings had English notification descriptions and hybrid accessibility labels in non-English locales. Three missing descriptions were translated in every catalog, and theme buttons now expose their localized label without an English suffix.
5. Offline eligibility recovery routed to nonexistent `/(tabs)/saved`, producing “Unmatched Route.” It now routes to the real map; the cached Saved tab opens Bantam and reports `Offline · 1 place`.

Back navigation, relaunch, gallery close, Activity close, Saved/Map switching, and place-detail close all behaved correctly after the fixes. Nearby sorting presented its permission/failure notice when an emulator location fix was unavailable.

## F. Localization coverage and testing

All ten locales were selected through the repaired Settings control: en-US, es-MX, es-ES, pt-BR, fr, de, it, ja, ko, and zh-Hans. Every selection changed the live Settings interface; persistence is covered by the localization adapter test. German, Japanese, and Simplified Chinese were visually captured in dark mode. Catalog parity is 1,465 keys per locale with no missing keys, placeholder mismatches, or replacement characters.

This is engineering QA, not native-speaker certification. Current 1.7 screenshots exist, but App Store locale-specific screenshot sets still require final product/editorial selection and native-language review.

## G. Recognition-provider qualification and benchmark

No provider was enabled. Existing Gemini terms do not establish a valid 13+ production route, and no other provider arrangement was proven from the connected accounts. The recognition corpus and benchmark harness remain ready, but live comparative calls were deliberately withheld. Exact-place precision, multi-place behavior, latency, cost, and stability therefore have no new qualified-provider result. This remains the highest-priority submission blocker.

## H. Development Railway, Edge, and database status

Development Supabase retains 42 users, 20 saves, and 66 share jobs. Additive migrations and Edge functions are deployed fail closed: `create-share-job` v75, `process-share-link` v88, `process-share-jobs` v144, `plus-api` v1, and `revenuecat-plus-webhook` v1. Recognition and monetization flags remain false.

Railway project `4037a3b5-d66f-409e-b734-56c22c244e3e`, Development environment `57d055b7-5326-4f96-a7a9-70523ee0d3f0`, service `3c8cd190-b118-4ee4-9338-407843ef4e1f`, still points at deployment `69831ef2-7da5-495d-95b4-f1618b2f0b6e`. The unified worker was not deployed because OAuth was not completed.

## I. Monetization products and sandbox results

The code and server policy support the proposed experiment: three free successful finds per UTC month and a $1.99/month Plus candidate with ten successful finds per billing period. RevenueCat still exposes old Pro/token products and its webhook targets the old endpoint. Apple product creation/mapping and sandbox purchase, cancellation, restore, renewal, expiration, refund/revocation, account-switch, multi-device, and offline tests could not be completed. Purchases remain disabled while recognition is unavailable.

## J. Privacy, Terms, and App Privacy readiness

The 13+ Terms/privacy drafts and technical App Privacy matrix are present in this dossier. They cover age/region declarations, provider processing, separate AI permission, location reminders, language preference, accounts, saved places, and purchases. They still require founder/counsel approval, final effective dates, and canonical publication. App Store Connect's published “Data Not Collected” answer must be replaced using `APP_PRIVACY_FINAL_MATRIX.md` before submission.

## K. Production compatibility and rollout status

No Production database, Edge function, Railway worker, OTA update, or client binary was changed. Existing rollout/rollback and legacy-client compatibility plans remain the operating documents. Production backup/restore proof, public 1.4 upgrade QA, and final Development-versus-Production source comparison remain pending until the worker and provider are qualified.

## L. App Store Connect configuration and submission status

Version 1.5.58 is still Prepare for Submission with stale release notes, no selected build, and manual release. No build was uploaded or submitted. Submission is blocked by the recognition provider, paid agreement, App Privacy correction, final legal approval, physical-iPhone QA, and final Production build.

## M. Native builds and runtime IDs

- iOS signed internal Development build: `af64b897-32a0-40f7-a690-c802c1920e39`.
- Version/runtime/build: `1.7.0 / 1.7.0 / 69`.
- Recorded iOS source: `d4138146459f880950dc794d4d983ee70107f769`.
- Android debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, freshly installed and exercised on API 36.

The Android build used generated native Gradle host files; those files remain ignored and are not release source.

## N. Git branch and cleanliness

Work remains on `integration/nearr-global-fieldnotes-monetization`. The starting release dossier commit was `d1c500593f1e4c38fe69c287ae6c75141c0eed3a`. Application/regression changes and release evidence are split into reviewable commits; their exact hashes and pushed HEAD are recorded in the chat handoff.

## O. Tests and physical-iPhone limitations

Final verification passed: the complete `test:prebuild` chain, TypeScript, catalog localization, native localization, place-detail V2, offline mode, 21 monetization policy checks, 28 PostgreSQL monetization cases, 12 PostgreSQL eligibility/security suites covering 60 age/region combinations, 32 privacy-policy checks, consent identity, and recognition consent. The media-worker suite completed with 656 passing, 7 skipped, and 0 failed.

Android runtime QA cannot prove iOS-only Share Extension behavior, Apple purchase sheets, StoreKit sandbox lifecycle, background execution on a physical iPhone, or production push delivery. Those require a physical iPhone and corrected Apple account configuration.

## P. Exact remaining action

The shortest safe path is one founder-controlled completion session: the Account Holder accepts Apple's paid agreement; a contractually valid 13+ recognition-provider arrangement is supplied; Railway OAuth is authorized; the unified Development worker is deployed and benchmarked; RevenueCat/App Store products and sandbox lifecycle are completed; counsel/founder approve and publish the final policies; App Privacy is corrected; then run the physical-iPhone, Production rollout, and final signed Store-build gates. Only after every gate passes should the founder explicitly authorize App Review submission. Public release remains manual.
