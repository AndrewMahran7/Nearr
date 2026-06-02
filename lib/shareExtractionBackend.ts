import Constants from 'expo-constants';
// `Constants` import retained for future runtime checks that may need
// it; the env resolution now lives in lib/shareEnvDiagnostics.ts.
void Constants;

import {
  buildVerifiedProfileQuery,
  isVerifiedVenueProfile,
  pickBestVerifiedVenueProfile,
  type InstagramProfileMetadata,
} from './instagramProfileMetadata';
import type { ClientAgentBlock } from './shareAgent/userFacing';
import {
  hostFromUrl,
  resolveProcessShareLinkUrl,
  type ShareEnvSource,
} from './shareEnvDiagnostics';
import { supabase } from './supabase';

// 2026-05-26: single resolver covers process.env, Constants.expoConfig.extra,
// Constants.manifest.extra, and Constants.manifest2.extra so a missing env
// inline at EAS build time falls back to app.config.js -> extra -> runtime.
const envResolution = resolveProcessShareLinkUrl();
const PROCESS_SHARE_LINK_URL = envResolution.url;
const PROCESS_SHARE_LINK_URL_SOURCE: ShareEnvSource = envResolution.source;
const PROCESS_SHARE_LINK_URL_HOST = hostFromUrl(PROCESS_SHARE_LINK_URL);

// 2026-05-26: surface a single loud warning at module load so device logs
// (metro/adb/Console.app) make it obvious when the host app build did NOT
// inline EXPO_PUBLIC_PROCESS_SHARE_LINK_URL. Without this var the host app
// silently falls through to the legacy heuristic pipeline and the
// `process-share-link` Edge Function is never invoked — which is the most
// common cause of "no logs in process-share-link" reports. See repo
// memory note re: `eas env:create EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`.
if (!PROCESS_SHARE_LINK_URL) {
  console.warn(
    '[share-mobile-debug] backend_configured=no source=none' +
    ' EXPO_PUBLIC_PROCESS_SHARE_LINK_URL is empty AND Constants.expoConfig.extra' +
    '.processShareLinkUrl is empty — host app will use the legacy heuristic' +
    ' pipeline and process-share-link will NOT be invoked. Set the env var' +
    ' (eas env:create EXPO_PUBLIC_PROCESS_SHARE_LINK_URL=...) and rebuild.',
  );
} else {
  console.log(
    `[share-mobile-debug] backend_configured=yes source=${PROCESS_SHARE_LINK_URL_SOURCE}` +
      ` url_host=${PROCESS_SHARE_LINK_URL_HOST ?? '(unknown)'}`,
  );
}

export type ShareDebugObserver = (marker: string, data?: Record<string, unknown>) => void;

export function isProcessShareLinkConfigured(): boolean {
  return !!PROCESS_SHARE_LINK_URL;
}

/**
 * 2026-05-26: Structured failure reasons that `extractShareOnServer`
 * may report alongside (or instead of) a null extraction. These map
 * 1:1 to the on-screen `fallback reason` field so a TestFlight tester
 * can identify EXACTLY which step failed without grepping logs.
 *
 *   - `backend_not_configured`: PROCESS_SHARE_LINK_URL is empty —
 *     EAS build did not inline EXPO_PUBLIC_PROCESS_SHARE_LINK_URL
 *     and Constants.expoConfig.extra.processShareLinkUrl is also
 *     empty. Most common bug.
 *   - `missing_session`: Supabase has no access token — user is not
 *     signed in or session expired.
 *   - `dev_mode_no_token`: Demo / dev-auth mode, no real JWT.
 *   - `request_failed`: fetch threw before getting a response
 *     (DNS error, network down, malformed URL).
 *   - `timeout`: AbortController fired our 12.5s budget.
 *   - `unauthorized`: HTTP 401/403 from the Edge Function.
 *   - `non_200`: any other non-OK HTTP status (e.g. 500, 502).
 *   - `invalid_response`: response body is not valid JSON.
 *   - `server_returned_null`: parsed JSON but status !== 'extracted'
 *     or `extraction` payload missing/malformed.
 */
