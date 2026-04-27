import * as Linking from 'expo-linking';
import { supabase } from './supabase';

/**
 * Handle a magic-link deep link. Supports both:
 *   - Implicit flow:  nearr://auth-callback#access_token=...&refresh_token=...
 *   - PKCE flow:      nearr://auth-callback?code=...
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  if (!url.includes('auth-callback')) return false;
  console.log('[auth] handling magic-link callback');

  const parsed = Linking.parse(url);
  const params = (parsed.queryParams ?? {}) as Record<string, string>;

  // Fragment params (#access_token=...) end up after the path; expo-linking
  // doesn't parse fragments, so do it manually.
  const fragmentIndex = url.indexOf('#');
  if (fragmentIndex >= 0) {
    const frag = new URLSearchParams(url.slice(fragmentIndex + 1));
    frag.forEach((v, k) => (params[k] = v));
  }

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      console.warn('[auth] setSession failed', error);
      return false;
    }
    return true;
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      console.warn('[auth] exchangeCodeForSession failed', error);
      return false;
    }
    return true;
  }

  console.warn('[auth] callback received but no tokens or code found');
  return false;
}
