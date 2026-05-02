import * as Linking from 'expo-linking';
import { supabase } from './supabase';

function extractStringParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isAuthCallbackUrl(parsed: Linking.ParsedURL): boolean {
  const segments = [parsed.hostname ?? '', parsed.path ?? '']
    .flatMap((value) => value.split('/'))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value !== '--');

  return segments.includes('auth-callback');
}

export function parseAuthCallbackUrl(url: string): {
  matches: boolean;
  params: Record<string, string>;
} {
  const parsed = Linking.parse(url);
  const params: Record<string, string> = {};

  Object.entries(parsed.queryParams ?? {}).forEach(([key, value]) => {
    const stringValue = extractStringParam(value);
    if (stringValue != null) {
      params[key] = stringValue;
    }
  });

  const fragmentIndex = url.indexOf('#');
  if (fragmentIndex >= 0) {
    const fragmentParams = new URLSearchParams(url.slice(fragmentIndex + 1));
    fragmentParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return {
    matches: isAuthCallbackUrl(parsed),
    params,
  };
}

/**
 * Handle a magic-link deep link. Supports both:
 *   - Implicit flow:  nearr://auth-callback#access_token=...&refresh_token=...
 *   - Triple slash:   nearr:///auth-callback#access_token=...&refresh_token=...
 *   - Expo hosted:    exp://.../--/auth-callback?code=...
 *   - PKCE flow:      nearr://auth-callback?code=...
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  // Log only the scheme+host+path — never log tokens or codes.
  console.log('[authDeepLink] handling URL', url.replace(/[?#].*$/, ''));

  const { matches, params } = parseAuthCallbackUrl(url);
  console.log('[authDeepLink] callback detected', matches);
  if (!matches) return false;

  console.log(
    '[authDeepLink] params found: hasAccessToken=', !!params.access_token,
    'hasRefreshToken=', !!params.refresh_token,
    'hasCode=', !!params.code,
  );

  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      console.warn('[authDeepLink] setSession fail', error.message);
      return false;
    }
    console.log('[authDeepLink] setSession success');
    const { data: check1 } = await supabase.auth.getSession();
    console.log(
      '[authDeepLink] post-auth: sessionExists=', !!check1.session,
      'userIdExists=', !!check1.session?.user?.id,
    );
    return true;
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      console.warn('[authDeepLink] exchangeCodeForSession fail', error.message);
      return false;
    }
    console.log('[authDeepLink] exchangeCodeForSession success');
    const { data: check2 } = await supabase.auth.getSession();
    console.log(
      '[authDeepLink] post-auth: sessionExists=', !!check2.session,
      'userIdExists=', !!check2.session?.user?.id,
    );
    return true;
  }

  console.warn('[authDeepLink] callback received but no tokens or code found');
  return false;
}
