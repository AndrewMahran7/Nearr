# Android AV reload crash

Actual emulator failure before repair: `native-crash-excerpt.txt`, AndroidRuntime fatal `NullPointerException` in `expo.modules.av.AVManager.installJSIBindings`, on the JS queue during Development-client reload. The installed initial APK was SHA-256 `a7d5b1151255bbe3c85208426aab8f22f972a1fb105e413234343eb3bcb27e48`.

Expo's upstream repair is [PR 31464](https://github.com/expo/expo/pull/31464). This candidate backports its missing-invoker checks and Java exception boundary into the locked Expo AV 14.0.7; it does not upgrade the Expo SDK. The upstream diff's accidentally inverted runtime-pointer condition is **not** copied: zero returns early and a valid nonzero runtime can install bindings. Registry/provider absence is also handled during teardown. The native hybrid is checked before dereference. Normal audio/video implementations are unchanged.

`patches/expo-av+14.0.7.patch` contains only the two Android source files; generated native build outputs are excluded. `patch-package --error-on-fail` succeeds. The native-contract suite requires each guard and the persistent patch. This source regression coverage is not a substitute for emulator reload and media checks.

This is a native change. Android Development runtime is `1.7-onboarding-date-android-v2`, while iOS retains `1.7-onboarding-date-v1` for signed build 72. [Expo runtime-version guidance](https://docs.expo.dev/eas-update/runtime-versions/) requires a new binary for native changes and permits platform overrides. Production runtime policy is unchanged; no Production build/update is made.

The earlier Back-to-launcher observation occurred around reload. A subsequent stable launch correctly handled hardware Back from Birthday to Language. Final rebuilt-client results belong in ANDROID_EMULATOR_QA.md; do not infer a pass from this source repair alone.
