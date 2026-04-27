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

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud, not silent. App still boots so dev can see the sign-in screen error.
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in .env (Expo will inline them) or in app.json `extra`.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // We handle the deep-link callback ourselves in app/_layout.tsx because
    // React Native doesn't have a `window.location` for Supabase to read.
    detectSessionInUrl: false,
  },
});

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