export type ExtractShareFailureReason =
  | 'backend_not_configured'
  | 'missing_session'
  | 'dev_mode_no_token'
  | 'request_failed'
  | 'timeout'
  | 'unauthorized'
  | 'non_200'
  | 'invalid_response'
  | 'server_returned_null';

export type ExtractShareDiagnostics = {
  configured: boolean;
  configSource: ShareEnvSource;
  urlHost: string | null;
};

export function getProcessShareLinkDiagnostics(): ExtractShareDiagnostics {
  return {
    configured: !!PROCESS_SHARE_LINK_URL,
    configSource: PROCESS_SHARE_LINK_URL_SOURCE,
    urlHost: PROCESS_SHARE_LINK_URL_HOST,
  };
}

export type ExtractShareOnServerResult = {
  extraction: BackendExtractionPayload | null;
  didCallEdgeFunction: boolean;
  httpStatus: number | null;
  failureReason: ExtractShareFailureReason | null;
  failureDetail: string | null;
};

function emitShareDebug(
  observer: ShareDebugObserver | undefined,
  marker: string,
  data?: Record<string, unknown>,
): void {
  observer?.(marker, data);
}

export type BackendQuerySource =
  | 'verified_profile'
  | 'account_display_name'
  | 'account_handle'
  | 'address'
  | 'structured_ai'
  | 'heuristic'
  | 'ai'
  | 'none';

export type BackendInstagramProfileMetadata = InstagramProfileMetadata & {
  fetched?: boolean;
  blocked?: boolean;
  reasons?: string[];
};

export type BackendExtractionPayload = {
  source: 'instagram' | 'tiktok' | 'link';
  title?: string | null;
  description?: string | null;
  handlesDetected?: string[];
  query: string;
  querySource: BackendQuerySource;
  confidence: 'high' | 'medium' | 'low';
  queryKind: string;
  searchAllowed: boolean;
  blockedReason: string | null;
  placeName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  sourceContext: string | null;
  posterHandle: string | null;
  posterType: 'restaurant' | 'influencer' | 'unknown';
  taggedAccounts: string[];
  ai?: {
    query: string;
    placeName: string | null;
    address: string | null;
    city?: string | null;
    state?: string | null;
    confidence: 'high' | 'medium' | 'low';
    needsUserConfirmation: boolean;
    reason: string;
  };
  querySelection?: {
    chosenQuery: string;
    source: BackendQuerySource;
    confidence: 'high' | 'medium' | 'low';
    verifiedProfile: boolean;
    accountIdentityUsed: boolean;
  };
  queryGate?: {
    allowed: boolean;
    reason: string;
  };
  profileMetadata: BackendInstagramProfileMetadata[];
  requiredNameHint: string | null;
  verifiedProfileQuery: string | null;
  /**
   * STAGE 2 — optional block produced by the new backend agent. When
   * present, the host app prefers the agent's `userFacingDecision` over
   * the legacy heuristic pipeline. Stage 2 NEVER auto-saves on the
   * agent's behalf; that hardcap is enforced server-side in
   * lib/shareAgent/userFacing.ts and re-checked on the client.
   */
  agent?: ClientAgentBlock;
};

export type ShareAgentBlock = ClientAgentBlock;

type BackendExtractResponse = {
  status: 'extracted';
  extraction?: BackendExtractionPayload;
  reason?: string;
};

