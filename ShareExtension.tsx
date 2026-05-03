/**
 * ShareExtension — root component for the iOS Share Extension target.
 *
 * Current behavior (V2 beta, 2026-04-27):
 *   - Receives `url` and/or `text` from iOS as initial props.
 *   - Extracts the first https URL from the payload.
 *   - Calls `processSharedUrl(url)` (currently a stub) to decide what
 *     to do next.
 *   - The stub always returns { status: "open_app" }, so the extension
 *     hands off to the host app at `nearr://share?url=<encoded>`,
 *     preserving the existing working flow. The host app's
 *     [/share](app/share.tsx) screen auto-runs the save flow.
 *
 * Desired future behavior (see docs/IOS_SHARE_EXTENSION.md):
 *   `processSharedUrl` will POST to a Supabase Edge Function
 *   (`processShareLink`) which performs the heavy work server-side
 *   (OG fetch, AI extraction, Places lookup, save) and returns one of:
 *
 *     {
 *       status: "saved" | "ambiguous" | "failed_requires_app" | "open_app",
 *       savedPlaceId?: string,
 *       candidates?: PlaceCandidate[],
 *       message?: string,
 *     }
 *
 *   - "saved": render "Saved to Nearr" and `close()` after a short delay.
 *   - "ambiguous" / "failed_requires_app": hand off to the host app at
 *     `nearr://share?url=...` for candidate selection / error recovery.
 *   - "open_app": legacy fallback (current behavior); just open the
 *     host app and let it run the existing flow.
 *
 * Constraints (do NOT change):
 *   - No Gemini / Google Places API keys live in this extension.
 *   - No heavy AI / transcription runs here.
 *   - Until the backend endpoint exists, we keep the redirect flow
 *     as the fallback.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { close, openHostApp, type InitialProps } from 'expo-share-extension';

import { sharedAuth } from './lib/sharedAuth';

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCT = /[.,)\]!?;:]+$/;

/**
 * Pull the first http(s) URL out of a free-text caption. Captions from
 * Instagram/TikTok typically look like
 *   "check this out https://www.tiktok.com/@x/video/123 #foodie"
 * so we want the URL token, not the surrounding caption.
 */
function firstUrlIn(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(URL_REGEX);
  if (!m) return null;
  return m[0].replace(TRAILING_PUNCT, '');
}

