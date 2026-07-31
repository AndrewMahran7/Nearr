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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { close, openHostApp, type InitialProps } from 'expo-share-extension';

import { sharedAuth } from './lib/sharedAuth';
import {
  hostFromUrl,
  resolveProcessShareLinkUrl,
} from './lib/shareEnvDiagnostics';
import { isAsyncShareJobsEnabled, resolveCreateShareJobUrl } from './lib/featureFlags';
import { createShareJob } from './lib/shareJobClient';

// 2026-05-26: single resolver covers process.env, expoConfig.extra,
// manifest.extra and manifest2.extra so a missing inline at build
// time falls back to the runtime extra written by app.config.js.
const extensionEnv = resolveProcessShareLinkUrl();
const extensionUrlHost = hostFromUrl(extensionEnv.url);

function resolveProcessShareLinkUrlForExtension(): string {
  return extensionEnv.url;
}

// 2026-05-26: surface a single loud warning at module load so iOS device
// logs (Console.app / Xcode) make it obvious when the extension build did
// NOT inline EXPO_PUBLIC_PROCESS_SHARE_LINK_URL. Without it the extension
// silently hands off to the host app and process-share-link is never
// invoked. Mirrors the host-app warning in lib/shareExtractionBackend.ts.
(() => {
  if (!extensionEnv.url) {
    console.warn(
      '[share-extension-debug] backend_configured=no source=none url_host=null' +
      ' — extension will hand off to host app; process-share-link will NOT be' +
      ' invoked from the extension. Set EXPO_PUBLIC_PROCESS_SHARE_LINK_URL via' +
      ' eas env:create and rebuild the extension target.',
    );
  } else {
    console.log(
      `[share-extension-debug] backend_configured=yes source=${extensionEnv.source}` +
        ` url_host=${extensionUrlHost ?? '(unknown)'}`,
    );
  }
})();

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
  onDiagnostics?: (d: ExtensionDiagnostics) => void,
): Promise<ProcessSharedUrlResult> {
  const endpoint = resolveProcessShareLinkUrlForExtension();
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(
    `[share-extension-debug] entry url_host=${hostFromUrl(url) ?? '(unknown)'}` +
      ` backend_configured=${!!endpoint} request_id=${requestId}`,
  );
  if (!endpoint) {
    console.log('[share-extension-debug] handoff_reason=backend_not_configured');
    onDiagnostics?.({
      backendConfigured: false,
      backendUrlHost: null,
      authTokenPresent: false,
      nativeAvailable: false,
      didCallProcessShareLink: false,
      httpStatus: null,
      handoffReason: 'backend_not_configured',
      requestId,
    });
    return { status: 'open_app', reason: 'backend_not_configured' };
  }

  // Read JWT written by the host app into the App Group container.
  const nativeAvailable = sharedAuth.isAvailable();
  const accessToken = sharedAuth.getToken();
  console.log(
    `[share-extension-debug] auth_token_present=${!!accessToken}` +
      ` native_available=${nativeAvailable}`,
  );

  if (!accessToken) {
    // No session in the host app, or the native module isn't linked yet.
    // Diagnose: if native_available=false the NearrSharedAuth module isn't
    // compiled into this share extension build — a new EAS/TestFlight build
    // is required. If native_available=true but token_present=false the host
    // app has not written the token yet (open the Nearr app first while
    // signed in).
    console.warn(
      `[share-extension-debug] handoff_reason=missing_auth` +
        ` native_available=${nativeAvailable}`,
    );
    onDiagnostics?.({
      backendConfigured: true,
      backendUrlHost: extensionUrlHost,
      authTokenPresent: false,
      nativeAvailable,
      didCallProcessShareLink: false,
      httpStatus: null,
      handoffReason: 'missing_auth',
      requestId,
    });
    return { status: 'open_app', reason: 'missing_auth' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    console.log(
      `[share-extension-debug] calling_process_share_link request_id=${requestId}` +
        ` url_host=${extensionUrlHost ?? '(unknown)'}`,
    );
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-nearr-request-id': requestId,
      },
      body: JSON.stringify({ url, accessToken }),
      signal: controller.signal,
    });
    console.log(
      `[share-extension-debug] process_share_link_response status=${res.status}` +
        ` request_id=${requestId}`,
    );
    if (!res.ok) {
      onDiagnostics?.({
        backendConfigured: true,
        backendUrlHost: extensionUrlHost,
        authTokenPresent: true,
        nativeAvailable,
        didCallProcessShareLink: true,
        httpStatus: res.status,
        handoffReason: `http_${res.status}`,
        requestId,
      });
      return { status: 'open_app', reason: `http_${res.status}` };
    }
    const json = (await res.json()) as ProcessSharedUrlResult;
    if (!json || typeof (json as { status?: unknown }).status !== 'string') {
      onDiagnostics?.({
        backendConfigured: true,
        backendUrlHost: extensionUrlHost,
        authTokenPresent: true,
        nativeAvailable,
        didCallProcessShareLink: true,
        httpStatus: res.status,
        handoffReason: 'invalid_response',
        requestId,
      });
      return { status: 'open_app', reason: 'invalid_response' };
    }
    onDiagnostics?.({
      backendConfigured: true,
      backendUrlHost: extensionUrlHost,
      authTokenPresent: true,
      nativeAvailable,
      didCallProcessShareLink: true,
      httpStatus: res.status,
      handoffReason: json.status === 'saved' ? null : json.status,
      requestId,
    });
    return json;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const reason = isAbort ? 'timeout' : 'network_error';
    console.warn(`[share-extension-debug] handoff_reason=${reason}`, err);
    onDiagnostics?.({
      backendConfigured: true,
      backendUrlHost: extensionUrlHost,
      authTokenPresent: true,
      nativeAvailable,
      didCallProcessShareLink: true,
      httpStatus: null,
      handoffReason: reason,
      requestId,
    });
    return { status: 'open_app', reason };
  } finally {
    clearTimeout(timeout);
  }
}

