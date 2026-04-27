/**
 * withShareExtension — Expo config plugin (SCAFFOLD).
 *
 * STATUS: NOT WIRED INTO app.json BY DEFAULT.
 *
 * What it would do once enabled:
 *   - Add the App Group entitlement (`group.com.nearr.app`) to the host app.
 *   - Create a new iOS target `NearrShareExtension` and copy
 *     `native/share-extension/{ShareViewController.swift, Info.plist,
 *     NearrShareExtension.entitlements}` into the generated ios/ project
 *     during `expo prebuild`.
 *   - Wire the extension target into the Pods/Xcode project so it builds
 *     alongside the host app under EAS.
 *
 * Why it's not enabled yet:
 *   - Adding a second iOS target via a config plugin requires rewriting the
 *     Xcode pbxproj. That's invasive — `@bacons/xcode` (recommended) needs
 *     to be added as a dev dep, and the whole prebuild + EAS pipeline needs
 *     to be tested end-to-end against a real Apple Developer account before
 *     turning this on. Doing that without a working dev build would silently
 *     break `expo run:ios` for everyone.
 *   - Until then, the app falls back to the manual paste-link flow on the
 *     /share screen (Task 11) which works in Expo Go and dev builds today.
 *
 * To enable later:
 *   1. `npm i -D @bacons/xcode` (or `expo-share-extension` from npm).
 *   2. Replace the body of `withShareExtension` below with a real
 *      implementation (see docs/IOS_SHARE_EXTENSION.md for the recipe).
 *   3. In app.json, add this plugin to expo.plugins:
 *        ["./plugins/withShareExtension"]
 *   4. Run `npx expo prebuild --clean` and verify the extension target
 *      appears in ios/Nearr.xcworkspace.
 *   5. Build via EAS (`eas build --platform ios --profile development`).
 *
 * For now this plugin is a no-op that logs a warning so accidental wiring
 * is loud and obvious.
 *
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
function withShareExtension(config) {
  console.warn(
    '[withShareExtension] Scaffold plugin is a no-op. Implement before enabling. ' +
      'See docs/IOS_SHARE_EXTENSION.md.',
  );
  return config;
}

module.exports = withShareExtension;
