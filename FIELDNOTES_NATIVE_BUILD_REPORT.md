# Fieldnotes Development native build

## Source and lane

- Worktree: `C:/Users/andre/Desktop/Nearr-worktrees/nearr-1.6-fieldnotes`.
- Branch: `feat/nearr-1.6-fieldnotes`; client baseline `ca08c154347096fe5da0bf2739cf0b25c0b706b0`.
- Expo version: `1.6.59`; runtime policy: `appVersion`, resolving to `1.6.59`.
- EAS profile, channel and environment: `development`; internal distribution, development client.
- Backend: verified Nearr-Dev (`qnfxnmvxpjzfydgudtvs`). No backend deployment.
- Remote iOS build counter read on October 9, 2026 immediately before submission: `58`. The profile incremented it to the EAS-confirmed build `59`.
- Host bundle identifier remains `com.nearr.ios`, with the existing Share Extension target. Installing this internal build can replace an installed app with that identifier; no bundle-ID or account routing change was introduced.

## Build status

EAS build **74a22771-5998-485b-ac16-f316caf7491d** **FINISHED successfully** on October 9, 2026 at 21:23:34 UTC (submitted 21:17:38 UTC). [Install / build page](https://expo.dev/accounts/andrewmahran/projects/nearr/builds/74a22771-5998-485b-ac16-f316caf7491d).

| Field | EAS-recorded value |
|---|---|
| Version / build / runtime | `1.6.59` / `59` / `1.6.59` |
| Source SHA | `bb2a705ceda39f0938d2a90eca88952828ba614d` |
| Profile / channel / environment | `development` / `development` / `development` |
| Distribution | Internal, development client |
| Credentials | Existing host and Share Extension ad-hoc profiles reused; all registered devices included |

The [IPA](https://expo.dev/artifacts/eas/8w0YOJ_gXHejc0zhlvihhjNU7oOas6Vv__uIwoa_Tpw.ipa) was downloaded and inspected. SHA-256: `c8aba16fb9ccaf2b9b61b1a5a2b6dce6bcc2460771704b202fea6b374228c910`. Host Info.plist confirms `1.6.59` / `59`, runtime `1.6.59`, Automatic appearance and the primary AppIcon catalog. The real compiled 120px and 152px launcher PNGs were decoded and match the Fieldnotes source silhouette/palette (mean channel difference below 1/255 against standard source resizing). They are opaque.

`NearrShareExtension.appex` contains its own 4,092,398-byte `main.jsbundle` and canonical icon, the share-services controller and existing App Group. Its marketing version is `1.6.59`; the existing plugin emits extension `CFBundleVersion=1`, distinct from host build `59`. This is accurately recorded, not silently normalized. No new Apple-account sign-in or provisioning change was needed. See `APP_ICON_BUILD_VERIFICATION.md` and its sanitized machine-readable proof for exact comparisons and catalog-only rendition limitations.

Required command: `npm run dev:build -- --yes`. It verifies the EAS Development environment before invoking the fixed iOS Development profile. The new icon, SDK51-compatible haptics/gradient modules and native Share Extension require this binary; OTA alone cannot deliver them.

## Initial Development update

`npm run dev:update -- --platform ios -m "Nearr 1.6 Fieldnotes native QA" --non-interactive` completed successfully after verifying Development app/backend identity.

| Field | Published value |
|---|---|
| Channel / branch / environment | `development` / `development` / `development` |
| Platform / runtime | iOS / `1.6.59` |
| Group | `7cc8e190-b2a1-42e6-905a-0a6de9691ae2` |
| iOS update | `01a12295-3756-7d49-9bb4-16273313f49c` |
| Product source SHA | `4dd5aa7461ae55fd870f959033bdd63a03af34fb` |

[Development update page](https://expo.dev/accounts/andrewmahran/projects/nearr/updates/7cc8e190-b2a1-42e6-905a-0a6de9691ae2). Export: 1,823 modules, 4.22 MB Hermes bundle and 43 iOS assets; one asset uploaded, 42 reused. These are export sizes, not resident-memory measurements. EAS marks the commit with an asterisk because QA evidence files were being written; all product code was committed and pushed. Later commits contain evidence/reports only.

The update carries the JS-only native-QA corrections after binary compilation: compact no-photo Saved lead, corrected detail separator, simpler welcome hierarchy, text-aware map peek, content-preserving review refresh, aligned evidence fallback and single-place Save gradient. Native modules, icon/config and extension source remain those compiled in build 59. The extension keeps its embedded bundle and does not consume host OTA code.

Install the new native build, open the Development app, allow its Development update to load, then force-quit and reopen per the repository workflow. Sign in to Nearr-Dev in the host before testing the Share Extension. Run `NEARR_1_6_FOUNDER_QA.md`; do not use an older 1.5 binary to judge this runtime.

## Verification boundaries

The full prebuild command set passed 132 commands, zero failures. Final integrated TypeScript passed, and focused review/detail/Saved/onboarding/map/motion/image-failure checks passed after subsequent refinements. Detailed results are in `artifacts/fieldnotes-implementation/validation/` and the phase evidence files.

Android debug compilation succeeded with the existing Java 17 toolchain. Android captures are supporting native evidence, not iOS screenshots. No connected iPhone or Mac simulator is available on this Windows workstation; iOS visual layout, VoiceOver, physical haptics and actual social-host extension use require the founder checklist.

No Production build release, Production OTA, backend deployment, App Store submission, protected-branch merge, recognition/model change or monetization change is authorized or performed by this work.