type ExtensionDiagnostics = {
  backendConfigured: boolean;
  backendUrlHost: string | null;
  authTokenPresent: boolean;
  nativeAvailable: boolean;
  didCallProcessShareLink: boolean;
  httpStatus: number | null;
  handoffReason: string | null;
  requestId: string;
};

function handOffToHostApp(url: string, reason?: string) {
  const encoded = encodeURIComponent(url);
  const path = reason
    ? `share?url=${encoded}&ext_reason=${encodeURIComponent(reason)}`
    : `share?url=${encoded}`;
  // 2026-06-04 — manual-fallback handoff. The host app immediately shows
  // its manual search UI with the original URL attached; the extension
  // never renders a terminal "couldn't save" state. Log presence only,
  // never the raw URL/token.
  console.log(`[share-fallback] handoff_to_host=true reason=${reason ?? 'open_app'}`);
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
  // Feature-flagged: async submit-and-dismiss (new) vs the legacy synchronous
  // handoff (unchanged). Default OFF keeps the proven flow until rollout.
  if (isAsyncShareJobsEnabled()) {
    return <AsyncShareExtension {...props} />;
  }
  return <LegacyShareExtension {...props} />;
}

function LegacyShareExtension(props: InitialProps) {
  // Guard against React 18 strict-mode double-invocation: only fire the
  // host-app handoff once per extension instantiation.
  const handledRef = useRef(false);
  const [ui, setUi] = useState<UiState>({ kind: 'working' });
  // 2026-05-26: hold the latest structured diagnostics so the share
  // sheet itself can show the user (and screenshot-takers) exactly
  // why the extension handed off / hit the backend / fell back.
  const [diag, setDiag] = useState<ExtensionDiagnostics | null>(null);
  void setUi;

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
        result = await processSharedUrl(url, (d) => {
          if (!cancelled) setDiag(d);
        });
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
          // 2026-05-26: small delay so the diagnostics panel is visible
          // long enough to read / screenshot before we close.
          closeTimer = setTimeout(() => close(), 1500);
          return;
        }
        case 'open_app':
        default: {
          // Legacy/fallback path: same behavior as before this change.
          handOffToHostApp(url, (result as { reason?: string }).reason);
          closeTimer = setTimeout(() => close(), 1500);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [props]);

  const diagPanel = diag ? (
    <View style={styles.diagPanel}>
      <Text style={styles.diagTitle}>share-extension diagnostics</Text>
      <Text style={styles.diagLine}>backend configured: {diag.backendConfigured ? 'yes' : 'no'}</Text>
      <Text style={styles.diagLine}>backend url host: {diag.backendUrlHost ?? '∅'}</Text>
      <Text style={styles.diagLine}>auth token present: {diag.authTokenPresent ? 'yes' : 'no'}</Text>
      <Text style={styles.diagLine}>native auth available: {diag.nativeAvailable ? 'yes' : 'no'}</Text>
      <Text style={styles.diagLine}>called process-share-link: {diag.didCallProcessShareLink ? 'yes' : 'no'}</Text>
      <Text style={styles.diagLine}>http status: {diag.httpStatus ?? '∅'}</Text>
      <Text style={styles.diagLine}>handoff reason: {diag.handoffReason ?? '∅'}</Text>
      <Text style={styles.diagLine}>request id: {diag.requestId}</Text>
    </View>
  ) : null;

  if (ui.kind === 'saved') {
    return (
      <View style={styles.container}>
        <Text style={styles.checkmark}>✓</Text>
        <Text style={styles.label}>{ui.message ?? 'Saved to Nearr'}</Text>
        {diagPanel}
      </View>
    );
  }

  if (ui.kind === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>{ui.message}</Text>
        {diagPanel}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.label}>Saving to Nearr…</Text>
      {diagPanel}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Async share flow (feature-flagged). The extension ONLY validates the URL,
