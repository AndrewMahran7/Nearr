# Native/runtime reconciliation

| Setting | Decision |
| --- | --- |
| Development runtime, iOS and Android | `1.7-onboarding-date-v1` |
| Non-Development runtime | Existing `{ "policy": "appVersion" }` preserved; version `1.7.0` |
| iOS version/build | `1.7.0` / `72`; one source: `app.json` |
| EAS version source | `local`; Development auto-increment disabled |
| Android package/version code | `com.nearr.app`; existing default versionCode 1 unchanged |
| Date picker | `@react-native-community/datetimepicker` 8.0.1, matching installed Expo 51 |
| Host/extension | `com.nearr.ios` / `com.nearr.ios.ShareExtension` |
| Shared app group | `group.com.nearr.ios` |
| Project | `2ec7a08a-2078-4232-a244-c9d16fb75ffe` / `@andrewmahran/nearr` |
| EAS profile | `development`: developmentClient, internal distribution, development channel/environment |
| iOS image | Existing `macos-sonoma-14.5-xcode-15.4` preserved |

The feature's Development-only build-number override was removed from `app.config.js`. The localization plugin receives `mod.ios.buildNumber` and stamps the extension, so both derive from app.json. Changing the repository build number does not deploy or mutate Production.

Build 69 used runtime 1.7.0 and does not contain the new native dependency. Build 70 completed and proved native packaging. Subsequent Android QA found inherited localization gaps; builds 71 and 72 supersede that candidate, with 72 containing all final application fixes. Do not install 70/71 as the final qualification candidate.

The runtime label is not Android-specific; update compatibility is also partitioned by platform. It is deliberately limited to Development. A new native build must be installed; never send this JS to old runtime 1.7.0 or 1.6.59. No Production OTA is authorized. See [Expo runtime-version documentation](https://docs.expo.dev/eas-update/runtime-versions/).

Host + extension locale resource generation passed (10 locales, 40 string files, two target-scoped resource groups, idempotence). Windows cannot locally run iOS prebuild or codesign; EAS performs native generation and signing on macOS. IPA inspection verifies actual bundled outputs, not just plugin source.

Fieldnotes icon unchanged from unified baseline. Source `assets/icon.png` SHA-256: `AC3ED31CF494843C72C5049E480E77F2AF2FC74DCC8B9A85CE636ABA0CC2DB2A`. App icon entries and compiled Assets.car are checked in the IPA; binary assets cannot be equated byte-for-byte with the source PNG after Apple's compilation.
