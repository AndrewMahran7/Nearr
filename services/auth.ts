import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';

export async function sendMagicLink(email: string) {
  // Linking.createURL builds the right scheme for prod (`nearr://`)
  // and Expo Go dev (`exp://...`). Add both to Supabase redirect allow-list.
  const redirectTo = Linking.createURL('auth-callback');
  console.log('[auth] magic link redirect →', redirectTo);
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo },
  });
}

/**
 * Dev-only password sign-in for the dedicated test user.
 *
 * The caller (sign-in screen) is responsible for gating this on
 * ``__DEV__`` and for restricting the email allow-list. This function
 * intentionally does NOT enforce those checks itself so it stays a
 * thin wrapper over Supabase — but it must never be exposed in a
 * production build path.
 *
 * Returns Supabase's native ``{ data, error }`` shape unchanged so
 * callers can surface ``error.message`` directly.
 */
export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}
