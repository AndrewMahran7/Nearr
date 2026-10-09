# Fieldnotes Development native build

## Source and lane

- Worktree: `C:/Users/andre/Desktop/Nearr-worktrees/nearr-1.6-fieldnotes`.
- Branch: `feat/nearr-1.6-fieldnotes`; client baseline `ca08c154347096fe5da0bf2739cf0b25c0b706b0`.
- Expo version: `1.6.59`; runtime policy: `appVersion`, resolving to `1.6.59`.
- EAS profile, channel and environment: `development`; internal distribution, development client.
- Backend: verified Nearr-Dev (`qnfxnmvxpjzfydgudtvs`). No backend deployment.
- Remote iOS build counter read on October 9, 2026 immediately before submission: `58`. The profile owns automatic increment; the resulting build number will be recorded from EAS.
- Host bundle identifier remains `com.nearr.ios`, with the existing Share Extension target. Installing this internal build can replace an installed app with that identifier; no bundle-ID or account routing change was introduced.

## Build status

EAS build **74a22771-5998-485b-ac16-f316caf7491d** was submitted October 9, 2026 at 21:17:38 UTC and is compiling. [Build page](https://expo.dev/accounts/andrewmahran/projects/nearr/builds/74a22771-5998-485b-ac16-f316caf7491d).

| Field | EAS-recorded value |
|---|---|
| Version / build / runtime | `1.6.59` / `59` / `1.6.59` |
| Source SHA | `bb2a705ceda39f0938d2a90eca88952828ba614d` |
| Profile / channel / environment | `development` / `development` / `development` |
| Distribution | Internal, development client |
| Credentials | Existing host and Share Extension ad-hoc profiles reused; all registered devices included |

Compilation, downloadable binary and IPA inspection remain pending at this checkpoint. No new Apple-account sign-in or provisioning change was needed.

Required command: `npm run dev:build -- --yes`. It verifies the EAS Development environment before invoking the fixed iOS Development profile. The new icon, SDK51-compatible haptics/gradient modules and native Share Extension require this binary; OTA alone cannot deliver them.

The project uses an app-version runtime and a Development update channel. After the native build, an initial iOS-only Development update will be published through `npm run dev:update -- --platform ios -m "Nearr 1.6 Fieldnotes"`; its group and update IDs will be recorded here. The extension keeps its embedded bundle and does not consume host OTA code.

## Verification boundaries

The full prebuild command set passed 132 commands, zero failures. Focused checks cover subsequent motion/native-capture refinements. Detailed results are in `artifacts/fieldnotes-implementation/validation/`.

Android debug compilation succeeded with the existing Java 17 toolchain. Android captures are supporting native evidence, not iOS screenshots. No connected iPhone or Mac simulator is available on this Windows workstation; iOS visual layout, VoiceOver, physical haptics and actual social-host extension use require the founder checklist.

No Production build release, Production OTA, backend deployment, App Store submission, protected-branch merge, recognition/model change or monetization change is authorized or performed by this work.
