# Android build and environment

Clean descendant worktree of verified local/remote `c3317f01fa5205ae9bfa6702e11780ba113e4efe`; branch `fix/nearr-17-full-regression-android-qa`. Primary Desktop worktree and earlier integration worktree were preserved.

Existing Pixel_8a AVD, emulator-5554, Android 16/API 36, Google Play x86_64. Existing SDK and Android Studio/JBR reused. No emulator recreation, SDK upgrade or unrelated process termination. Metro owned by this task, localhost:8081 through ADB reverse; restarted after committed JS changes because CI disables watching. Host memory contention was avoided for final native checks.

Version 1.7.0, Android versionCode 1, debug Development client, package com.nearr.app. Final build source/time/hash are in `android-build.json`. APK path: `android/app/build/outputs/apk/debug/app-debug.apk`. Installed base.apk SHA-256 verified as `f08ca746117688cd142cc6a2eca9e2bf0ed260792c0580813dfad5f772c084e4`.

Android Development runtime is now `1.7-onboarding-date-android-v2` because the Expo AV JNI/Java guard changes native code. iOS remains `1.7-onboarding-date-v1`; Production runtime policy is unchanged. The native client hash can remain identical across later JS-only commits: debug JS is served by Metro, not embedded. Both binary receipt and JS/test source are therefore recorded; an APK hash alone is not proof of bundled JS identity.

The existing Windows KAPT/Room workaround uses an explicit writable temp directory under this worktree's ignored android/ folder. No production source change for host tooling. Build uses `node scripts/buildBirthdayAndroid.cjs`, `:app:assembleDebug`, x86_64, two Gradle workers. `npm ci` used the existing lockfile.

Development environment guard: Nearr-Dev Supabase qnfxnmvxpjzfydgudtvs; Expo project 2ec7a08a-2078-4232-a244-c9d16fb75ffe. Production backend, Edge, Railway, privacy publication and payment configuration untouched. No App Store binary/submission.

Native patch: Expo AV 14.0.7 only, persistent patch-package source diff. Splash 0.27.7 patch is JS/TS error-handling compatibility, not another native API change. Both reapply cleanly; no SDK dependency upgrade.
