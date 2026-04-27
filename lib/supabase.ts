import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

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
