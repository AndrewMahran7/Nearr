import { supabase } from './supabase';
import {
  createAuthLinkDuplicateGuard,
  parseAuthCallbackUrl as parseAuthCallbackUrlCore,
} from './authDeepLinkCore';

const duplicateAuthLinkGuard = createAuthLinkDuplicateGuard();

export type AuthDeepLinkResult = {
  handled: boolean;
  sessionEstablished: boolean;
  ignored: boolean;
  failed: boolean;
  reason:
    | 'non_auth_link'
    | 'duplicate'
    | 'missing_auth_params'
    | 'set_session_error'
    | 'exchange_code_error'
    | 'session_not_found_after_auth'
    | 'session_established'
    | 'unexpected_error';
};

export function parseAuthCallbackUrl(url: string): {
  matches: boolean;
  params: Record<string, string>;
} {
  const parsed = parseAuthCallbackUrlCore(url);
  return { matches: parsed.matches, params: parsed.params };
}

/**
 * Handle a magic-link deep link. Supports both:
 *   - Implicit flow:  nearr://auth-callback#access_token=...&refresh_token=...
 *   - Triple slash:   nearr:///auth-callback#access_token=...&refresh_token=...
 *   - Expo hosted:    exp://.../--/auth-callback?code=...
 *   - PKCE flow:      nearr://auth-callback?code=...
 */
export async function handleAuthDeepLink(url: string): Promise<AuthDeepLinkResult> {
  const parsed = parseAuthCallbackUrlCore(url);
  console.log(
    `[auth-link] received has_code=${parsed.hasCode} has_tokens=${parsed.hasTokens} path=${parsed.safePath}`,
  );

  if (!parsed.matches) {
    return {
      handled: false,
      sessionEstablished: false,
      ignored: true,
      failed: false,
      reason: 'non_auth_link',
    };
  }

  if (duplicateAuthLinkGuard.shouldIgnore(url, parsed.params)) {
    console.log('[auth-link] ignored_duplicate=true');
    return {
      handled: false,
      sessionEstablished: false,
      ignored: true,
      failed: false,
      reason: 'duplicate',
    };
  }

  try {
    if (parsed.params.access_token && parsed.params.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: parsed.params.access_token,
        refresh_token: parsed.params.refresh_token,
      });
      const success = !error;
      console.log(`[auth-link] set_session success=${success}`);
      if (error) {
        console.warn('[auth-link] failed reason=set_session_error');
        return {
          handled: true,
          sessionEstablished: false,
          ignored: false,
          failed: true,
          reason: 'set_session_error',
        };
      }

      const { data } = await supabase.auth.getSession();
      const sessionEstablished = !!data.session;
      if (!sessionEstablished) {
        console.warn('[auth-link] failed reason=session_not_found_after_auth');
      }
      return {
        handled: true,
        sessionEstablished,
        ignored: false,
        failed: !sessionEstablished,
        reason: sessionEstablished
          ? 'session_established'
          : 'session_not_found_after_auth',
      };
    }

    if (parsed.params.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(parsed.params.code);
      const success = !error;
      console.log(`[auth-link] exchanged_code_for_session success=${success}`);
      if (error) {
        console.warn('[auth-link] failed reason=exchange_code_error');
        return {
          handled: true,
          sessionEstablished: false,
          ignored: false,
          failed: true,
          reason: 'exchange_code_error',
        };
      }

      const { data } = await supabase.auth.getSession();
      const sessionEstablished = !!data.session;
      if (!sessionEstablished) {
        console.warn('[auth-link] failed reason=session_not_found_after_auth');
      }
      return {
        handled: true,
        sessionEstablished,
        ignored: false,
        failed: !sessionEstablished,
        reason: sessionEstablished
          ? 'session_established'
          : 'session_not_found_after_auth',
      };
    }

    console.warn('[auth-link] failed reason=missing_auth_params');
    return {
      handled: true,
      sessionEstablished: false,
      ignored: false,
      failed: true,
      reason: 'missing_auth_params',
    };
  } catch {
    console.warn('[auth-link] failed reason=unexpected_error');
    return {
      handled: true,
      sessionEstablished: false,
      ignored: false,
      failed: true,
      reason: 'unexpected_error',
    };
  }
}
