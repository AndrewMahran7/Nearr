# Development handoff

Product source `4c424d9`; final test/native-build source `44c58209ba93ff1a49d3e8c96b4bc2430db96145`. Published source and evidence commit `d07b5d53ee1232fccbdf549471a1d495f78736a5`; branch `fix/nearr-17-full-regression-android-qa`, descendant of verified integration c3317f0. Branch pushed and remote SHA verified. No main merge. The subsequent delivery-receipt commit changes documentation/JSON only.

Android requires the new Development binary/runtime `1.7-onboarding-date-android-v2` for the native AV fix. An OTA cannot install that native change. Local debug x86_64 APK is provided with build/installed hash evidence. iOS JS changes remain compatible with existing Development build 3d96cf71-c507-449e-af77-3bfd7fd57f38, version 1.7.0/build 72/runtime `1.7-onboarding-date-v1`; physical iPhone QA is deferred, not passed.

Only the guarded Development update wrapper is authorized: explicit channel development and environment development, with environment validation before publication. Served manifests must match platform runtime and Nearr-Dev backend. No Production publication, infrastructure mutation, payments or recognition enablement.

## Published and served

One `npm run dev:update -- -m "Nearr 1.7 Android qualification and recovery fixes" --platform all --non-interactive` operation succeeded. EAS produced two groups because the platform runtimes differ:

| Platform | Runtime | Group | Update |
| --- | --- | --- | --- |
| iOS | 1.7-onboarding-date-v1 | bb441c67-f03d-4999-8778-559b5dd16de5 | 01a17f67-a364-7243-b43b-437f1fa694c4 |
| Android | 1.7-onboarding-date-android-v2 | 1111dd6f-affb-4f7c-8229-d4a53a7afb3b | 01a17f67-a364-7903-834c-df917d973e04 |

Both actual served manifests verified: channel development, expected update ID/runtime, appEnv/backendEnv development, Supabase qnfxnmvxpjzfydgudtvs, launch asset present. See `served-update-ios.json` and `served-update-android.json`. Replaces the prior iOS Development group 9b1887fc-7ba8-4a08-8893-e0c67420f3b7 for its runtime. Old Android v1 binaries cannot receive the v2 native fix.

Final local Android debug build succeeded 2026-10-27T22:03:49.823Z, 1m37s, 825 Gradle tasks. Build and installed base.apk hash both `f08ca746117688cd142cc6a2eca9e2bf0ed260792c0580813dfad5f772c084e4`. This is an x86_64 Development client requiring Metro for direct debug execution; it is not a standalone release-mode certification. The release signing configuration was inspected but no standalone release APK or Production binary was created.

Test-owned Development identity, jobs/provenance and saved rows cleaned up; zero owned saves remain. Local data cleared only for the fresh test-owned com.nearr.app installation. Emulator display restored. Task-owned Metro and build daemon stopped; unrelated founder processes/worktrees preserved.

Acceptance boundary: automated matrix green and extensive real Android flows verified. Runtime evidence retains a notification-broadcast ANR under host resource pressure, not reproduced in isolated configuration tests. Do not promote this evidence to public-release qualification without the remaining platform/release checks. Recognition provider/legal/consent qualification remains disabled; this task neither supplies an agreement nor overrides that decision. Sales remain disabled; no sandbox/live purchase success claimed.
