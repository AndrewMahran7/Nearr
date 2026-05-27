// Dynamic Expo config. Reads native API keys + Supabase config from env so
// nothing sensitive is committed to app.json. See .env.example for the full
// list of variables.
//
// Loading order (Expo handles this automatically for `EXPO_PUBLIC_*`, but we
// also need plain `GOOGLE_MAPS_*` for the native config blocks):
//   .env.local > .env > process.env
//
// If you add new keys, document them in .env.example.

const GOOGLE_MAPS_IOS_KEY =
  process.env.GOOGLE_MAPS_IOS_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const GOOGLE_MAPS_ANDROID_KEY =
  process.env.GOOGLE_MAPS_ANDROID_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

// NOTE(ios-share-extension): Re-enabled in app.json after the first
// TestFlight build shipped as a single-target app. Before submitting a
// build that includes the extension, make sure:
//   1. App Group `group.com.nearr.ios` exists in the Apple Developer
//      portal and is attached to BOTH `com.nearr.ios` and
//      `com.nearr.ios.ShareExtension`.
//   2. EAS has provisioning profiles for BOTH bundle IDs
//      (`eas credentials` → iOS → add the extension bundle ID).
//   3. A dev build (`eas build --profile development --platform ios`) on
//      a real device successfully receives a shared URL.
// If App Store Connect upload fails again with a multi-target error,
// remove the `expo-share-extension` plugin entry from app.json to revert
// to a single-target build while you debug provisioning.

module.exports = ({ config }) => {
  return {
    ...config,
    ios: {
      ...config.ios,
      config: {
        ...(config.ios && config.ios.config),
        googleMapsApiKey: GOOGLE_MAPS_IOS_KEY,
      },
    },
    android: {
      ...config.android,
      config: {
        ...(config.android && config.android.config),
        googleMaps: {
          ...(config.android &&
            config.android.config &&
            config.android.config.googleMaps),
          apiKey: GOOGLE_MAPS_ANDROID_KEY,
        },
      },
    },
    extra: {
      ...config.extra,
      // Expose to runtime via Constants.expoConfig.extra.* as a fallback for
      // code paths that don't read process.env directly.
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      googlePlacesKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
      // 2026-05-26: surface PROCESS_SHARE_LINK_URL in extra too. The iOS
      // share extension and lib/shareExtractionBackend.ts both fall back
      // to Constants.expoConfig.extra.processShareLinkUrl when the env
      // var was not inlined at build time (EAS builds without
      // `eas env:create EXPO_PUBLIC_PROCESS_SHARE_LINK_URL ...`).
      processShareLinkUrl: process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL || '',
    },
  };
};
