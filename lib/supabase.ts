import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { sharedAuth } from './sharedAuth';

// Prefer EXPO_PUBLIC_* (inlined at build time by Expo). Fall back to
// app.json `extra` so we keep working with prebuilt configs.
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

/**
 * True when both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
 * were available at build time. Callers (e.g. sign-in screen) should check
 * this before making any Supabase network call so they can surface a clear
 * "reinstall the build" message instead of a generic network error.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Log loudly but do NOT throw — the app must still boot so the user
  // sees a recoverable error screen rather than a blank crash.
  console.error('[ENV] Missing Supabase config — app features will not work.');
  console.warn(
    '[ENV_VALIDATION_FAILED] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing. ' +
      'Set them in .env (Expo will inline them) or in app.json `extra`.' +
      ' For EAS builds, set them in the Expo dashboard under Environment Variables.',
  );
  console.warn(
    '[ENV_VALIDATION_FAILED] url_present=' + Boolean(supabaseUrl) +
    ' key_present=' + Boolean(supabaseAnonKey),
  );
} else {
  // Log the URL prefix (not a secret) to confirm the right project is loaded.
  // Never log the anon key value — only its presence and length.
  console.log(
    '[ENV_VALIDATION_SUCCESS] Supabase configured' +
    ' url_prefix=' + supabaseUrl.slice(0, 30) +
    ' key_present=true key_length=' + supabaseAnonKey.length,
  );
}

// createClient throws when passed empty strings, which crashes the app at
// module-load time before any UI renders. Pass placeholder strings when the
// real values are absent so the client object is created safely; every API
// call will fail gracefully at runtime rather than on import.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-missing-config.supabase.co',
  supabaseAnonKey || 'placeholder-missing-config',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // We handle the deep-link callback ourselves in app/_layout.tsx because
      // React Native doesn't have a `window.location` for Supabase to read.
      detectSessionInUrl: false,
    },
  },
);

// ---------------------------------------------------------------------------
// Share Extension auth bridge
// ---------------------------------------------------------------------------
//
// On every auth state change (sign-in, refresh, sign-out) push the access
// token into the App Group's shared UserDefaults so the iOS Share
// Extension can read it on launch and call `process-share-link` with a
// valid Bearer token. Refresh token is intentionally NOT shared — only
// the short-lived access token.
//
// Safe no-op on Android, in Expo Go, or before the user runs
// `expo prebuild --clean` (the native module is optional).
//
// Also runs once on import to backfill any session that was restored
// from AsyncStorage at app start.
supabase.auth.onAuthStateChange((event, session) => {
  const token = session?.access_token ?? null;
  if (__DEV__) {
    console.log('[supabase] auth event', event, 'tokenPresent=', !!token);
  }
  sharedAuth.setToken(token);
});

// Backfill the persisted session on cold start.
supabase.auth.getSession().then(({ data }) => {
  const token = data.session?.access_token ?? null;
  if (__DEV__) {
    console.log('[supabase] cold-start session backfill, present=', !!token);
  }
  sharedAuth.setToken(token);
}).catch((err) => {
  console.warn('[supabase] cold-start session backfill failed', err);
});
