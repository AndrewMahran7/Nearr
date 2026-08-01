import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { sharedAuth } from './sharedAuth';
import {
  initialSharedAuthSyncState,
  reduceSharedTokenWrite,
  type SharedAuthTrigger,
} from './sharedAuthSync';

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
// Extension can read it on launch and call `create-share-job` with a
// valid Bearer token. Refresh token is intentionally NOT shared — only
// the short-lived access token.
//
// ORDERING SAFETY: writes go through the PURE reduceSharedTokenWrite reducer
// (lib/sharedAuthSync.ts) with a single module-scoped state so a late/stale/
// out-of-order tokenless INITIAL_SESSION can NEVER clear a valid token that the
// cold-start restore already wrote. Only an explicit SIGNED_OUT clears it. This
// fixes the extension seeing `initialized=true` but `token=absent`
// ("Open Nearr to sign in") while the host app is actually signed in.
//
// Safe no-op on Android, in Expo Go, or before the native module is linked.

let sharedAuthSyncState = initialSharedAuthSyncState();

function syncSharedToken(trigger: SharedAuthTrigger, token: string | null): void {
  const sessionHasToken = typeof token === 'string' && token.length > 0;
  const { action, next } = reduceSharedTokenWrite(sharedAuthSyncState, {
    trigger,
    sessionHasToken,
  });
  sharedAuthSyncState = next;
  if (action === 'write') {
    sharedAuth.setToken(token);
  } else if (action === 'clear') {
    sharedAuth.setToken(null);
  }
  // action === 'ignore' → leave the shared token untouched (ordering guard).
  if (__DEV__) {
    console.log(
      '[supabase] shared-token sync trigger=' + trigger +
        ' hasToken=' + sessionHasToken + ' action=' + action,
    );
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  syncSharedToken(event as SharedAuthTrigger, session?.access_token ?? null);
});

// Backfill the persisted session on cold start. This is the AUTHORITATIVE
// startup restore: it writes the current valid token (or clears if genuinely
// signed out), marks the bridge initialized, and verifies the write by reading
// back the NON-SECRET status (never the token itself).
supabase.auth.getSession().then(({ data }) => {
  syncSharedToken('STARTUP_RESTORE', data.session?.access_token ?? null);
  // Mark the App Group bridge initialized AFTER the first completed
  // getSession() — even when signed out. This lets the Share Extension tell
  // "first install, host never launched" (needs setup) apart from a genuine
  // signed-out state. Never reset on sign-out.
  sharedAuth.setInitialized();
  // Verify the write reached the shared container (non-secret readback).
  const status = sharedAuth.getStatus();
  if (status && !status.tokenPresent && data.session?.access_token) {
    console.warn(
      '[supabase] shared-auth readback MISMATCH: host has a session but the' +
        ' App Group token is absent (appGroupAccessible=' +
        status.appGroupAccessible + ' errorCode=' + (status.errorCode ?? 'none') + ')',
    );
  } else if (__DEV__ && status) {
    console.log(
      '[supabase] shared-auth readback appGroupAccessible=' + status.appGroupAccessible +
        ' initialized=' + status.initialized + ' tokenPresent=' + status.tokenPresent +
        ' tokenStructurallyValid=' + status.tokenStructurallyValid,
    );
  }
}).catch((err) => {
  console.warn('[supabase] cold-start session backfill failed', err);
  // Still mark initialized: the host DID run and complete its auth check; a
  // transient getSession() error must not strand the extension on "finish
  // setup" forever.
  sharedAuth.setInitialized();
});