type BackendResponseSummary = {
  httpStatus: number;
  keys: string[];
  status: string | null;
  reason: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function summarizeBackendPayload(payload: unknown, httpStatus: number): BackendResponseSummary {
  const record = isRecord(payload) ? payload : {};
  return {
    httpStatus,
    keys: Object.keys(record).sort(),
    status: typeof record.status === 'string' ? record.status : null,
    reason: typeof record.reason === 'string' ? record.reason : null,
  };
}

function coerceBackendExtraction(payload: unknown): BackendExtractionPayload | null {
  if (!isRecord(payload)) return null;
  const nested = isRecord(payload.extraction) ? payload.extraction : null;
  const candidate = nested ?? payload;
  // 2026-05-27 — looser shape check. The refactored backend always
  // returns an `extraction` object, but a manual_fallback response
  // can legitimately have `query === ''` and `placeName === null`
  // (no candidates found). Treating that as `server_returned_null`
  // pushes the host app back into the legacy client pipeline even
  // though the server already made a definitive decision. Accept
  // anything that has the `agent` block OR any one of the
  // legacy-identifying fields.
  const hasAgent = isRecord((candidate as any).agent);
  const hasLegacyShape =
    typeof (candidate as any).query === 'string' ||
    typeof (candidate as any).placeName === 'string' ||
    typeof (candidate as any).source === 'string';
  if (!hasAgent && !hasLegacyShape) return null;
  // Defensively backfill optional fields the host app downstream
  // touches with non-null assumptions (e.g.
  // `serverExtraction.profileMetadata.length` in app/share.tsx).
  const rec = candidate as Record<string, any>;
  if (!Array.isArray(rec.profileMetadata)) rec.profileMetadata = [];
  if (!Array.isArray(rec.taggedAccounts)) rec.taggedAccounts = [];
  if (!Array.isArray(rec.handlesDetected)) rec.handlesDetected = [];
  if (typeof rec.query !== 'string') rec.query = '';
  if (typeof rec.querySource !== 'string') rec.querySource = 'none';
  if (typeof rec.queryKind !== 'string') rec.queryKind = 'unknown';
  if (typeof rec.searchAllowed !== 'boolean') rec.searchAllowed = false;
  if (rec.blockedReason === undefined) rec.blockedReason = null;
  if (rec.posterType !== 'restaurant' && rec.posterType !== 'influencer') {
    rec.posterType = 'unknown';
  }
  return rec as unknown as BackendExtractionPayload;
}

export async function extractShareOnServer(
  url: string,
  options?: {
    onDebugEvent?: ShareDebugObserver;
    /**
     * 2026-05-26: optional callback invoked exactly once per call with
     * a structured outcome — used by the host app to populate the
     * on-screen debug panel with `didCallEdgeFunction`, `httpStatus`,
     * `failureReason`, etc. without forcing every caller to migrate
     * away from the legacy `Promise<… | null>` shape.
     */
    onOutcome?: (outcome: ExtractShareOnServerResult) => void;
  },
): Promise<BackendExtractionPayload | null> {
  const emitOutcome = (outcome: ExtractShareOnServerResult): void => {
    try { options?.onOutcome?.(outcome); } catch {}
    if (outcome.failureReason) {
      console.warn(
        `[share-mobile-debug] process_share_link_failed reason=${outcome.failureReason}` +
          ` http_status=${outcome.httpStatus ?? 'null'}` +
          ` did_call=${outcome.didCallEdgeFunction}` +
          (outcome.failureDetail ? ` detail=${outcome.failureDetail}` : ''),
      );
    } else if (outcome.didCallEdgeFunction) {
      console.log(
        `[share-mobile-debug] process_share_link_response status=${outcome.httpStatus ?? 'null'}` +
          ` extracted=${outcome.extraction ? 'yes' : 'no'}`,
      );
    }
  };

  emitShareDebug(options?.onDebugEvent, '[share-debug] EDGE_FUNCTION_CONFIGURED', {
    value: !!PROCESS_SHARE_LINK_URL,
  });
  if (!PROCESS_SHARE_LINK_URL) {
    emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
      status: 'open_app',
      reason: 'backend_not_configured',
    });
    emitOutcome({
      extraction: null,
      didCallEdgeFunction: false,
      httpStatus: null,
      failureReason: 'backend_not_configured',
      failureDetail: null,
    });
    return null;
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token?.trim() ?? '';
  emitShareDebug(options?.onDebugEvent, '[share-debug] RUNTIME_PATH', {
    path: 'edge_function',
  });
  if (!accessToken || accessToken === 'dev-mode-no-token') {
    const reason: ExtractShareFailureReason = !accessToken ? 'missing_session' : 'dev_mode_no_token';
    emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
      status: 'open_app',
      reason,
    });
    emitOutcome({
      extraction: null,
      didCallEdgeFunction: false,
      httpStatus: null,
      failureReason: reason,
      failureDetail: null,
    });
    return null;
  }

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(
    `[share-mobile-debug] calling_process_share_link request_id=${requestId}` +
      ` url_host=${PROCESS_SHARE_LINK_URL_HOST ?? '(unknown)'}`,
  );
  const controller = new AbortController();
  // STAGE 2 — extended budget so the inline backend agent (≤10s server
  // budget) plus network round-trip fits under our cancellation window.
  const timeout = setTimeout(() => controller.abort(), 12_500);
  try {
    emitShareDebug(options?.onDebugEvent, '[share-debug] FLOW_START', {
      source: 'host_app_backend_extract',
      url,
    });
    const response = await fetch(PROCESS_SHARE_LINK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-nearr-request-id': requestId,
      },
      body: JSON.stringify({ url, accessToken, mode: 'extract' }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const failureReason: ExtractShareFailureReason =
        response.status === 401 || response.status === 403 ? 'unauthorized' : 'non_200';
      emitShareDebug(options?.onDebugEvent, '[share-debug] BACKEND_RESPONSE_SUMMARY', {
        httpStatus: response.status,
        keys: [],
        status: null,
        reason: `http_${response.status}`,
      });
      emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
        status: 'open_app',
        reason: `http_${response.status}`,
      });
      emitOutcome({
        extraction: null,
        didCallEdgeFunction: true,
        httpStatus: response.status,
        failureReason,
        failureDetail: `http_${response.status}`,
      });
      return null;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      emitOutcome({
        extraction: null,
        didCallEdgeFunction: true,
        httpStatus: response.status,
        failureReason: 'invalid_response',
        failureDetail: err instanceof Error ? err.message : 'json_parse_failed',
      });
      return null;
    }
    const summary = summarizeBackendPayload(json, response.status);
    emitShareDebug(options?.onDebugEvent, '[share-debug] BACKEND_RESPONSE_SUMMARY', {
      httpStatus: summary.httpStatus,
      keys: summary.keys,
      status: summary.status,
      reason: summary.reason,
    });
    const extraction = coerceBackendExtraction(json);
    // 2026-05-27 — extra signals for the on-device diagnostics panel.
    // These are the exact fields a tester needs to see to know
    // WHY the parser rejected (or accepted) a backend response.
    {
      const root = isRecord(json) ? json : {};
      const extractionRoot = isRecord(root.extraction) ? root.extraction : null;
      const agentRoot = extractionRoot && isRecord(extractionRoot.agent)
        ? extractionRoot.agent
        : null;
      const candidatesArr = agentRoot && Array.isArray((agentRoot as any).candidates)
        ? (agentRoot as any).candidates
        : Array.isArray((root as any).candidates)
          ? (root as any).candidates
          : [];
      emitShareDebug(options?.onDebugEvent, '[share-debug] BACKEND_PARSE_SIGNALS', {
        hasExtraction: !!extractionRoot,
        hasAgent: !!agentRoot,
        hasResolvedPlace: !!(agentRoot && (agentRoot as any).resolvedPlace),
        candidateCount: candidatesArr.length,
        userFacingDecision: agentRoot ? (agentRoot as any).userFacingDecision ?? null : null,
        parserAccepted: !!extraction,
      });
    }
    if (summary.status !== 'extracted' || !extraction) {
      emitShareDebug(options?.onDebugEvent, '[share-debug] BACKEND_PAYLOAD_UNEXPECTED', {
        status: summary.status,
        keys: summary.keys,
        reason: summary.reason ?? 'missing_extraction_payload',
        httpStatus: summary.httpStatus,
      });
      emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
        status: summary.status ?? 'open_app',
        reason: 'unexpected_backend_payload',
      });
      emitOutcome({
        extraction: null,
        didCallEdgeFunction: true,
        httpStatus: response.status,
        failureReason: 'server_returned_null',
        failureDetail: summary.reason ?? `status=${summary.status ?? 'unknown'}`,
      });
      return null;
    }
    const normalized = normalizeBackendExtraction(extraction);
    emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
      status: 'extracted',
      reason: null,
    });
    emitOutcome({
      extraction: normalized,
      didCallEdgeFunction: true,
      httpStatus: response.status,
      failureReason: null,
      failureDetail: null,
    });
    return normalized;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    const failureReason: ExtractShareFailureReason = isAbort ? 'timeout' : 'request_failed';
    emitShareDebug(options?.onDebugEvent, '[share-debug] FINAL_RESULT', {
      status: 'open_app',
      reason: error instanceof Error ? error.name : 'request_failed',
    });
    emitOutcome({
      extraction: null,
      didCallEdgeFunction: true,
      httpStatus: null,
      failureReason,
      failureDetail: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBackendExtraction(
  extraction: BackendExtractionPayload,
): BackendExtractionPayload {
  const profileMetadata = Array.isArray(extraction.profileMetadata)
    ? extraction.profileMetadata.filter((profile) => !!profile?.handle)
    : [];
  const preferredProfile = pickBestVerifiedVenueProfile(profileMetadata, [extraction.posterHandle]);
  const requiredNameHint =
    extraction.requiredNameHint ??
    preferredProfile?.extractedName ??
    extraction.placeName ??
    null;
  const verifiedProfileQuery =
    extraction.verifiedProfileQuery ??
    buildVerifiedProfileQuery(preferredProfile) ??
    null;

  return {
    ...extraction,
    handlesDetected: Array.isArray(extraction.handlesDetected)
      ? extraction.handlesDetected.filter((handle): handle is string => typeof handle === 'string' && !!handle)
      : profileMetadata.map((profile) => profile.handle),
    ai: extraction.ai ?? {
      query: extraction.query,
      placeName: extraction.placeName,
      address: extraction.address,
      city: extraction.city,
      state: extraction.state,
      confidence: extraction.confidence,
      needsUserConfirmation: !extraction.searchAllowed,
      reason: extraction.querySource,
    },
    querySelection: extraction.querySelection ?? {
      chosenQuery: extraction.query,
      source: extraction.querySource,
      confidence: extraction.confidence,
      verifiedProfile: !!preferredProfile,
      accountIdentityUsed:
        extraction.querySource === 'account_display_name' ||
        extraction.querySource === 'account_handle',
    },
    queryGate: extraction.queryGate ?? {
      allowed: extraction.searchAllowed,
      reason: extraction.searchAllowed
        ? extraction.querySource === 'verified_profile'
          ? 'verified_profile'
          : 'passed'
        : extraction.blockedReason ?? 'blocked',
    },
    profileMetadata,
    requiredNameHint,
    verifiedProfileQuery,
  };
}

export function getVerifiedProfileEvidence(
  extraction: BackendExtractionPayload | null | undefined,
): InstagramProfileMetadata | null {
  if (!extraction) return null;
  const preferred = pickBestVerifiedVenueProfile(extraction.profileMetadata, [extraction.posterHandle]);
  if (preferred) return preferred;
  return extraction.profileMetadata.find((profile) => isVerifiedVenueProfile(profile)) ?? null;
}