// creates a durable job via `create-share-job`, and dismisses. It NEVER waits
// for extraction, NEVER downloads media, and NEVER opens the host app after a
// successful submission.
// ---------------------------------------------------------------------------

type AsyncUi =
  | { kind: 'submitting' }
  | { kind: 'accepted'; duplicate: boolean }
  | { kind: 'signed_out' }
  | { kind: 'network_failure' };

function AsyncShareExtension(props: InitialProps) {
  const handledRef = useRef(false);
  // Stable per-instantiation idempotency key: rapid duplicate shares of the
  // same URL still dedupe server-side (active-url unique index).
  const requestIdRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [ui, setUi] = useState<AsyncUi>({ kind: 'submitting' });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = async () => {
    const url = pickSharedUrl(props);
    if (!url) {
      console.log('[share-extension] no url found in shared payload, closing');
      close();
      return;
    }
    const endpoint = resolveCreateShareJobUrl();
    const token = sharedAuth.getToken();
    // No valid session → do NOT create an orphan job. Hand off to the host so
    // the user can sign in.
    if (!token) {
      console.log('[share-extension] job_accepted=false reason=signed_out');
      setUi({ kind: 'signed_out' });
      return;
    }
    if (!endpoint) {
      console.log('[share-extension] job_accepted=false reason=no_endpoint');
      setUi({ kind: 'network_failure' });
      return;
    }
    setUi({ kind: 'submitting' });
    const result = await createShareJob({
      endpoint,
      url,
      accessToken: token,
      clientRequestId: requestIdRef.current,
    });
    if (result.ok) {
      console.log(`[share-extension] job_accepted=true duplicate=${result.duplicate}`);
      setUi({ kind: 'accepted', duplicate: result.duplicate });
      closeTimerRef.current = setTimeout(() => {
        console.log('[share-extension] dismissed_after_accept=true');
        close();
      }, 1400);
    } else if (result.reason === 'unauthorized' || result.reason === 'missing_auth') {
      console.log('[share-extension] job_accepted=false reason=unauthorized');
      setUi({ kind: 'signed_out' });
    } else {
      // Never claim the job was queued if the server did not accept it.
      console.log(`[share-extension] job_accepted=false reason=${result.reason}`);
      setUi({ kind: 'network_failure' });
    }
  };

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    void submit();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHost = (reason: string) => {
    const url = pickSharedUrl(props);
    if (url) {
      const encoded = encodeURIComponent(url);
      try {
        openHostApp(`share?url=${encoded}&ext_reason=${encodeURIComponent(reason)}`);
      } catch (err) {
        console.warn('[share-extension] openHostApp failed', err);
      }
    }
    close();
  };

  if (ui.kind === 'accepted') {
    return (
      <View style={asyncStyles.container}>
        <View style={asyncStyles.brandDot}>
          <Text style={asyncStyles.check}>✓</Text>
        </View>
        <Text style={asyncStyles.title}>Added to your queue</Text>
        <Text style={asyncStyles.subtle}>{"We'll notify you when it's ready."}</Text>
        <Pressable style={asyncStyles.secondaryBtn} onPress={() => close()}>
          <Text style={asyncStyles.secondaryText}>Done</Text>
        </Pressable>
      </View>
    );
  }
  if (ui.kind === 'signed_out') {
    return (
      <View style={asyncStyles.container}>
        <Text style={asyncStyles.title}>Open Nearr to sign in</Text>
        <Text style={asyncStyles.subtle}>{'Sign in once so Nearr can save places you share.'}</Text>
        <Pressable style={asyncStyles.primaryBtn} onPress={() => openHost('signed_out')}>
          <Text style={asyncStyles.primaryText}>Open Nearr</Text>
        </Pressable>
      </View>
    );
  }
  if (ui.kind === 'network_failure') {
    return (
      <View style={asyncStyles.container}>
        <Text style={asyncStyles.title}>{"Couldn't reach Nearr"}</Text>
        <Text style={asyncStyles.subtle}>{'Check your connection and try again.'}</Text>
        <Pressable style={asyncStyles.primaryBtn} onPress={() => void submit()}>
          <Text style={asyncStyles.primaryText}>Retry</Text>
        </Pressable>
        <Pressable style={asyncStyles.secondaryBtn} onPress={() => openHost('network_failure')}>
          <Text style={asyncStyles.secondaryText}>Open Nearr instead</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={asyncStyles.container}>
      <ActivityIndicator color={NEARR_ORANGE} />
      <Text style={asyncStyles.title}>Saving to Nearr</Text>
      <Text style={asyncStyles.subtle}>{'Finding the place from this post…'}</Text>
      <Text style={asyncStyles.subtleSmall}>
        {"You can close this and keep scrolling. We'll notify you when it's ready."}
      </Text>
      <Pressable style={asyncStyles.secondaryBtn} onPress={() => close()}>
        <Text style={asyncStyles.secondaryText}>Close</Text>
      </Pressable>
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
  diagPanel: {
    marginTop: 16,
    padding: 8,
    backgroundColor: '#f4f4f4',
    borderRadius: 6,
    alignSelf: 'stretch',
  },
  diagTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
    marginBottom: 4,
  },
  diagLine: {
    fontSize: 11,
    color: '#333',
    marginTop: 2,
  },
  title: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
    textAlign: 'center',
  },
  subtle: {
    marginTop: 4,
    fontSize: 14,
    color: '#444',
    textAlign: 'center',
  },
  subtleSmall: {
    marginTop: 6,
    fontSize: 12,
    color: '#777',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#D85C16',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 999,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  secondaryText: { color: '#D85C16', fontSize: 14, fontWeight: '600' },
});

// ---------------------------------------------------------------------------
// Async share-extension styles — matches the Nearr dark map UI (near-black
// surface, white type, orange accent). Kept SEPARATE from the legacy `styles`
// above so the flag-off (legacy) extension appearance is unchanged.
// ---------------------------------------------------------------------------
const NEARR_ORANGE = '#FF6B00';
const NEARR_BG = '#0B0B0D';
const NEARR_SURFACE = '#1C1C20';
const NEARR_BORDER = '#2A2A30';

const asyncStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: NEARR_BG,
  },
  brandDot: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,107,0,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.3)',
    marginBottom: 4,
  },
  check: {
    fontSize: 30,
    lineHeight: 34,
    color: NEARR_ORANGE,
    fontWeight: '700',
  },
  title: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtle: {
    marginTop: 6,
    fontSize: 14,
    color: '#A1A1AA',
    textAlign: 'center',
  },
  subtleSmall: {
    marginTop: 8,
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 17,
  },
  primaryBtn: {
    marginTop: 18,
    backgroundColor: NEARR_ORANGE,
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 999,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: NEARR_SURFACE,
    borderWidth: 1,
    borderColor: NEARR_BORDER,
  },
  secondaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
