// Root entry for the host app. Required by `expo-share-extension` so the
// app and the share extension can have separate Metro entry points
// (`index.js` for the app, `index.share.js` for the extension).
//
// Register the native splash hold once for this JS runtime before Expo Router
// schedules its own internal fallback. Root layout owns the matching hide.
import './lib/splashLifecycle';

// expo-router's own entry handles app registration.
import 'expo-router/entry';
