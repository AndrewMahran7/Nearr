import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { DEMO_USER, isDemoMode } from '@/lib/demoMode';
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

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [devEnabled, setDevEnabled] = useState<boolean>(isDevAuthEnabled());

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
    console.log('[AUTH_INIT_START] loading session');
    Promise.all([supabase.auth.getSession(), loadDevAuth()]).then(
      ([{ data }, dev]) => {
        if (!mounted) return;
        console.log('[AUTH_INIT_SUCCESS] session present=', !!data.session);
        setSession(data.session);
        setDevEnabled(dev);
        setLoading(false);
      },
    ).catch((err) => {
      if (!mounted) return;
      console.error('[AUTH_INIT_FAIL]', err instanceof Error ? err.message : err);
      // Fail safe: treat as signed-out so AuthGate can route to sign-in.
      setSession(null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.log('[useAuth] onAuthStateChange', event, 'hasSession=', !!s);
      setSession(s);
    });
    const unsubDev = subscribeDevAuth(setDevEnabled);
    return () => {
      mounted = false;
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
  if (__DEV__) {
    console.log('[useAuth] state', {
      realSessionExists: !!session,
      demoMode: demo,
      mapPreviewMode: 'screen-scoped (does not affect auth)',
      localUiAllowed: ALLOW_LOCAL_UI_MODE,
      localUiEnabled: devEnabled,
      finalAuthState: effectiveSession ? 'authenticated' : 'unauthenticated',
    });
  }


  return {
    session: effectiveSession,
    loading,
    user: effectiveSession?.user ?? null,
    isDevSession,
    // True only when the legacy fake-local "Local UI Mode" is active.
    isLocalUiSession: localUiActive,
    isDemoSession: demo,
    // Map Preview Mode is screen-scoped and never produces an auth session.
    // Kept on the return type for backward compat; always ``false`` here.
    isMapPreviewSession: false,
  };
}
