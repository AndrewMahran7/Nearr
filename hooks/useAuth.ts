import { useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  rememberAuthenticatedUser,
  resolveOfflineIdentity,
} from '@/lib/offlineIdentity';
import { DEMO_USER, isDemoMode } from '@/lib/demoMode';
import { logDebug, logError } from '@/lib/logger';
import {
  DEV_USER,
  isDevAuthEnabled,
  loadDevAuth,
  subscribeDevAuth,
} from '@/lib/devAuth';

/**
 * Compile-time gate for the legacy fake-local Local UI Mode.
 *
 * Set to ``true`` only if you explicitly want to test offline UI flows
 * with no Supabase session. When ``false`` (the default), signing out
 * always returns the user to the sign-in screen — the persisted
 * ``nearr.devAuthEnabled`` flag is ignored AND cleared on startup
 * (see ``loadDevAuth`` in ``lib/devAuth.ts``).
 *
 * Production builds force this to false regardless via the ``__DEV__``
 * check at every read site.
 */
const ALLOW_LOCAL_UI_MODE = false;

/**
 * Build a fake `Session` for dev-mode use. Cast through `unknown` because
 * we deliberately do NOT have real JWTs — any code that tries to use
 * `access_token` against Supabase will (correctly) fail RLS.
 *
 * The same shape is used for both Dev Mode (manual opt-in via the sign-in
 * button) and Demo Mode (auto-enabled by `EXPO_PUBLIC_DEMO_MODE`). The
 * `id` / `email` differ so downstream code can distinguish the two if
 * needed.
 */
function makeFakeSession(id: string, email: string): Session {
  const user = {
    id,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(0).toISOString(),
  } as unknown as User;
  return {
    access_token: 'dev-mode-no-token',
    refresh_token: 'dev-mode-no-token',
    expires_in: 0,
    expires_at: 0,
    token_type: 'bearer',
    user,
  } as unknown as Session;
}

/**
 * Build a read-only offline session for a previously authenticated user.
 *
 * Deliberately carries NO usable access token: this session unlocks the
 * user-scoped local cache and nothing else. Any Supabase call made with it
 * fails at the network or at RLS, so there is no privilege to escalate.
 */
