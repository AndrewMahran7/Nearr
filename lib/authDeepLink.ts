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
  /** The link was a `type=recovery` password-reset link. */
  isRecovery: boolean;
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

/**
 * Where the URL came from.
 *
 *   - `deep_link`   — an OS URL event (cold or warm start). Subject to the
 *                     duplicate guard, because the OS can deliver the same
 *                     link repeatedly.
 *   - `oauth_result` — the redirect URL handed back by
 *                      `WebBrowser.openAuthSessionAsync`. We are the
 *                      authoritative consumer of that URL, so the guard is
 *                      only used to RECORD the identity (suppressing a
 *                      follow-up OS event) and never to skip the exchange.
 */
export type AuthDeepLinkSource = 'deep_link' | 'oauth_result';

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
 *
 * The same pipeline serves magic link, Google OAuth and password recovery, so
 * every provider establishes its session through exactly one code path.
 */
export async function handleAuthDeepLink(
  url: string,
  options: { source?: AuthDeepLinkSource } = {},
): Promise<AuthDeepLinkResult> {
  const source = options.source ?? 'deep_link';
  const parsed = parseAuthCallbackUrlCore(url);
  console.log(
    `[auth-link] received source=${source} has_code=${parsed.hasCode} has_tokens=${parsed.hasTokens} recovery=${parsed.isRecovery} path=${parsed.safePath}`,
  );

  if (!parsed.matches) {
    return {
      handled: false,
      sessionEstablished: false,
      ignored: true,
      failed: false,
      isRecovery: false,
      reason: 'non_auth_link',
    };
  }

  const isDuplicate = duplicateAuthLinkGuard.shouldIgnore(url, parsed.params);
  if (isDuplicate && source === 'deep_link') {
    console.log('[auth-link] ignored_duplicate=true');
    return {
      handled: false,
      sessionEstablished: false,
      ignored: true,
      failed: false,
      isRecovery: parsed.isRecovery,
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
          isRecovery: parsed.isRecovery,
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
        isRecovery: parsed.isRecovery,
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
          isRecovery: parsed.isRecovery,
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
        isRecovery: parsed.isRecovery,
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
      isRecovery: parsed.isRecovery,
      reason: 'missing_auth_params',
    };
  } catch {
    console.warn('[auth-link] failed reason=unexpected_error');
    return {
      handled: true,
      sessionEstablished: false,
      ignored: false,
      failed: true,
      isRecovery: parsed.isRecovery,
      reason: 'unexpected_error',
    };
  }
}
