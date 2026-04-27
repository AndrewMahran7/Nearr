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
    },
  };
};