function makeOfflineSession(userId: string): Session {
  const user = {
    id: userId,
    email: null,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(0).toISOString(),
  } as unknown as User;
  return {
    access_token: 'offline-no-token',
    refresh_token: 'offline-no-token',
    expires_in: 0,
    expires_at: 0,
    token_type: 'bearer',
    user,
  } as unknown as Session;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [devEnabled, setDevEnabled] = useState<boolean>(isDevAuthEnabled());
  // True when `session` is the read-only offline reconstruction rather than a
  // real server-issued session. Screens use this to stay read-only.
  const [offlineAuth, setOfflineAuth] = useState(false);
  // Mirror of `offlineAuth` readable from the auth-state-change closure, which
  // is registered once and would otherwise capture the initial `false`.
  const offlineAuthRef = useRef(false);
  offlineAuthRef.current = offlineAuth;

  // Demo Mode is decided once per process from `EXPO_PUBLIC_DEMO_MODE`.
  // Demo Mode is the ONLY mode that bypasses auth (intentional, UX-only).
  // Map Preview Mode is NOT considered here — it only affects the map
  // screen, never useAuth or AuthGate.
  const demo = isDemoMode();

  useEffect(() => {
    let mounted = true;
    if (demo) {
      // Skip Supabase entirely. There is no real session in Demo Mode.
      setLoading(false);
      return () => {
        mounted = false;
      };
    }
    logDebug('useAuth', 'AUTH_INIT_START loading session');
    // Safety timeout: if Supabase getSession() never resolves (rare network
    // edge case where the JS promise hangs because the underlying fetch
    // never settles) we still want to clear `loading` so AuthGate can
    // route the user to the sign-in screen instead of leaving them on a
    // blank Home / loading view forever. 8s is well past a normal cold
    // start; anything beyond it is effectively offline.
    const AUTH_INIT_TIMEOUT_MS = 8000;
    const timeout = setTimeout(() => {
      if (!mounted) return;
      logError('useAuth', 'AUTH_INIT_TIMEOUT — forcing signed-out state', {
        timeoutMs: AUTH_INIT_TIMEOUT_MS,
      });
      console.warn('[onboarding] stuck_state_recovered auth_init_timeout');
      setSession(null);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);
    Promise.all([supabase.auth.getSession(), loadDevAuth()]).then(
      async ([{ data, error }, dev]) => {
        if (!mounted) return;
        clearTimeout(timeout);
        logDebug('useAuth', 'AUTH_INIT_SUCCESS', { hasSession: !!data.session });
        if (data.session) {
          // A real session. Remember who it is so a later offline cold start
          // can still open their cache.
          if (data.session.user?.is_anonymous !== true) {
            void rememberAuthenticatedUser(data.session.user?.id);
          }
          setSession(data.session);
          setOfflineAuth(false);
        } else {
          // No session. Distinguish "the auth server said no" (sign out) from
          // "we could not reach the auth server" (offline read-only).
          const decision = await resolveOfflineIdentity({ hasSession: false, error });
          if (!mounted) return;
          if (decision.kind === 'offline_readonly') {
            logDebug('useAuth', 'AUTH_INIT_OFFLINE_READONLY');
            console.log('[offline] auth_offline_readonly');
            setSession(makeOfflineSession(decision.userId));
            setOfflineAuth(true);
          } else {
            setSession(null);
            setOfflineAuth(false);
          }
        }
        setDevEnabled(dev);
        setLoading(false);
      },
    ).catch(async (err) => {
      if (!mounted) return;
      clearTimeout(timeout);
      logError('useAuth', 'AUTH_INIT_FAIL', err instanceof Error ? err.message : err);
      // A thrown restore is the same condition as a returned error: fall back
      // to read-only offline access only when it was a network failure.
      const decision = await resolveOfflineIdentity({ hasSession: false, error: err });
      if (!mounted) return;
      if (decision.kind === 'offline_readonly') {
        setSession(makeOfflineSession(decision.userId));
        setOfflineAuth(true);
      } else {
        setSession(null);
        setOfflineAuth(false);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      logDebug('useAuth', 'onAuthStateChange', { event, hasSession: !!s });
      if (s) {
        // Connectivity returned and the token refreshed: the real session
        // replaces any offline reconstruction.
        if (s.user?.is_anonymous !== true) {
          void rememberAuthenticatedUser(s.user?.id);
        }
        setSession(s);
        setOfflineAuth(false);
        return;
      }
      // A tokenless event. SIGNED_OUT is authoritative and must drop the
      // offline session too; other tokenless events (e.g. a late
      // INITIAL_SESSION) must not evict a valid offline reconstruction.
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setOfflineAuth(false);
        return;
      }
      setSession((prev) => (offlineAuthRef.current ? prev : s));
    });
    const unsubDev = subscribeDevAuth(setDevEnabled);
    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
      unsubDev();
    };
  }, [demo]);

  // Real Supabase session always wins. Local UI Mode fallback is gated on
  // both ``__DEV__`` and the compile-time ``ALLOW_LOCAL_UI_MODE`` constant.
  // Map Preview Mode does NOT produce a fake session — the user must be
  // signed in for real, and the map screen consults ``isMapPreviewMode()``
  // independently to swap its data source.
  const localUiActive =
    !session && devEnabled && __DEV__ && ALLOW_LOCAL_UI_MODE;
  const isDevSession = !session && (demo || localUiActive);
  const effectiveSession =
    session ??
    (demo
      ? makeFakeSession(DEMO_USER.id, DEMO_USER.email)
      : localUiActive
      ? makeFakeSession(DEV_USER.id, DEV_USER.email)
      : null);

  // ---- DEBUG: auth state trace ----------------------------------------
  // Temporarily verbose so we can confirm sign-out routes back to sign-in
  // and that demo / map-preview / local-UI flags do NOT silently log the
  // user back in. Safe to remove once verified in QA.
  logDebug('useAuth', 'state', {
    realSessionExists: !!session,
    demoMode: demo,
    mapPreviewMode: 'screen-scoped (does not affect auth)',
    localUiAllowed: ALLOW_LOCAL_UI_MODE,
    localUiEnabled: devEnabled,
    finalAuthState: effectiveSession ? 'authenticated' : 'unauthenticated',
  });


  return {
    session: effectiveSession,
    loading,
    user: effectiveSession?.user ?? null,
    isDevSession,
    /**
     * True when the session is the read-only offline reconstruction of a
     * previously authenticated user. Screens must treat this as "signed in
     * but cannot write" — never as a normal session.
     */
    isOfflineSession: offlineAuth,
    // True only when the legacy fake-local "Local UI Mode" is active.
    isLocalUiSession: localUiActive,
    isDemoSession: demo,
    // Map Preview Mode is screen-scoped and never produces an auth session.
    // Kept on the return type for backward compat; always ``false`` here.
    isMapPreviewSession: false,
  };
}