function pickSharedUrl(props: InitialProps): string | null {
  // Direct URL share (Safari) takes priority.
  if (props.url && /^https?:\/\//i.test(props.url)) return props.url;
  // Otherwise scan any text payload for the first URL.
  return firstUrlIn(props.text);
}

/**
 * Shape of a place candidate the backend may return when it can't
 * confidently pick one. Intentionally minimal here — we never render
 * candidates inside the extension; we hand off to the host app.
 */
export type PlaceCandidate = {
  id: string;
  name: string;
  address?: string;
};

/**
 * Result returned by `processSharedUrl`. This is the contract the
 * future backend (`processShareLink` Edge Function) will fulfill.
 *
 * Expected future backend response shape:
 *   {
 *     status: "saved" | "ambiguous" | "failed_requires_app" | "open_app",
 *     savedPlaceId?: string,
 *     candidates?: PlaceCandidate[],
 *     message?: string,
 *   }
 */
export type ProcessSharedUrlResult =
  | { status: 'saved'; savedPlaceId?: string; message?: string }
  | { status: 'ambiguous'; candidates?: PlaceCandidate[]; message?: string }
  | { status: 'failed_requires_app'; message?: string }
  | { status: 'open_app'; reason?: string };

/**
 * Decide what to do with a shared URL.
 *
 * Real implementation: POST to the Supabase Edge Function
 * `process-share-link`. The endpoint URL is read from
 * `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` (a public, non-secret URL — the
 * extension can safely embed it).
 *
 * Auth: we read the user's Supabase access token from the App Group
 * shared UserDefaults via the local `nearr-shared-auth` Expo Module.
 * The host app writes the token there on every auth state change (see
 * lib/supabase.ts). If the token is missing (user not signed in, or
 * native module not yet linked) we fall back to `open_app` and the
 * existing deep-link flow runs.
 *
 * Constraints (do NOT change):
 *   - No API keys (Gemini, Google Places, service role) may live here.
 *   - No heavy work (transcription, AI) runs in-extension.
 *   - Any failure falls back to `open_app` so the user is never stuck.
 */
async function processSharedUrl(
  url: string,
): Promise<ProcessSharedUrlResult> {
  const endpoint = process.env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL;
  if (!endpoint) {
    console.log('[shareExtension] no PROCESS_SHARE_LINK_URL configured, falling back to open_app');
    return { status: 'open_app', reason: 'backend_not_configured' };
  }

  // Read JWT written by the host app into the App Group container.
  const nativeAvailable = sharedAuth.isAvailable();
  const accessToken = sharedAuth.getToken();
  console.log(
    '[share-extension] auth_bridge_check native_available=' + nativeAvailable +
    ' token_present=' + !!accessToken,
  );

  if (!accessToken) {
    // No session in the host app, or the native module isn't linked yet.
    // Diagnose: if native_available=false the NearrSharedAuth module isn't
    // compiled into this share extension build — a new EAS/TestFlight build
    // is required. If native_available=true but token_present=false the host
    // app has not written the token yet (open the Nearr app first while
    // signed in).
    console.warn(
      '[share-extension] missing shared auth token, falling back to host app' +
      ' native_available=' + nativeAvailable,
    );
    return { status: 'open_app', reason: 'missing_auth' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url, accessToken }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[shareExtension] backend HTTP', res.status);
      return { status: 'open_app', reason: `http_${res.status}` };
    }
    const json = (await res.json()) as ProcessSharedUrlResult;
    if (!json || typeof (json as any).status !== 'string') {
      return { status: 'open_app', reason: 'invalid_response' };
    }
    return json;
  } catch (err) {
    console.warn('[shareExtension] processSharedUrl failed', err);
    return { status: 'open_app', reason: 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}

function handOffToHostApp(url: string, reason?: string) {
  const encoded = encodeURIComponent(url);
  const path = reason
    ? `share?url=${encoded}&ext_reason=${encodeURIComponent(reason)}`
    : `share?url=${encoded}`;
  console.log('[shareExtension] opening host app at', path);
  try {
    openHostApp(path);
  } catch (err) {
    console.warn('[shareExtension] openHostApp failed', err);
  }
}

function openHostMap(savedPlaceId?: string) {
  const path = savedPlaceId
    ? `(tabs)/map?savedPlaceId=${encodeURIComponent(savedPlaceId)}`
    : '(tabs)/map';
  console.log('[shareExtension] opening host app at', path);
  try {
    openHostApp(path);
  } catch (err) {
    console.warn('[shareExtension] openHostApp failed', err);
  }
}

type UiState =
  | { kind: 'working' }
  | { kind: 'saved'; message?: string }
  | { kind: 'error'; message: string };

export default function ShareExtension(props: InitialProps) {
  // Guard against React 18 strict-mode double-invocation: only fire the
  // host-app handoff once per extension instantiation.
  const handledRef = useRef(false);
  const [ui, setUi] = useState<UiState>({ kind: 'working' });

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const url = pickSharedUrl(props);
    if (!url) {
      // Nothing actionable shared. Close immediately rather than leave
      // the user staring at a spinner.
      console.log('[shareExtension] no url found in shared payload, closing');
      close();
      return;
    }

    let cancelled = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      let result: ProcessSharedUrlResult;
      try {
        result = await processSharedUrl(url);
      } catch (err) {
        console.warn('[shareExtension] processSharedUrl threw', err);
        result = { status: 'open_app', reason: 'exception' };
      }
      if (cancelled) return;

      switch (result.status) {
        case 'saved': {
          // Backend handled it confidently. Reuse the map focus deep link so
          // the host app opens directly to the place the extension just saved.
          if (!result.savedPlaceId) {
            console.warn('[save-flow] saved place id missing; opening map without focus');
          }
          openHostMap(result.savedPlaceId);
          closeTimer = setTimeout(() => close(), 250);
          return;
        }
        case 'ambiguous':
        case 'failed_requires_app': {
          // Need the full host-app UI for candidate selection or error
          // recovery (manual search, retry).
          handOffToHostApp(url, result.status);
          closeTimer = setTimeout(() => close(), 250);
          return;
        }
        case 'open_app':
        default: {
          // Legacy/fallback path: same behavior as before this change.
          handOffToHostApp(url, (result as { reason?: string }).reason);
          closeTimer = setTimeout(() => close(), 250);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [props]);

  if (ui.kind === 'saved') {
    return (
      <View style={styles.container}>
        <Text style={styles.checkmark}>✓</Text>
        <Text style={styles.label}>{ui.message ?? 'Saved to Nearr'}</Text>
      </View>
    );
  }

  if (ui.kind === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>{ui.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.label}>Saving to Nearr…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    marginTop: 12,
    fontSize: 16,
    color: '#111',
  },
  checkmark: {
    fontSize: 40,
    color: '#1a8a3a',
  },
});
