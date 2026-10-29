# iOS candidate verification

**No Store-distribution candidate has been built or submitted.** Production recognition, store transaction and legal/disclosure qualification remain incomplete; the production build guard has not been bypassed.

EAS readback at 2026-10-29 21:42:49 UTC confirms that internal Development **1.7.0 (73)** finished successfully at 21:41:50 UTC. Build ID: `da13c7d7-b11d-4497-8862-615af269ec76`. EAS reports source commit `b5d6e1ae56411e79f1ca448955ee73154b95b10f`, profile `development`, and distribution `INTERNAL`. This supersedes the historical internal build 72 for this integration; it is not a Store-distribution build.

The 51,543,424-byte IPA was downloaded to ignored local scratch storage and inspected without installing it. SHA-256: `488562adbda249b4a561ed3973cae2ac3bf677faab4af2ce7850588ad02850fc`. The archive CRC check passed. `scripts/inspectOnboardingIpa.py` passed with expected build 73 and generated `ios-development-ipa-verification.json`; `ios-development-build-status.json` records the sanitized build readback and inspection outcome. Signed artifact URLs, raw build logs, provisioning files and device identifiers are not included in these evidence files.

Inspection of the actual archive confirmed:

- Host `com.nearr.ios` and extension `com.nearr.ios.ShareExtension` both contain version 1.7.0 and build 73.
- Both contain all ten native locale resource directories: en-US, es-MX, es-ES, pt-BR, fr, de, it, ja, ko and zh-Hans. Resource presence is not a visual or translation-quality audit.
- Both embedded app configurations specify `appEnv=development`, `backendEnv=development`, and Nearr-Dev at `https://qnfxnmvxpjzfydgudtvs.supabase.co`.
- Both embedded provisioning profiles grant `group.com.nearr.ios`; the embedded extension configuration names the same group. This checks profile/configuration metadata, not the executable's signed entitlements.
- The host Expo configuration uses runtime `1.7-onboarding-date-v1` and channel `development`. The extension has no separate Expo.plist; no separate extension update-runtime claim is made.
- Both targets contain CodeResources and compiled date-picker symbols. The host includes its AppIcon resource and Assets.car.

**This Development client does not qualify standalone host behavior.** The host has no application `main.jsbundle`; its bundled JavaScript is the development launcher at `EXDevLauncher.bundle/main.jsbundle`. The Share Extension does contain its own `main.jsbundle`. A successful native build and these packaging checks do not demonstrate that the host launches the paid implementation without Metro or a separately loaded update.

Windows inspection cannot establish macOS codesign trust or physical iOS behavior. No physical installation, standalone host launch, VoiceOver/font-scale audit, public-build-55 upgrade, StoreKit sandbox transaction matrix or final Store signing claim is recorded. No new Store build, upload, submission, release or purchase activation occurred during this inspection.
