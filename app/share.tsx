/**
 * Share entry screen — one-tap save flow.
 *
 * Flow:
 *   1. User pastes (or arrives via deep link with ?url=...) a TikTok /
 *      Instagram / generic URL.
 *   2. User taps a single primary button: "Save place".
 *   3. We parse public OpenGraph metadata in the background, derive a
 *      Google-Places-friendly query, and call `searchPlaces`.
 *   4. If exactly one candidate comes back, we save it automatically using
 *      the user's profile default radius, preserve `source_url` /
 *      `source_type`, show a success alert, and navigate to /(tabs)/map.
 *   5. If multiple candidates come back, we show a compact picker; tapping
 *      one saves it.
 *   6. If parsing or search fails (no metadata, ZERO_RESULTS, network), we
 *      show a friendly message and a small manual search input. We never
 *      dump raw OG metadata at the user.
 *
 * V1 scope: no clustering, no caption editing, no in-screen map preview.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Input, Screen } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { getActivationSaveFeedback } from '@/lib/activation';
import {
  isLikelyUrl,
  parseShare,
  type ParsedShare,
  type ShareSource,
} from '@/lib/shareParser';
import {
  classifyPlaceQueryStrength,
  extractPlaceQueryFromShareMetadata,
  extractAccountIdentityFromShareMetadata,
  hasExplicitSourceBusinessSignal,
  isAccountIdentityReason,
  isExplicitAddressQuery,
  type PlaceExtraction,
  type PlaceQueryStrength,
} from '@/lib/placeExtractor';
import {
  runExtractionPipeline,
  type ExtractionResult,
} from '@/lib/extractionPipeline';
import {
  extractPlaceAI,
  type AIExtractResult,
} from '@/lib/aiExtractPlace';
import {
  PlacesError,
  searchPlaces,
  isAddressLikePlace,
  isLocalityLikePlace,
  isLikelyMultiLocationPlace,
  rankPlaceCandidates,
  getShareCandidateRejectionReason,
  hasMeaningfulNameMatch,
  hasStrongNameMatch,
  resolveBusinessNearAddress,
  extractLocationContext,
  geocodeContextText,
  verifyPlaceAtAddress,
  type LocationBias,
  type PlaceCandidate,
} from '@/services/placesService';
import { listSavedPlaces, saveSavedPlace } from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import { logDebug, logInfo } from '@/lib/logger';
import { classifyExtractedQuery, shouldSearchPlaces } from '@/lib/queryValidation';
import {
  extractShareOnServer,
  getProcessShareLinkDiagnostics,
  getVerifiedProfileEvidence,
  isProcessShareLinkConfigured,
  type ExtractShareOnServerResult,
} from '@/lib/shareExtractionBackend';
import { getAppBuildDiagnostics } from '@/lib/shareEnvDiagnostics';
import * as Location from 'expo-location';

type Phase =
  | 'idle' // showing paste input, waiting for user
  | 'parsing' // fetching OG metadata
  | 'searching' // calling Google Places
  | 'saving' // upserting place + saved_places
  | 'choose' // multiple candidates, user must pick
  | 'multi-choose' // ≥2 distinct places resolved, user multi-selects
  | 'failed'; // parse/search failed → manual search

const PLATFORM_LABELS: Record<ShareSource, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  link: 'Link',
};

// Friendly copy for the failed states. We deliberately do NOT echo back the
// raw OG title/description here — that's what the previous UX did wrong.
const FAIL_NO_QUERY = "We couldn't identify a place from this link.";
const FAIL_NO_RESULTS = 'No place found. Try searching by name.';
const FAIL_GENERIC = "We couldn't identify a place from this link.";

async function getPostSaveCount(): Promise<number | null> {
  try {
    const places = await listSavedPlaces();
    return places.length;
  } catch (err) {
    console.warn('[save-flow] post-save count lookup failed', (err as Error)?.message);
    return null;
  }
}

/**
 * Best-effort hostname extraction for analytics. Returns `null` for
 * malformed input so we never log anything weird. We log host only — the
 * full URL can contain user-identifying tokens (e.g. tracking params).
 */
function safeHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function isInvalidRegexError(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return (
    message.includes('invalid regexp') ||
    message.includes('invalid regular expression') ||
    message.includes('invalid escape')
  );
}

const SHARE_DEBUG_TEXT_MAX = 160;

type ShareDebugRuntimePath =
  | 'client_only'
  | 'edge_function'
  | 'ios_extension'
  | 'android_host_app'
  | 'unknown';

type ShareDebugProfile = {
  handle: string;
  fetched: boolean | null;
  blocked: boolean | null;
  reason: string | null;
  classification: string | null;
  displayName: string | null;
  extractedName: string | null;
  extractedAddress: string | null;
  extractedCity: string | null;
};

type ShareDebugTimelineEntry = {
  marker: string;
  detail: string;
};

type ShareDebugState = {
  runtimePath: ShareDebugRuntimePath;
  edgeFunctionConfigured: boolean;
  // 2026-05-26: TestFlight diagnostics — these MUST stay populated even
  // in release builds; the panel is no longer __DEV__-gated, because
  // the bug we are debugging only reproduces on signed builds.
  backendConfigSource: string | null;
  backendUrlHost: string | null;
  extractionPathAttempted: 'edge_function' | 'legacy_client' | 'extension_handoff' | null;
  didCallProcessShareLink: boolean | null;
  fallbackReason: string | null;
  serverReturnedNull: boolean | null;
  legacyExtractionUsed: boolean | null;
  appVersion: string | null;
  appBuildNumber: string | null;
  backendHttpStatus: number | null;
  backendKeys: string[];
  backendStatus: string | null;
  backendReason: string | null;
  backendParseFailureReason: string | null;
  usedClientFallback: boolean | null;
  metadataTitle: string | null;
  metadataDescription: string | null;
  handlesDetected: string[];
  profileEnrichmentAttempted: boolean;
  profileResults: ShareDebugProfile[];
  profileMetadataCountForAi: number;
  profileMetadataHandlesForAi: string[];
  aiInputProfileMetadata: string;
  aiQuery: string | null;
  aiPlaceName: string | null;
  aiAddress: string | null;
  aiConfidence: string | null;
  aiNeedsUserConfirmation: boolean | null;
  chosenQuery: string | null;
  querySource: string | null;
  queryConfidence: string | null;
  accountIdentityUsed: boolean;
  verifiedProfileSelected: boolean;
  queryGateAllowed: boolean | null;
  queryGateReason: string | null;
  placesCandidateNames: string[];
  finalStatus: string | null;
  finalReason: string | null;
  agent: {
    runId: string;
    promptVersion: string;
    modelUsed: string;
    userFacingDecision: string;
    agentDecision: string;
    safetyDecision: string;
    downgradedFromAutoSave: boolean;
    safeToAutoSave: boolean;
    confidence: string;
    reasoning: string;
    evidenceUsed: string[];
    rejectionReasons: string[];
    toolsUsed: string[];
    toolCalls: Array<{ tool: string; status: string; note: string | null; latencyMs: number | null }>;
    candidates: Array<{ googlePlaceId: string; name: string; matchScore: number; rationale: string }>;
    latencyMs: number | null;
    warnings: string[];
  } | null;
  timeline: ShareDebugTimelineEntry[];
};

function createInitialShareDebugState(): ShareDebugState {
  const diag = getProcessShareLinkDiagnostics();
  const app = getAppBuildDiagnostics();
  return {
    runtimePath: 'unknown',
    edgeFunctionConfigured: isProcessShareLinkConfigured(),
    backendConfigSource: diag.configSource,
    backendUrlHost: diag.urlHost,
    extractionPathAttempted: null,
    didCallProcessShareLink: null,
    fallbackReason: null,
    serverReturnedNull: null,
    legacyExtractionUsed: null,
    appVersion: app.version,
    appBuildNumber: app.buildNumber,
    backendHttpStatus: null,
    backendKeys: [],
    backendStatus: null,
    backendReason: null,
    backendParseFailureReason: null,
    usedClientFallback: null,
    metadataTitle: null,
    metadataDescription: null,
    handlesDetected: [],
    profileEnrichmentAttempted: false,
    profileResults: [],
    profileMetadataCountForAi: 0,
    profileMetadataHandlesForAi: [],
    aiInputProfileMetadata: '[]',
    aiQuery: null,
    aiPlaceName: null,
    aiAddress: null,
    aiConfidence: null,
    aiNeedsUserConfirmation: null,
    chosenQuery: null,
    querySource: null,
    queryConfidence: null,
    accountIdentityUsed: false,
    verifiedProfileSelected: false,
    queryGateAllowed: null,
    queryGateReason: null,
    placesCandidateNames: [],
    finalStatus: null,
    finalReason: null,
    agent: null,
    timeline: [],
  };
}

function truncateShareDebugText(value: string | null | undefined, max = SHARE_DEBUG_TEXT_MAX): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

function sanitizeShareDebugUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncateShareDebugText(url);
  }
}

function detectShareDebugSource(url: string | null | undefined): ShareSource {
  const raw = (url ?? '').toLowerCase();
  if (raw.includes('instagram.com')) return 'instagram';
  if (raw.includes('tiktok.com')) return 'tiktok';
  return 'link';
}

function detectShareDebugHandles(...inputs: Array<string | null | undefined>): string[] {
  const handles = new Set<string>();
  const handleRe = /@([A-Za-z0-9._]{2,30})/g;
  const urlRe = /instagram\.com\/([A-Za-z0-9._]{2,30})\//gi;
  for (const input of inputs) {
    if (!input) continue;
    let match: RegExpExecArray | null;
    while ((match = handleRe.exec(input)) !== null) {
      handles.add(match[1].toLowerCase());
    }
    while ((match = urlRe.exec(input)) !== null) {
      const candidate = match[1].toLowerCase();
      if (!['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(candidate)) {
        handles.add(candidate);
      }
    }
  }
  return [...handles];
}

function formatShareDebugData(data?: Record<string, unknown>): string {
  if (!data) return '';
  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${JSON.stringify(value)}`;
      if (value && typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    });
  return parts.join(' ');
}

function buildProfileDebugReason(profile: {
  blocked?: boolean;
  reasons?: string[];
}): string | null {
  if (profile.blocked) return (profile.reasons ?? []).join(',') || 'blocked';
  return (profile.reasons ?? [])[0] ?? null;
}

export default function ShareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string }>();

  const [url, setUrl] = useState(params.url ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [parsed, setParsed] = useState<ParsedShare | null>(null);
  const [extraction, setExtraction] = useState<PlaceExtraction | null>(null);
  const [aiExtraction, setAiExtraction] = useState<AIExtractResult | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  // For 'multi-choose': IDs of candidates the user has selected to save.
  // Default selection is intentionally EMPTY — users must opt in to each
  // place. See docs/ARCHITECTURE.md "never silently auto-save multiple".
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  // Dev-only debug toggle: lets us inspect what we extracted without ever
  // surfacing it to normal users.
  const [showDebug, setShowDebug] = useState(false);
  const [debugState, setDebugState] = useState<ShareDebugState>(() => createInitialShareDebugState());

  function pushShareDebug(
    marker: string,
    data?: Record<string, unknown>,
    patch?: Partial<ShareDebugState>,
  ) {
    const detail = formatShareDebugData(data);
    if (__DEV__) {
      console.log(detail ? `${marker} ${detail}` : marker);
    }
    setDebugState((prev) => ({
      ...prev,
      ...patch,
      timeline: [...prev.timeline, { marker, detail }],
    }));
  }

  function pushShareDebugEvent(marker: string, data?: Record<string, unknown>) {
    let patch: Partial<ShareDebugState> | undefined;
    if (marker === '[share-debug] BACKEND_RESPONSE_SUMMARY') {
      patch = {
        backendHttpStatus: typeof data?.httpStatus === 'number' ? data.httpStatus : null,
        backendKeys: Array.isArray(data?.keys)
          ? data.keys.filter((key): key is string => typeof key === 'string')
          : [],
        backendStatus: typeof data?.status === 'string' ? data.status : null,
        backendReason: typeof data?.reason === 'string' ? data.reason : null,
      };
    }
    if (marker === '[share-debug] BACKEND_PAYLOAD_UNEXPECTED') {
      patch = {
        ...(patch ?? {}),
        backendHttpStatus: typeof data?.httpStatus === 'number' ? data.httpStatus : null,
        backendKeys: Array.isArray(data?.keys)
          ? data.keys.filter((key): key is string => typeof key === 'string')
          : [],
        backendStatus: typeof data?.status === 'string' ? data.status : null,
        backendReason: typeof data?.reason === 'string' ? data.reason : null,
        backendParseFailureReason: 'unexpected_backend_payload',
      };
    }
    pushShareDebug(marker, data, patch);
  }

  // Best-effort user location, captured once on mount. Used as a
  // soft bias for Google Places when the post itself doesn't supply
  // any geographic context (so a query like "Starbucks" resolves to
  // the closest one). NEVER prompts the user -- we only read the
  // last-known position if foreground permission is already granted.
  const userLatLngRef = useRef<LocationBias | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync({});
        if (!alive || !last) return;
        userLatLngRef.current = {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
        };
        logDebug('share', 'user location available for bias');
      } catch (err) {
        logDebug('share', 'user location lookup skipped', err);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const busy =
    phase === 'parsing' || phase === 'searching' || phase === 'saving';

  // Auto-run when arriving with a URL (cold-start deep link, share intent,
  // or a new deep link delivered while this screen is already mounted).
  // We track the last processed URL so we never re-trigger the flow for
  // the same URL on unrelated re-renders, but a NEW shared URL coming in
  // mid-session (e.g. user shares a second link without backing out) does
  // re-trigger automatically. This is the "skip the paste UI" UX from the
  // V2 native-share flow.
  const lastProcessedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const incoming = params.url?.trim();
    if (!incoming || !isLikelyUrl(incoming)) return;
    if (lastProcessedUrlRef.current === incoming) return;
    lastProcessedUrlRef.current = incoming;
    logDebug('share', 'auto-running from incoming url param', incoming);
    // Cold/warm start from share extension (or deep link with ?url=...).
    void trackEvent('share_received', {
      flow: Platform.OS === 'ios' ? 'ios_share' : 'android_share',
      url_host: safeHostname(incoming),
    });
    void runSaveFlow(incoming).catch((err) => {
      console.warn('[share] save flow failed', (err as Error)?.message ?? err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  // ---------------------------------------------------------------------
  // Main one-tap flow
  // ---------------------------------------------------------------------
  async function runSaveFlow(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!isLikelyUrl(trimmed)) {
      Alert.alert(
        'Paste a valid link',
        'The link should start with http:// or https://',
      );
      return;
    }

    const runtimePath: ShareDebugRuntimePath = Platform.OS === 'android'
      ? 'android_host_app'
      : params.url && isLikelyUrl(trimmed)
        ? 'ios_extension'
        : 'client_only';
    // 2026-05-26: single-line entry log so we can quickly see in adb /
    // metro which path served the share and whether the host app even
    // attempted the Edge Function.
    try {
      const safeHost = safeHostname(trimmed) ?? '(none)';
      console.log(
        `[share] entry_path=${runtimePath} source_url=${safeHost} using_edge_function=${isProcessShareLinkConfigured()}`,
      );
    } catch {
      // logging must never throw
    }
    setDebugState({
      ...createInitialShareDebugState(),
      runtimePath,
      edgeFunctionConfigured: isProcessShareLinkConfigured(),
      extractionPathAttempted: isProcessShareLinkConfigured() ? 'edge_function' : 'legacy_client',
    });
    pushShareDebug('[share-debug] FLOW_START', {
      source: detectShareDebugSource(trimmed),
      url: sanitizeShareDebugUrl(trimmed),
    });
    pushShareDebug('[share-debug] RUNTIME_PATH', { path: runtimePath }, { runtimePath });
    pushShareDebug(
      '[share-debug] EDGE_FUNCTION_CONFIGURED',
      { value: isProcessShareLinkConfigured() },
      { edgeFunctionConfigured: isProcessShareLinkConfigured() },
    );

    setUrl(trimmed);

    // Reset prior attempt state.
    setCandidates([]);
    setFailMessage(null);
    setAiExtraction(null);
    const execute = async () => {

    // ---- 1. parse ------------------------------------------------------
    setPhase('parsing');
    pushShareDebug('[share-debug] METADATA_FETCH_START', {
      url: sanitizeShareDebugUrl(trimmed),
    });
    void trackEvent('share_parse_started', { url_host: safeHostname(trimmed) });
    let parsedResult: ParsedShare;
    try {
      parsedResult = await parseShare(trimmed);
      void trackEvent('share_parse_success', {
        source_type: parsedResult.source,
        url_host: safeHostname(parsedResult.url),
        has_title: !!parsedResult.title,
        has_description: !!parsedResult.description,
        metadata_failed: !!parsedResult.metadataFailed,
      });
    } catch (err) {
      console.warn('[share] parseShare threw', (err as Error)?.message);
      void trackEvent('share_parse_failed', {
        url_host: safeHostname(trimmed),
        error_code: 'parse_threw',
      });
      parsedResult = {
        url: trimmed,
        source: 'link',
        title: null,
        description: null,
        suggestedQuery: null,
        metadataFailed: true,
      };
    }
    setParsed(parsedResult);
    setUrl(parsedResult.url);
    pushShareDebug(
      '[share-debug] METADATA_FETCH_RESULT',
      {
        title: truncateShareDebugText(parsedResult.title),
        description: truncateShareDebugText(parsedResult.description),
      },
      {
        metadataTitle: truncateShareDebugText(parsedResult.title),
        metadataDescription: truncateShareDebugText(parsedResult.description),
      },
    );

    const detectedHandles = detectShareDebugHandles(
      parsedResult.title,
      parsedResult.description,
      parsedResult.url,
    );
    pushShareDebug(
      '[share-debug] HANDLES_DETECTED',
      { handles: detectedHandles },
      { handlesDetected: detectedHandles },
    );
    const profileEnrichmentAvailable =
      parsedResult.source === 'instagram' && isProcessShareLinkConfigured();
    pushShareDebug(
      '[share-debug] PROFILE_ENRICHMENT_AVAILABLE',
      { value: profileEnrichmentAvailable },
      { profileEnrichmentAttempted: profileEnrichmentAvailable },
    );
    if (parsedResult.source === 'instagram') {
      pushShareDebug('[share-debug] PROFILE_ENRICHMENT_REQUESTED', {
        handles: detectedHandles,
      });
    }

    // ---- 2. extract a likely place query (AI-style heuristic) ---------
    // The raw `suggestedQuery` from parseShare is just a cleaned caption.
    // The extractor below tries to surface the *actual venue* (handle, pin
    // emoji, "<Name>, <City>" pattern) instead of the creator name. Today
    // it's a deterministic local heuristic; tomorrow this should call a
    // Supabase Edge Function that proxies an LLM (see TODO in
    // lib/placeExtractor.ts).
    const extracted = extractPlaceQueryFromShareMetadata({
      source: parsedResult.source,
      title: parsedResult.title,
      description: parsedResult.description,
      url: parsedResult.url,
      cleanedQuery: parsedResult.suggestedQuery,
    });
    const accountIdentity = extractAccountIdentityFromShareMetadata({
      source: parsedResult.source,
      title: parsedResult.title,
      description: parsedResult.description,
      url: parsedResult.url,
      cleanedQuery: parsedResult.suggestedQuery,
    });
    setExtraction(extracted);
    logDebug('share', 'heuristic extraction', extracted);

    let serverExtraction = null;
    let serverExtractionError: unknown = null;
    const backendOutcomeRef: { current: ExtractShareOnServerResult | null } = { current: null };
    try {
      serverExtraction = await extractShareOnServer(parsedResult.url, {
        onDebugEvent: (marker, data) => {
          pushShareDebugEvent(marker, data);
        },
        onOutcome: (outcome) => {
          backendOutcomeRef.current = outcome;
        },
      });
      if (serverExtraction) {
        logDebug('share', 'server extraction', {
          query: serverExtraction.query,
          querySource: serverExtraction.querySource,
          searchAllowed: serverExtraction.searchAllowed,
          posterHandle: serverExtraction.posterHandle,
          profileCount: serverExtraction.profileMetadata.length,
        });
        setDebugState((prev) => ({
          ...prev,
          usedClientFallback: false,
          backendParseFailureReason: null,
        }));
      }
    } catch (err) {
      serverExtractionError = err;
      logDebug('share', 'server extraction unavailable', err);
      serverExtraction = null;
    }
    // 2026-05-26: snapshot the structured backend outcome (configured /
    // did-call / http-status / failure-reason) onto the debug state so
    // the visible TestFlight diagnostics panel shows exactly which path
    // the request took and why it failed (if it did).
    {
      const outcome = backendOutcomeRef.current;
      const didCall = outcome?.didCallEdgeFunction ?? null;
      const failureReason = outcome?.failureReason ?? null;
      const httpStatus = outcome?.httpStatus ?? null;
      const serverNull = outcome ? outcome.extraction === null : null;
      setDebugState((prev) => ({
        ...prev,
        didCallProcessShareLink: didCall,
        fallbackReason: failureReason ?? prev.fallbackReason,
        serverReturnedNull: serverNull,
        backendHttpStatus: httpStatus ?? prev.backendHttpStatus,
      }));
    }
    // 2026-05-26: explicit one-line log when we drop to the legacy heuristic
    // path so it's trivial to grep `[share-mobile-debug] fallback_to_legacy`
    // in metro/adb/Console.app and correlate with missing
    // process-share-link Edge Function logs in Supabase.
    if (!serverExtraction) {
      const reason = !isProcessShareLinkConfigured()
        ? 'backend_not_configured'
        : serverExtractionError
          ? (serverExtractionError instanceof Error
              ? serverExtractionError.name
              : 'request_failed')
          : 'no_extraction';
      console.log(
        `[share-mobile-debug] fallback_to_legacy reason=${reason} entry_path=${runtimePath}`,
      );
      setDebugState((prev) => ({
        ...prev,
        legacyExtractionUsed: true,
        extractionPathAttempted: 'legacy_client',
        fallbackReason: prev.fallbackReason ?? reason,
      }));
    } else {
      setDebugState((prev) => ({
        ...prev,
        legacyExtractionUsed: false,
      }));
    }
    const profileResults = (serverExtraction?.profileMetadata ?? []).map((profile) => ({
      handle: profile.handle,
      fetched: profile.fetched ?? null,
      blocked: profile.blocked ?? null,
      reason: buildProfileDebugReason(profile),
      classification: profile.classification ?? null,
      displayName: truncateShareDebugText(profile.displayName),
      extractedName: truncateShareDebugText(profile.extractedName),
      extractedAddress: truncateShareDebugText(profile.extractedAddress),
      extractedCity: truncateShareDebugText(profile.extractedCity),
    }));
    setDebugState((prev) => ({
      ...prev,
      profileResults,
    }));
    for (const profile of serverExtraction?.profileMetadata ?? []) {
      pushShareDebug('[share-debug] PROFILE_FETCH_RESULT', {
        handle: profile.handle,
        fetched: profile.fetched ?? false,
        blocked: profile.blocked ?? false,
        reason: buildProfileDebugReason(profile),
      });
      pushShareDebug('[share-debug] PROFILE_PARSE_RESULT', {
        handle: profile.handle,
        displayName: truncateShareDebugText(profile.displayName) ?? 'null',
        category: truncateShareDebugText(profile.category) ?? 'null',
        extractedName: truncateShareDebugText(profile.extractedName) ?? 'null',
        extractedAddress: truncateShareDebugText(profile.extractedAddress) ?? 'null',
        extractedCity: truncateShareDebugText(profile.extractedCity) ?? 'null',
        classification: profile.classification,
      });
    }
    const verifiedProfileEvidence = getVerifiedProfileEvidence(serverExtraction);

    // ---- 2a. STAGE 3 — agent-driven decision (auto-save included) ---
    // The new backend agent (when configured with GEMINI_API_KEY) returns
    // a structured `agent` block on the extraction payload. When present,
    // we let it drive the FINAL outcome — including silent auto-save —
    // INSTEAD of running the legacy heuristic + Places + ranker pipeline.
    //
    // HARD RULES (also enforced server-side in lib/shareAgent/safety
    // and lib/shareAgent/userFacing — defense-in-depth):
    //   1. Auto-save runs ONLY when BOTH `userFacingDecision === 'auto_save'`
    //      AND `safeToAutoSave === true`. Either being false means we
    //      MUST NOT silent-save.
    //   2. Auto-save also requires a non-null resolvedPlace with a
    //      googlePlaceId from a Places search performed in this run.
    //   3. If the agent could not produce a useful response we fall
    //      through to the legacy pipeline — preserves Stage-0 behavior.
    //   4. UI for candidate / manual paths stays visually identical.
    const agentBlock = serverExtraction?.agent ?? null;
    if (agentBlock) {
      setDebugState((prev) => ({
        ...prev,
        agent: {
          runId: (agentBlock as any).runId ?? '∅',
          promptVersion: agentBlock.promptVersion,
          modelUsed: agentBlock.modelUsed,
          userFacingDecision: agentBlock.userFacingDecision,
          agentDecision: agentBlock.agentDecision,
          safetyDecision: agentBlock.safetyDecision,
          downgradedFromAutoSave: agentBlock.downgradedFromAutoSave,
          safeToAutoSave: agentBlock.safeToAutoSave,
          confidence: agentBlock.confidence,
          reasoning: agentBlock.reasoning,
          evidenceUsed: agentBlock.evidenceUsed,
          rejectionReasons: agentBlock.rejectionReasons,
          toolsUsed: agentBlock.toolsUsed,
          toolCalls: Array.isArray((agentBlock as any).toolCalls)
            ? (agentBlock as any).toolCalls.map((t: any) => ({
                tool: String(t.tool ?? ''),
                status: String(t.status ?? ''),
                note: typeof t.note === 'string' ? t.note : null,
                latencyMs: typeof t.latencyMs === 'number' ? t.latencyMs : null,
              }))
            : [],
          candidates: agentBlock.candidates.map((c) => ({
            googlePlaceId: c.googlePlaceId,
            name: c.name,
            matchScore: c.matchScore,
            rationale: c.rationale,
          })),
          latencyMs: agentBlock.latencyMs,
          warnings: agentBlock.warnings,
        },
      }));
      pushShareDebug('[share-debug] AGENT_DECISION', {
        userFacingDecision: agentBlock.userFacingDecision,
        agentDecision: agentBlock.agentDecision,
        safetyDecision: agentBlock.safetyDecision,
        downgradedFromAutoSave: agentBlock.downgradedFromAutoSave,
        candidateCount: agentBlock.candidates.length,
        confidence: agentBlock.confidence,
        resolvedPlaceName: (agentBlock as any).resolvedPlace?.name ?? null,
        firstCandidateName: agentBlock.candidates[0]?.name ?? null,
        firstCandidateAddress:
          (agentBlock.candidates[0] as any)?.formattedAddress ?? null,
        firstCandidatePlaceId: agentBlock.candidates[0]?.googlePlaceId ?? null,
        cleanSearchQuery: serverExtraction?.query ?? null,
        extractionPlaceName: serverExtraction?.placeName ?? null,
        extractionAddress: serverExtraction?.address ?? null,
      });
      logDebug('share-agent', 'agent block present', {
        userFacingDecision: agentBlock.userFacingDecision,
        candidates: agentBlock.candidates.length,
      });

      const agentCandidates: PlaceCandidate[] = agentBlock.candidates
        .filter(
          (c) =>
            !!c.googlePlaceId &&
            typeof c.latitude === 'number' &&
            typeof c.longitude === 'number',
        )
        .map((c) => ({
          googlePlaceId: c.googlePlaceId,
          name: c.name,
          formattedAddress: c.formattedAddress ?? null,
          latitude: c.latitude as number,
          longitude: c.longitude as number,
          category: (c.types ?? [])[0] ?? null,
          googleMapsUrl: null,
          rawTypes: c.types ?? [],
        }));

      // STAGE 3 — trust the safety-gated decision. Auto-save is a
      // first-class outcome when both `userFacingDecision === 'auto_save'`
      // AND `safeToAutoSave === true`.
      const decision = agentBlock.userFacingDecision;

      if (
        decision === 'auto_save' &&
        agentBlock.safeToAutoSave === true &&
        agentCandidates.length > 0
      ) {
        const top = agentCandidates[0];
        setDebugState((prev) => ({
          ...prev,
          finalStatus: 'agent_auto_save',
          finalReason: null,
          placesCandidateNames: agentCandidates.map((c) => c.name),
        }));
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'agent_auto_save',
          reason: null,
          place: top.name,
        });
        await saveCandidate(top, parsedResult.url, parsedResult.source);
        return;
      }

      if (
        (decision === 'candidate_confirmation' || decision === ('candidate_picker' as any)) &&
        agentCandidates.length > 0
      ) {
        setCandidates(agentCandidates);
        setPhase('choose');
        setDebugState((prev) => ({
          ...prev,
          finalStatus: 'agent_candidate_confirmation',
          finalReason: agentBlock.downgradedFromAutoSave ? 'downgraded_from_auto_save' : null,
          placesCandidateNames: agentCandidates.map((c) => c.name),
        }));
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'agent_candidate_confirmation',
          reason: null,
        });
        return;
      }

      if (
        decision === ('multi_candidate_confirmation' as any) &&
        agentCandidates.length >= 2
      ) {
        // Dedupe by googlePlaceId defensively in case the backend
        // ever surfaces duplicates. Order from backend is preserved.
        const seen = new Set<string>();
        const deduped = agentCandidates.filter((c) => {
          if (!c.googlePlaceId || seen.has(c.googlePlaceId)) return false;
          seen.add(c.googlePlaceId);
          return true;
        });
        const capped = deduped.slice(0, 10);
        setCandidates(capped);
        setMultiSelectedIds(new Set<string>());
        setPhase('multi-choose');
        setDebugState((prev) => ({
          ...prev,
          finalStatus: 'agent_multi_candidate_confirmation',
          finalReason: null,
          placesCandidateNames: capped.map((c) => c.name),
        }));
        pushShareDebug('[share-multi] CANDIDATES_PRESENTED', {
          candidate_count: agentCandidates.length,
          deduped_count: capped.length,
        });
        return;
      }
      // 2026-05-27 — defense-in-depth: if the agent returned ANY usable
      // candidates but the decision string is something we don't model
      // (e.g. future 'candidate_picker'-only variants), surface them
      // anyway instead of dropping to legacy + "No place found".
      if (agentCandidates.length > 0 && decision !== 'manual_fallback' && decision !== 'auto_save') {
        setCandidates(agentCandidates);
        setPhase('choose');
        setDebugState((prev) => ({
          ...prev,
          finalStatus: 'agent_candidate_confirmation',
          finalReason: `unknown_decision_${decision}`,
          placesCandidateNames: agentCandidates.map((c) => c.name),
        }));
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'agent_candidate_confirmation',
          reason: `unknown_decision_${decision}`,
        });
        return;
      }

      if (decision === 'manual_fallback') {
        setFailMessage(FAIL_NO_QUERY);
        // 2026-05-27 — prefer a name-led query over a raw street address
        // for the manual search input. Pre-filling "126 Main St,
        // Huntington Beach, CA" is useless to a user trying to find
        // "2nd Floor"; pre-filling "2nd Floor Huntington Beach"
        // actually lets them tap once and find the place.
        const fallbackParts: string[] = [];
        const sePlace = serverExtraction?.placeName;
        const seCity = serverExtraction?.city;
        const seState = serverExtraction?.state;
        const seAddr = serverExtraction?.address;
        if (sePlace) fallbackParts.push(sePlace);
        if (seCity) fallbackParts.push(seCity);
        else if (seAddr && !sePlace) fallbackParts.push(seAddr);
        if (seState && fallbackParts.length > 0 && !fallbackParts.join(' ').includes(seState)) {
          fallbackParts.push(seState);
        }
        const fallbackQuery =
          fallbackParts.join(' ').trim() ||
          serverExtraction?.query ||
          extracted?.query ||
          '';
        setManualQuery(fallbackQuery);
        setPhase('failed');
        setDebugState((prev) => ({
          ...prev,
          finalStatus: 'agent_manual_fallback',
          finalReason: agentBlock.rejectionReasons[0] ?? null,
        }));
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'agent_manual_fallback',
          reason: agentBlock.rejectionReasons[0] ?? null,
        });
        return;
      }

      // decision === 'failed' or candidate_confirmation with no usable
      // candidates — fall through to the legacy pipeline below.
      logDebug('share-agent', 'agent decision unusable, falling through', {
        decision,
        candidateCount: agentCandidates.length,
      });
    }

    // ---- 2b. AI enhancement (best-effort, never blocks) ---------------
    // extractPlaceAI is guaranteed never to throw and falls back to a
    // low-confidence wrapper around fallbackQuery when GEMINI_API_KEY is
    // not present (i.e. in the mobile bundle). That means in production
    // RN this is a fast no-op; only server / EAS-with-secret builds will
    // actually hit Gemini. UI must never block on AI failure.
    let ai: AIExtractResult | null = null;
    if (!serverExtraction) {
      pushShareDebug(
        '[share-debug] PROFILE_METADATA_FOR_AI',
        { count: 0, handles: [] },
        {
          profileMetadataCountForAi: 0,
          profileMetadataHandlesForAi: [],
          aiInputProfileMetadata: '[]',
          usedClientFallback: true,
        },
      );
      pushShareDebug('[share-debug] AI_INPUT_PROFILE_METADATA', {
        profileMetadata: '[]',
      });
      try {
        ai = await extractPlaceAI({
          sourceType: parsedResult.source,
          url: parsedResult.url,
          title: parsedResult.title ?? undefined,
          description: parsedResult.description ?? undefined,
          fallbackQuery: extracted?.query,
        });
        setAiExtraction(ai);
        logDebug('share', 'ai extraction', {
          query: ai.query,
          confidence: ai.confidence,
        });
        pushShareDebug(
          '[share-debug] AI_OUTPUT',
          {
            query: truncateShareDebugText(ai.query),
            placeName: truncateShareDebugText(ai.placeName),
            address: truncateShareDebugText(ai.address),
            confidence: ai.confidence,
            needsUserConfirmation: ai.needsUserConfirmation ?? false,
          },
          {
            aiQuery: truncateShareDebugText(ai.query),
            aiPlaceName: truncateShareDebugText(ai.placeName),
            aiAddress: truncateShareDebugText(ai.address),
            aiConfidence: ai.confidence,
            aiNeedsUserConfirmation: ai.needsUserConfirmation ?? null,
          },
        );
      } catch (err) {
        // extractPlaceAI is no-throw, but be defensive anyway.
        console.warn('[share] ai extraction threw (ignored)', (err as Error)?.message);
        ai = null;
      }
    } else {
      const profileHandlesForAi = serverExtraction.profileMetadata.map((profile) => profile.handle);
      const aiInputProfileMetadata = JSON.stringify(
        serverExtraction.profileMetadata.map((profile) => ({
          handle: profile.handle,
          classification: profile.classification,
          displayName: truncateShareDebugText(profile.displayName),
          extractedName: truncateShareDebugText(profile.extractedName),
          extractedAddress: truncateShareDebugText(profile.extractedAddress),
          extractedCity: truncateShareDebugText(profile.extractedCity),
        })),
      );
      pushShareDebug(
        '[share-debug] PROFILE_METADATA_FOR_AI',
        { count: profileHandlesForAi.length, handles: profileHandlesForAi },
        {
          profileMetadataCountForAi: profileHandlesForAi.length,
          profileMetadataHandlesForAi: profileHandlesForAi,
          aiInputProfileMetadata,
          usedClientFallback: false,
        },
      );
      pushShareDebug('[share-debug] AI_INPUT_PROFILE_METADATA', {
        profileMetadata: aiInputProfileMetadata,
      });
      pushShareDebug(
        '[share-debug] AI_OUTPUT',
        {
          query: truncateShareDebugText(serverExtraction.query),
          placeName: truncateShareDebugText(serverExtraction.placeName),
          address: truncateShareDebugText(serverExtraction.address),
          confidence: serverExtraction.confidence,
          needsUserConfirmation: !serverExtraction.searchAllowed,
        },
        {
          aiQuery: truncateShareDebugText(serverExtraction.query),
          aiPlaceName: truncateShareDebugText(serverExtraction.placeName),
          aiAddress: truncateShareDebugText(serverExtraction.address),
          aiConfidence: serverExtraction.confidence,
          aiNeedsUserConfirmation: !serverExtraction.searchAllowed,
        },
      );
      setAiExtraction(null);
    }

    // ---- 2c. decide which query to use --------------------------------
    // We ALWAYS run a Places search if we have any usable query string,
    // even if confidence is low. Stopping at the manual card before even
    // trying Google Places was a dead-end -- Places frequently rescues a
    // mediocre query (it's how this app is supposed to work). The picker
    // / address resolver below is what handles uncertainty, not a manual
    // search prompt.
    let chosenQuery: string | null = null;
    let chosenConfidence: 'high' | 'medium' | 'low' = 'low';
    let chosenReason: string | null = null;
    let accountIdentityUsed = false;
    if (serverExtraction) {
      chosenQuery = serverExtraction.query || null;
      chosenConfidence = serverExtraction.confidence;
      chosenReason = serverExtraction.querySource === 'none' ? null : serverExtraction.querySource;
      accountIdentityUsed =
        serverExtraction.querySource === 'account_display_name' ||
        serverExtraction.querySource === 'account_handle';
    } else if (ai && ai.confidence === 'high' && ai.query) {
      chosenQuery = ai.query;
      chosenConfidence = 'high';
      chosenReason = 'ai-high';
    } else if (ai && ai.confidence === 'medium' && ai.query) {
      chosenQuery = ai.query;
      chosenConfidence = 'medium';
      chosenReason = 'ai-medium';
    } else if (extracted && extracted.confidence !== 'low' && extracted.query) {
      chosenQuery = extracted.query;
      chosenConfidence = extracted.confidence;
      chosenReason = extracted.reason ?? null;
    } else if (extracted && extracted.query) {
      chosenQuery = extracted.query;
      chosenConfidence = 'low';
      chosenReason = extracted.reason ?? null;
    } else if (accountIdentity && accountIdentity.query) {
      chosenQuery = accountIdentity.query;
      chosenConfidence = accountIdentity.confidence;
      chosenReason = accountIdentity.reason;
      accountIdentityUsed = true;
    } else if (ai && ai.query) {
      chosenQuery = ai.query;
      chosenConfidence = 'low';
      chosenReason = 'ai-low';
    } else if (parsedResult.suggestedQuery) {
      chosenQuery = parsedResult.suggestedQuery;
      chosenConfidence = 'low';
      chosenReason = 'suggested-query';
    }

    logDebug('share', 'flow chose query', {
      chosenQuery,
      chosenConfidence,
      chosenReason,
      heuristic: extracted?.query,
      ai: ai?.query,
    });
    const preliminaryStrength = classifyPlaceQueryStrength({
      query: chosenQuery,
      extractionReason: chosenReason,
      confidence: chosenConfidence,
      accountIdentityUsed: false,
    });
    if (!serverExtraction && accountIdentity?.query && preliminaryStrength === 'weak') {
      chosenQuery = accountIdentity.query;
      chosenConfidence = accountIdentity.confidence;
      chosenReason = accountIdentity.reason;
      accountIdentityUsed = true;
    }
    pushShareDebug(
      '[share-debug] QUERY_SELECTION',
      {
        chosenQuery: truncateShareDebugText(chosenQuery),
        source: chosenReason ?? 'none',
        confidence: chosenConfidence,
        accountIdentityUsed,
        verifiedProfile: !!verifiedProfileEvidence,
      },
      {
        chosenQuery: truncateShareDebugText(chosenQuery),
        querySource: chosenReason,
        queryConfidence: chosenConfidence,
        accountIdentityUsed,
        verifiedProfileSelected: !!verifiedProfileEvidence,
      },
    );

    if (!chosenQuery) {
      // We couldn't synthesize ANY query at all -- only here do we fall
      // back to manual search.
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: 'no_query',
      }, {
        finalStatus: 'failed_requires_app',
        finalReason: 'no_query',
      });
      setFailMessage(FAIL_NO_QUERY);
      setManualQuery('');
      setPhase('failed');
      return;
    }

    // ---- 3. derive location context (best-effort) -------------------
    // We pull a free-text location hint from the description -- usually
    // the text after a 📍 pin emoji or a trailing ", City, ST" pattern.
    // Then we resolve it to lat/lng via the same Places textsearch API
    // we already use (no new endpoint). This becomes the bias coordinate
    // for the actual business search and the anchor for franchise
    // ranking.
    const contextText =
      serverExtraction?.sourceContext ??
      extractLocationContext(
        [parsedResult.title, parsedResult.description]
          .filter(Boolean)
          .join('\n'),
      ) ?? null;
    let contextLatLng: LocationBias | null = null;
    if (contextText) {
      try {
        contextLatLng = await geocodeContextText(contextText);
      } catch {
        contextLatLng = null;
      }
      logDebug('share', 'location context', {
        contextText,
        resolved: !!contextLatLng,
      });
    }

    const queryStrength = classifyPlaceQueryStrength({
      query: chosenQuery,
      extractionReason: chosenReason,
      confidence: chosenConfidence,
      sourceContextText: contextText,
      accountIdentityUsed,
    });
    logDebug('share-extract', `query_strength=${queryStrength}`);
    logDebug('share-extract', `account_identity_used=${accountIdentityUsed}`);
    if (accountIdentity?.query) {
      logDebug('share-rank', `account_query=${accountIdentity.query}`);
    }

    // ---- 3b. Evidence-based extraction pipeline (v2) ------------------
    // The pipeline is the AUTHORITATIVE silent-save gate. The earlier
    // heuristic (`extractPlaceQueryFromShareMetadata`) and AI step still
    // build the Places query; the pipeline decides whether the resulting
    // candidate may be silently saved without user confirmation.
    //
    // On device we have no IG profile enrichment and no transcription, so
    // the pipeline runs caption-only. That means handle-derived queries
    // never satisfy the auto-save gate here -- the Edge Function's
    // silent-save path handles those when bio enrichment is available.
    const extractionResult = runExtractionPipeline({
      source: parsedResult.source,
      url: parsedResult.url,
      title: parsedResult.title,
      description: parsedResult.description,
      cleanedQuery: parsedResult.suggestedQuery,
      posterHandle: serverExtraction?.posterHandle ?? undefined,
      enrichments: serverExtraction?.profileMetadata.map((profile) => ({
        handle: profile.handle,
        classification: profile.classification,
        category: profile.category,
        displayName: profile.displayName,
        extractedName: profile.extractedName,
        extractedAddress: profile.extractedAddress,
        extractedCity: profile.extractedCity,
        confidence: profile.confidence,
      })),
      ai: serverExtraction
        ? {
            query: serverExtraction.query,
            placeName: serverExtraction.placeName,
            address: serverExtraction.address,
            city: serverExtraction.city,
            state: serverExtraction.state,
            posterType: serverExtraction.posterType,
            taggedAccounts: serverExtraction.taggedAccounts,
            confidence: serverExtraction.confidence,
            reason: serverExtraction.querySource,
            needsUserConfirmation: !serverExtraction.searchAllowed,
          }
        : ai
          ? {
              query: ai.query,
              placeName: ai.placeName ?? null,
              address: ai.address ?? null,
              city: ai.city ?? null,
              state: ai.state ?? null,
              posterType: ai.posterType,
              taggedAccounts: ai.taggedAccounts,
              confidence: ai.confidence,
              reason: ai.reason,
              needsUserConfirmation: ai.needsUserConfirmation,
            }
          : null,
    });
    logDebug('share-extract', `evidence=${JSON.stringify(extractionResult.evidence)}`);
    logDebug('share-extract', `poster_type=${extractionResult.posterType}`);
    logDebug('share-extract', `address_found=${!!extractionResult.address}`);
    logDebug('share-extract', `handle_used=${extractionResult.evidence.handleUsed}`);
    logDebug('share-rank', `auto_save_allowed=${extractionResult.autoSaveAllowed}`);
    if (!extractionResult.autoSaveAllowed && extractionResult.needsConfirmationReason) {
      logDebug('share-rank', `auto_save_blocked_reason=${extractionResult.needsConfirmationReason}`);
    }

    const queryKind = classifyExtractedQuery(chosenQuery, {
      title: parsedResult.title,
      description: parsedResult.description,
      placeName: extractionResult.placeName,
      address: extractionResult.address,
      city: extractionResult.city,
      state: extractionResult.state,
      sourceContext: extractionResult.sourceContext,
      transcript: null,
      ai,
      profileExtractedName: verifiedProfileEvidence?.extractedName ?? null,
      profileExtractedAddress: verifiedProfileEvidence?.extractedAddress ?? null,
      profileExtractedCity: verifiedProfileEvidence?.extractedCity ?? null,
      accountIdentityOnly: accountIdentityUsed,
      accountIdentitySource: accountIdentityUsed ? chosenReason : null,
    });
    logDebug('share-extract', `query_kind=${queryKind}`);
    const queryGateAllowed = shouldSearchPlaces(chosenQuery, {
      title: parsedResult.title,
      description: parsedResult.description,
      placeName: extractionResult.placeName,
      address: extractionResult.address,
      city: extractionResult.city,
      state: extractionResult.state,
      sourceContext: extractionResult.sourceContext,
      transcript: null,
      ai,
      profileExtractedName: verifiedProfileEvidence?.extractedName ?? null,
      profileExtractedAddress: verifiedProfileEvidence?.extractedAddress ?? null,
      profileExtractedCity: verifiedProfileEvidence?.extractedCity ?? null,
      accountIdentityOnly: accountIdentityUsed,
      accountIdentitySource: accountIdentityUsed ? chosenReason : null,
    });
    const queryGateReason = queryGateAllowed
      ? null
      : (queryKind === 'empty' ? 'no_query' : 'generic_query_no_place_evidence');
    pushShareDebug(
      '[share-debug] QUERY_GATE',
      { allowed: queryGateAllowed, reason: queryGateReason ?? 'passed' },
      { queryGateAllowed, queryGateReason },
    );
    if (!queryGateAllowed) {
      logInfo('share-rank', 'auto_save_blocked_reason=generic_query_no_place_evidence');
      setDebugState((prev) => ({
        ...prev,
        finalStatus: 'failed_requires_app',
        finalReason: queryGateReason,
      }));
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: queryGateReason,
      });
      setFailMessage(FAIL_NO_QUERY);
      setManualQuery('');
      setPhase('failed');
      return;
    }

    // ---- 3c. Address-first verification gate --------------------------
    // When the pipeline detected a literal street address in the share
    // (caption or bio), do NOT trust device location or the city-bias
    // textsearch. Geocode the address to a rooftop coordinate, then
    // require a real business within ADDRESS_VERIFY_RADIUS_M of that
    // point — and a strong name match when a place name was extracted —
    // before silently saving.
    let addressContextLatLng: LocationBias | null = contextLatLng;
    if (extractionResult.address) {
      logDebug('share-geocode', `address_found=${extractionResult.address}`);
      const verification = await verifyPlaceAtAddress(
        extractionResult.address,
        extractionResult.placeName,
      );
      logDebug('share-geocode', `geocode_success=${verification.geocoded !== null}`);
      if (verification.status === 'verified') {
        logDebug('share-geocode', `candidate_distance_m=${Math.round(verification.distanceMeters)} verified=true`);
        await saveCandidate(
          verification.candidate,
          parsedResult.url,
          parsedResult.source,
        );
        return;
      }
      if (verification.status === 'ambiguous') {
        logInfo('share-geocode', 'verified=false ambiguous_after_address_verify');
        setCandidates(verification.candidates);
        setPhase('choose');
        return;
      }
      // status === 'failed'
      console.warn(
        `[share-geocode] verified=false address_verification_failed_reason=${verification.reason}`,
      );
      // If we got a real geocode but no business matched, prefer the
      // rooftop coordinate over the city-scale bias for the fallback
      // search. Device location must NEVER override an address.
      if (verification.geocoded) {
        addressContextLatLng = {
          lat: verification.geocoded.latitude,
          lng: verification.geocoded.longitude,
        };
      }
    }

    // ---- 4. search Google Places --------------------------------------
    await runSearchAndMaybeSave(
      chosenQuery,
      parsedResult.url,
      parsedResult.source,
      chosenConfidence,
      queryStrength,
      {
        chosenReason,
        accountIdentityUsed,
        requiredNameHint:
          serverExtraction?.requiredNameHint ??
          verifiedProfileEvidence?.extractedName ??
          extractionResult.placeName,
      },
      { contextText, contextLatLng: addressContextLatLng },
      extractionResult,
    );
    };

    try {
      await execute();
    } catch (err) {
      const message = (err as Error)?.message ?? FAIL_GENERIC;
      if (isInvalidRegexError(err)) {
        console.warn('[share] regex/parsing failed', message);
      } else {
        console.warn('[share] extraction failed', message);
      }
      console.warn('[share] save flow failed', message);
      setFailMessage(FAIL_GENERIC);
      setPhase('failed');
      Alert.alert("Couldn't save link", FAIL_GENERIC);
    } finally {
      logDebug('share', 'save flow finished');
    }
  }

  async function runSearchAndMaybeSave(
    query: string,
    sourceUrl: string,
    sourceType: ShareSource,
    chosenConfidence: 'high' | 'medium' | 'low' = 'low',
    queryStrength: PlaceQueryStrength = 'weak',
    queryEvidence: {
      chosenReason: string | null;
      accountIdentityUsed: boolean;
      requiredNameHint?: string | null;
    } = { chosenReason: null, accountIdentityUsed: false, requiredNameHint: null },
    locationCtx: {
      contextText: string | null;
      contextLatLng: LocationBias | null;
    } = { contextText: null, contextLatLng: null },
    extractionResult: ExtractionResult | null = null,
  ) {
    setPhase('searching');
    // Bias priority: explicit post context > user device location > none.
    const bias: LocationBias | undefined =
      locationCtx.contextLatLng ?? userLatLngRef.current ?? undefined;
    logDebug('share-rank', `source_context=${locationCtx.contextText ?? 'none'}`);
    logDebug('share-rank', `context_bias_used=${!!locationCtx.contextLatLng}`);
    logDebug('share-rank', `device_bias_used=${!locationCtx.contextLatLng && !!userLatLngRef.current}`);
    let results: PlaceCandidate[] = [];
    try {
      pushShareDebug('[share-debug] PLACES_SEARCH_START', {
        query: truncateShareDebugText(query),
      });
      results = await searchPlaces(query, bias);
    } catch (err) {
      const msg =
        err instanceof PlacesError
          ? placesErrorMessage(err)
          : ((err as Error)?.message ?? FAIL_GENERIC);
      console.warn('[share] searchPlaces failed', msg);
      void trackEvent('save_failed', {
        source_type: sourceType,
        flow:
          params.url && isLikelyUrl(params.url)
            ? 'share_extension'
            : 'paste_link',
        query,
        error_code: err instanceof PlacesError ? err.code : 'places_threw',
        confidence: chosenConfidence,
      });
      setFailMessage(msg);
      setManualQuery(query);
      setPhase('failed');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'open_app',
        reason: err instanceof PlacesError ? err.code : 'places_threw',
      }, {
        finalStatus: 'open_app',
        finalReason: err instanceof PlacesError ? err.code : 'places_threw',
      });
      return;
    }

    logDebug('share', 'places results', { query, count: results.length });
    pushShareDebug(
      '[share-debug] PLACES_SEARCH_RESULT',
      {
        count: results.length,
        names: results.slice(0, 5).map((result) => result.name),
      },
      { placesCandidateNames: results.slice(0, 5).map((result) => result.name) },
    );

    if (results.length === 0) {
      void trackEvent('save_failed', {
        source_type: sourceType,
        flow:
          params.url && isLikelyUrl(params.url)
            ? 'share_extension'
            : 'paste_link',
        query,
        candidate_count: 0,
        error_code: 'no_results',
        confidence: chosenConfidence,
      });
      setFailMessage(FAIL_NO_RESULTS);
      setManualQuery(query);
      setPhase('failed');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: 'no_results',
      }, {
        finalStatus: 'failed_requires_app',
        finalReason: 'no_results',
      });
      return;
    }

    // ---- Address-vs-business resolution -------------------------------
    // Google's textsearch sometimes returns a street_address / premise as
    // the top hit when the query is loose (e.g. an AI-extracted query that
    // included the address but not the business name). Saving "355 S
    // Atlantic Blvd" as the place name is bad UX -- the user expects the
    // actual business. Try to resolve any address-like result to the
    // nearest matching business via a tiny biased textsearch.
    const resolved: PlaceCandidate[] = [];
    for (const c of results) {
      if (!isAddressLikePlace(c)) {
        resolved.push(c);
        continue;
      }
      const business = await resolveBusinessNearAddress(c, query);
      if (business) {
        resolved.push(business);
      } else {
        // Couldn't resolve -- keep the address candidate so the user can
        // still see something rather than silently dropping it.
        resolved.push(c);
      }
    }
    // Deduplicate by googlePlaceId in case the resolver surfaced a
    // business that was also already in the original list.
    const seen = new Set<string>();
    const dedupedResults = resolved.filter((c) => {
      if (!c.googlePlaceId) return true;
      if (seen.has(c.googlePlaceId)) return false;
      seen.add(c.googlePlaceId);
      return true;
    });

    // Re-rank: push neighborhood / city / state results to the bottom when
    // the query clearly mentioned a business-y token (a non-stopword that
    // isn't itself just geography). This prevents auto-saving "Highland
    // Park" when Villa's Tacos is also in the result set.
    const queryHasBusinessToken = looksLikeBusinessQuery(query);
    const localityRanked = queryHasBusinessToken
      ? [
          ...dedupedResults.filter((c) => !isLocalityLikePlace(c)),
          ...dedupedResults.filter((c) => isLocalityLikePlace(c)),
        ]
      : dedupedResults;

    // ---- Franchise / multi-location resolution -----------------------
    // If the query looks like a chain ("Starbucks") or Google returned
    // several same-named candidates in different cities, re-rank by
    // closeness to (a) post location context, else (b) user location.
    // Without any anchor we leave Google's ordering alone -- showing a
    // candidate list is the safest UX.
    const isMultiLocation = isLikelyMultiLocationPlace(query, localityRanked);
    const rankingContext = {
      extractedBusinessName: queryEvidence.requiredNameHint ?? extractionResult?.placeName ?? query,
      contextLatLng: locationCtx.contextLatLng ?? undefined,
      contextText: locationCtx.contextText ?? undefined,
      userLatLng: locationCtx.contextLatLng ? undefined : userLatLngRef.current ?? undefined,
    };
    const rankAnchor: LocationBias | null =
      rankingContext.contextLatLng ?? rankingContext.userLatLng ?? null;
    const rankedResults = rankPlaceCandidates(localityRanked, rankingContext);
    const finalResults = rankedResults.filter((candidate) => {
      const rejection = getShareCandidateRejectionReason(candidate, rankingContext);
      if (rejection) {
        logDebug('share-rank', `rejected_candidate_reason=${rejection}`);
        return false;
      }
      return true;
    });

    if (finalResults.length === 0) {
      logInfo('share-rank', 'auto_save_blocked_reason=no_trusted_candidates');
      void trackEvent('save_failed', {
        source_type: sourceType,
        flow:
          params.url && isLikelyUrl(params.url)
            ? 'share_extension'
            : 'paste_link',
        query,
        candidate_count: 0,
        error_code: 'no_trusted_candidates',
        confidence: chosenConfidence,
      });
      setFailMessage(FAIL_NO_RESULTS);
      setManualQuery(query);
      setPhase('failed');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: 'no_trusted_candidates',
      }, {
        finalStatus: 'failed_requires_app',
        finalReason: 'no_trusted_candidates',
      });
      return;
    }
    logDebug('places', 'franchise resolution', {
      query,
      isMultiLocation,
      contextText: locationCtx.contextText,
      hasContextLatLng: !!locationCtx.contextLatLng,
      hasUserLatLng: !!userLatLngRef.current,
      chosen: finalResults[0]?.name ?? null,
      candidateCount: finalResults.length,
    });

    logDebug('share-rank', 'candidates', finalResults.slice(0, 5).map((candidate) => ({
      name: candidate.name,
      address: candidate.formattedAddress ?? null,
      googlePlaceId: candidate.googlePlaceId ?? null,
    })));

    const hasSourceContext = !!locationCtx.contextLatLng;
    const strongMatchCandidates = finalResults.filter((candidate) =>
      hasStrongNameMatch(
        candidate,
        queryEvidence.requiredNameHint ?? extractionResult?.placeName ?? query,
      ),
    );
    const accountIdentityOnly =
      queryEvidence.accountIdentityUsed ||
      isAccountIdentityReason(queryEvidence.chosenReason);
    const explicitAddressSignal = isExplicitAddressQuery(query);
    const explicitSourceBusinessSignal = hasExplicitSourceBusinessSignal(
      queryEvidence.chosenReason,
    );
    const nameMatchTarget =
      queryEvidence.requiredNameHint ?? extractionResult?.placeName ?? query;
    const topHasStrongAutoSaveEvidence = (candidate: PlaceCandidate): boolean =>
      explicitAddressSignal ||
      (hasSourceContext && hasStrongNameMatch(candidate, nameMatchTarget)) ||
      (explicitSourceBusinessSignal && hasStrongNameMatch(candidate, nameMatchTarget));

    // Pipeline gate (v2). The evidence-based pipeline is authoritative for
    // the silent-save decision. If it says "do not auto-save", we always
    // surface the candidate picker -- never save silently -- regardless of
    // what the legacy heuristics would have allowed.
    const pipelineBlocksAutoSave =
      extractionResult !== null && extractionResult.autoSaveAllowed === false;
    if (pipelineBlocksAutoSave) {
      const reason = extractionResult?.needsConfirmationReason ?? 'pipeline_blocked';
      logInfo('share-rank', `auto_save_blocked_reason=${reason}`);
      if (strongMatchCandidates.length > 0) {
        setCandidates(strongMatchCandidates.slice(0, 5));
      } else {
        setCandidates(finalResults.slice(0, 5));
      }
      setPhase('choose');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'ambiguous',
        reason,
      }, {
        finalStatus: 'ambiguous',
        finalReason: reason,
        placesCandidateNames: finalResults.slice(0, 5).map((candidate) => candidate.name),
      });
      return;
    }

    if (queryStrength === 'weak') {
      logInfo('share-rank', 'auto_save_blocked_reason=weak_query');
      if (strongMatchCandidates.length > 0) {
        logInfo('share-rank', 'auto_save_blocked_reason=needs_user_confirmation');
        setCandidates(strongMatchCandidates.slice(0, 5));
        setPhase('choose');
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'ambiguous',
          reason: 'weak_query',
        }, {
          finalStatus: 'ambiguous',
          finalReason: 'weak_query',
          placesCandidateNames: strongMatchCandidates.slice(0, 5).map((candidate) => candidate.name),
        });
        return;
      }
      setFailMessage(FAIL_NO_RESULTS);
      setManualQuery(query);
      setPhase('failed');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: 'weak_query',
      }, {
        finalStatus: 'failed_requires_app',
        finalReason: 'weak_query',
      });
      return;
    }

    // Strong-match heuristic: exactly one result. Save it -- even if it's
    // address-like. Saving "355 S Atlantic Blvd" is strictly better UX
    // than a dead-end manual card; the user can always rename or delete.
    if (finalResults.length === 1) {
      const only = finalResults[0];
      // Exception: a single locality / neighborhood result paired with a
      // query that clearly named a business is almost always wrong (e.g.
      // saving "Highland Park" instead of Villa's Tacos). Surface the
      // candidate as a single-row picker so the user can confirm or open
      // manual search instead of silently saving the neighborhood.
      if (queryHasBusinessToken && isLocalityLikePlace(only)) {
        logDebug('share', 'flow', {
          extractedQuery: query,
          placesCount: results.length,
          topCandidate: results[0]?.name,
          addressLike: isAddressLikePlace(results[0]),
          resolvedCandidate: only.name,
          candidatesShown: 1,
          reason: 'single-locality-needs-confirmation',
        });
        setCandidates(finalResults);
        setPhase('choose');
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'ambiguous',
          reason: 'single_locality_needs_confirmation',
        }, {
          finalStatus: 'ambiguous',
          finalReason: 'single_locality_needs_confirmation',
          placesCandidateNames: finalResults.map((candidate) => candidate.name),
        });
        return;
      }
      if (!hasMeaningfulNameMatch(only, nameMatchTarget)) {
        logInfo('share-rank', 'rejected_candidate_reason=name_mismatch');
        setFailMessage(FAIL_NO_RESULTS);
        setManualQuery(query);
        setPhase('failed');
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'failed_requires_app',
          reason: 'name_mismatch',
        }, {
          finalStatus: 'failed_requires_app',
          finalReason: 'name_mismatch',
        });
        return;
      }
      if (accountIdentityOnly && !hasSourceContext) {
        logInfo('share-rank', 'auto_save_blocked_reason=account_identity_not_enough');
        setCandidates(strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults);
        setPhase('choose');
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'ambiguous',
          reason: 'account_identity_not_enough',
        }, {
          finalStatus: 'ambiguous',
          finalReason: 'account_identity_not_enough',
          placesCandidateNames: (strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults).map((candidate) => candidate.name),
        });
        return;
      }
      if (!topHasStrongAutoSaveEvidence(only)) {
        logInfo(
          'share-rank',
          `auto_save_blocked_reason=${hasSourceContext ? 'needs_user_confirmation' : 'no_source_context_name_not_strong'}`,
        );
        setCandidates(strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults);
        setPhase('choose');
        pushShareDebug('[share-debug] FINAL_RESULT', {
          status: 'ambiguous',
          reason: hasSourceContext ? 'needs_user_confirmation' : 'no_source_context_name_not_strong',
        }, {
          finalStatus: 'ambiguous',
          finalReason: hasSourceContext ? 'needs_user_confirmation' : 'no_source_context_name_not_strong',
          placesCandidateNames: (strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults).map((candidate) => candidate.name),
        });
        return;
      }
      logDebug('share', 'flow', {
        extractedQuery: query,
        placesCount: results.length,
        topCandidate: results[0]?.name,
        addressLike: isAddressLikePlace(results[0]),
        resolvedCandidate: only.name,
        candidatesShown: 0,
        reason: 'single-result-auto-save',
      });
      await saveCandidate(only, sourceUrl, sourceType);
      return;
    }

    // Multiple results: only auto-pick the top when confidence is high
    // AND the top is a real business. Anything else → candidate picker.
    // For franchise queries with a usable rank anchor, also auto-save
    // the best-ranked branch even at medium confidence -- the rank
    // already biased it to the right city / closest branch.
    if (
      chosenConfidence === 'high' &&
      finalResults.length > 1 &&
      !isAddressLikePlace(finalResults[0]) &&
      !isLocalityLikePlace(finalResults[0]) &&
      hasMeaningfulNameMatch(finalResults[0], nameMatchTarget) &&
      topHasStrongAutoSaveEvidence(finalResults[0]) &&
      !accountIdentityOnly
    ) {
      logDebug('share', 'flow', {
        extractedQuery: query,
        placesCount: results.length,
        topCandidate: results[0]?.name,
        addressLike: isAddressLikePlace(results[0]),
        resolvedCandidate: finalResults[0].name,
        candidatesShown: 0,
        reason: 'high-confidence-auto-save',
      });
      await saveCandidate(finalResults[0], sourceUrl, sourceType);
      return;
    }

    // Franchise auto-save: when we know it's a chain, have a rank anchor,
    // and the top-ranked candidate is a business (not a locality), it's
    // the closest branch to the post / user. Save it.
    if (
      isMultiLocation &&
      locationCtx.contextLatLng &&
      rankAnchor &&
      finalResults.length > 0 &&
      !isLocalityLikePlace(finalResults[0]) &&
      !isAddressLikePlace(finalResults[0]) &&
      hasMeaningfulNameMatch(finalResults[0], nameMatchTarget) &&
      topHasStrongAutoSaveEvidence(finalResults[0]) &&
      !accountIdentityOnly
    ) {
      logDebug('share', 'flow', {
        extractedQuery: query,
        placesCount: results.length,
        topCandidate: results[0]?.name,
        resolvedCandidate: finalResults[0].name,
        candidatesShown: 0,
        reason: 'franchise-closest-branch-auto-save',
      });
      await saveCandidate(finalResults[0], sourceUrl, sourceType);
      return;
    }

    // Multiple candidates → let the user pick. NEVER fall through to the
    // manual-search card when we have real results.
    if (accountIdentityOnly && !hasSourceContext) {
      logInfo('share-rank', 'auto_save_blocked_reason=account_identity_not_enough');
    } else {
      logInfo('share-rank', 'auto_save_blocked_reason=needs_user_confirmation');
    }
    logDebug('share', 'flow', {
      extractedQuery: query,
      placesCount: results.length,
      topCandidate: results[0]?.name,
      addressLike: isAddressLikePlace(results[0]),
      resolvedCandidate: finalResults[0]?.name,
      candidatesShown: finalResults.length,
      reason: 'show-candidates',
    });
    setCandidates(finalResults);
    setPhase('choose');
    pushShareDebug('[share-debug] FINAL_RESULT', {
      status: 'ambiguous',
      reason: accountIdentityOnly && !hasSourceContext ? 'account_identity_not_enough' : 'needs_user_confirmation',
    }, {
      finalStatus: 'ambiguous',
      finalReason: accountIdentityOnly && !hasSourceContext ? 'account_identity_not_enough' : 'needs_user_confirmation',
      placesCandidateNames: finalResults.map((candidate) => candidate.name),
    });
  }

  async function saveCandidate(
    candidate: PlaceCandidate,
    sourceUrl: string | null,
    sourceType: ShareSource,
  ) {
    setPhase('saving');
    const flow =
      params.url && isLikelyUrl(params.url) ? 'share_extension' : 'paste_link';
    void trackEvent('save_started', {
      source_type: sourceType,
      flow,
      google_place_id: candidate.googlePlaceId ?? null,
      candidate_count: candidates.length || 1,
    });
    try {
      const result = await saveSavedPlace({
        candidate,
        // null/null → use profile default radius (see savedPlacesService).
        radiusValue: null,
        radiusUnit: null,
        sourceType,
        sourceUrl,
      });

      if (result.status === 'duplicate') {
        Alert.alert(
          'Already saved',
          `${candidate.name} is already on your map.`,
        );
      } else {
        const postSaveCount = await getPostSaveCount();
        if (postSaveCount == null) {
          Alert.alert('Saved to your map', candidate.name);
        } else {
          const feedback = getActivationSaveFeedback(postSaveCount);
          Alert.alert(feedback.title, feedback.message);
          if (feedback.milestoneEvent) {
            void trackEvent(feedback.milestoneEvent, {
              source_type: sourceType,
              flow,
              saved_place_id: result.savedPlaceId,
              saved_count: postSaveCount,
            });
          }
          if (feedback.completed) {
            void trackEvent('activation_completed_3_saves', {
              source_type: sourceType,
              flow,
              saved_place_id: result.savedPlaceId,
              saved_count: postSaveCount,
            });
          }
        }
      }
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'saved',
        reason: result.status === 'duplicate' ? 'duplicate' : 'saved',
      }, {
        finalStatus: 'saved',
        finalReason: result.status === 'duplicate' ? 'duplicate' : 'saved',
      });
      void trackEvent('save_success', {
        source_type: sourceType,
        flow,
        google_place_id: candidate.googlePlaceId ?? null,
        saved_place_id: result.savedPlaceId,
        duplicate: result.status === 'duplicate',
      });
      if (!result.savedPlaceId) {
        console.warn('[save-flow] saved place id missing; opening map without focus');
        try {
          router.replace('/(tabs)/map');
        } catch (navErr) {
          console.warn('[share] navigation failed', (navErr as Error)?.message ?? navErr);
        }
        return;
      }
      try {
        router.replace({
          pathname: '/(tabs)/map',
          params: { savedPlaceId: result.savedPlaceId },
        });
      } catch (navErr) {
        console.warn('[share] navigation failed', (navErr as Error)?.message ?? navErr);
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Could not save place.';
      console.warn('[share] saveSavedPlace failed', msg);
      void trackEvent('save_failed', {
        source_type: sourceType,
        flow,
        google_place_id: candidate.googlePlaceId ?? null,
        error_code: 'save_threw',
      });
      Alert.alert("Couldn't save", msg);
      // Stay on the choose/failed screen so the user can try again.
      setPhase(candidates.length > 0 ? 'choose' : 'failed');
      pushShareDebug('[share-debug] FINAL_RESULT', {
        status: 'failed_requires_app',
        reason: 'save_threw',
      }, {
        finalStatus: 'failed_requires_app',
        finalReason: 'save_threw',
      });
    } finally {
      logDebug('share', 'save flow finished');
    }
  }

  /**
   * Batch-save N candidates the user selected from the multi-place
   * picker. Uses Promise.allSettled so a single failure can't crash
   * the screen or block the other saves. Surfaces a summary alert,
   * tracks each outcome, and on full success navigates to the map.
   * On partial/total failure, stays on the picker so the user can
   * retry the leftovers.
   */
  async function saveSelectedCandidates(
    selected: PlaceCandidate[],
    sourceUrl: string | null,
    sourceType: ShareSource,
  ) {
    if (selected.length === 0) return;
    setPhase('saving');
    const flow =
      params.url && isLikelyUrl(params.url) ? 'share_extension' : 'paste_link';
    void trackEvent('save_started', {
      source_type: sourceType,
      flow,
      candidate_count: selected.length,
      multi_select: true,
    });
    const settled = await Promise.allSettled(
      selected.map((c) =>
        saveSavedPlace({
          candidate: c,
          radiusValue: null,
          radiusUnit: null,
          sourceType,
          sourceUrl,
        }),
      ),
    );
    const saved: Array<{
      candidate: PlaceCandidate;
      savedPlaceId: string | null;
      duplicate: boolean;
    }> = [];
    const failed: Array<{ candidate: PlaceCandidate; message: string }> = [];
    settled.forEach((res, idx) => {
      const cand = selected[idx];
      if (res.status === 'fulfilled') {
        const r = res.value;
        saved.push({
          candidate: cand,
          savedPlaceId: r.savedPlaceId ?? null,
          duplicate: r.status === 'duplicate',
        });
        void trackEvent('save_success', {
          source_type: sourceType,
          flow,
          google_place_id: cand.googlePlaceId ?? null,
          saved_place_id: r.savedPlaceId,
          duplicate: r.status === 'duplicate',
          multi_select: true,
        });
      } else {
        const msg = (res.reason as Error)?.message ?? 'Could not save place.';
        failed.push({ candidate: cand, message: msg });
        void trackEvent('save_failed', {
          source_type: sourceType,
          flow,
          google_place_id: cand.googlePlaceId ?? null,
          error_code: 'save_threw',
          multi_select: true,
        });
      }
    });
    pushShareDebug('[share-multi] BATCH_SAVE_RESULT', {
      selected_count: selected.length,
      save_success_count: saved.length,
      save_failure_count: failed.length,
    });
    if (failed.length === 0) {
      const dupCount = saved.filter((s) => s.duplicate).length;
      const newCount = saved.length - dupCount;
      const title = newCount > 0 ? 'Saved to your map' : 'Already saved';
      const body =
        newCount === 0
          ? `${saved.length} place${saved.length === 1 ? '' : 's'} already on your map.`
          : dupCount === 0
            ? `${newCount} place${newCount === 1 ? '' : 's'} added.`
            : `${newCount} added, ${dupCount} already saved.`;
      Alert.alert(title, body);
      const firstSavedId =
        saved.find((s) => !s.duplicate && s.savedPlaceId)?.savedPlaceId ??
        saved.find((s) => s.savedPlaceId)?.savedPlaceId ??
        null;
      try {
        if (firstSavedId) {
          router.replace({
            pathname: '/(tabs)/map',
            params: { savedPlaceId: firstSavedId },
          });
        } else {
          router.replace('/(tabs)/map');
        }
      } catch (navErr) {
        console.warn(
          '[share] navigation failed',
          (navErr as Error)?.message ?? navErr,
        );
      }
      return;
    }
    // Partial or total failure: tell the user what happened and stay
    // on the picker so they can retry the unsaved ones.
    const failedNames = failed.map((f) => f.candidate.name).join(', ');
    if (saved.length === 0) {
      Alert.alert("Couldn't save", `Failed to save: ${failedNames}.`);
    } else {
      Alert.alert(
        'Some places saved',
        `Saved ${saved.length} of ${selected.length}. Couldn't save: ${failedNames}.`,
      );
    }
    const savedIds = new Set(saved.map((s) => s.candidate.googlePlaceId));
    setCandidates((prev) => prev.filter((c) => !savedIds.has(c.googlePlaceId)));
    setMultiSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (!savedIds.has(id)) next.add(id);
      return next;
    });
    setPhase('multi-choose');
  }

  // ---------------------------------------------------------------------
  // Manual fallback search
  // ---------------------------------------------------------------------
  async function runManualSearch() {
    const q = manualQuery.trim();
    if (!q) return;
    const sourceUrl = parsed?.url ?? (url.trim() || '');
    const sourceType: ShareSource = parsed?.source ?? 'link';
    try {
      await runSearchAndMaybeSave(q, sourceUrl, sourceType);
    } catch (err) {
      console.warn('[share] save flow failed', (err as Error)?.message ?? err);
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const primaryButtonTitle =
    phase === 'parsing' || phase === 'searching'
      ? 'Finding place…'
      : phase === 'saving'
        ? 'Saving…'
        : 'Save place';

  // True when this screen was opened from the system share sheet (cold or
  // warm start with a `?url=...` param). Used to swap the header copy and
  // hide the dev-only paste hint so the share-sheet UX feels intentional.
  const launchedFromShare = !!(params.url && isLikelyUrl(params.url));

  // ---- DEBUG ---------------------------------------------------------
  // Top-level render trace. Helped catch the blank-body regression caused
  // by Screen padded={false} collapsing the wrapper to height 0.
  logDebug('share', 'render', {
    url,
    phase,
    candidates: candidates.length,
    failMessage,
  });

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Idle UI is ALWAYS rendered. State-specific blocks (choose,
              failed, debug) layer on top — they never replace the input
              + primary button. This is what guarantees the user always
              sees something actionable. */}
          <Text style={[Typography.title, styles.headerTitle]}>
            {launchedFromShare ? 'Saving from share…' : 'Save from a link'}
          </Text>
          <Text style={[Typography.body, styles.muted, styles.headerBody]}>
            {launchedFromShare
              ? 'We received a link from another app. Finding the place now.'
              : 'Paste a link to test. In production, this opens automatically from the share sheet.'}
          </Text>

          <Input
            value={url}
            onChangeText={setUrl}
            placeholder="https://..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
            onSubmitEditing={() => {
              void runSaveFlow(url).catch((err) => {
                console.warn('[share] save flow failed', (err as Error)?.message ?? err);
              });
            }}
          />

          <View style={{ height: Spacing.md }} />

          <Button
            title={primaryButtonTitle}
            onPress={() => {
              void runSaveFlow(url).catch((err) => {
                console.warn('[share] save flow failed', (err as Error)?.message ?? err);
              });
            }}
            loading={busy}
            disabled={busy || !url.trim()}
          />

          {phase === 'idle' ? (
            <Text style={[Typography.caption, styles.muted, styles.hint]}>
              We only read the public link preview. We never sign in or
              scrape private content.
            </Text>
          ) : null}

          {/* ---- Choose state: compact candidates list -------------- */}
          {phase === 'choose' && candidates.length > 0 ? (
            <View style={styles.section}>
              <Text style={[Typography.label, styles.muted]}>
                {candidates.length === 1
                  ? 'We found this place. Confirm it?'
                  : 'We found a few matches. Pick the right one:'}
              </Text>
              <View style={{ height: Spacing.sm }} />
              {candidates.map((c) => (
                <Pressable
                  key={c.googlePlaceId}
                  onPress={() => {
                    void trackEvent('share_candidate_selected', {
                      source_type: parsed?.source ?? 'link',
                      google_place_id: c.googlePlaceId ?? null,
                      candidate_count: candidates.length,
                    });
                    saveCandidate(
                      c,
                      parsed?.url ?? null,
                      parsed?.source ?? 'link',
                    );
                  }}
                  style={({ pressed }) => [
                    styles.candidate,
                    pressed && styles.candidatePressed,
                  ]}
                >
                  <Text style={Typography.bodyStrong} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.formattedAddress ? (
                    <Text
                      style={[Typography.caption, styles.muted]}
                      numberOfLines={2}
                    >
                      {c.formattedAddress}
                    </Text>
                  ) : null}
                  {c.category ? (
                    <Text
                      style={[Typography.caption, styles.muted, { marginTop: 2 }]}
                      numberOfLines={1}
                    >
                      {c.category}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setCandidates([]);
                  setFailMessage(null);
                  setManualQuery(extraction?.query ?? aiExtraction?.query ?? '');
                  setPhase('failed');
                }}
                hitSlop={8}
                style={styles.manualLink}
              >
                <Text style={[Typography.caption, styles.manualLinkText]}>
                  None of these — search manually
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ---- Multi-choose: ≥2 distinct places, user multi-selects --- */}
          {phase === 'multi-choose' && candidates.length > 0 ? (
            <View style={styles.section}>
              <Text style={[Typography.label, styles.muted]}>
                We found {candidates.length} places in this post. Choose which to
                save.
              </Text>
              <View style={{ height: Spacing.sm }} />
              <View style={styles.multiActions}>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    const all = new Set<string>(
                      candidates.map((c) => c.googlePlaceId).filter(Boolean) as string[],
                    );
                    setMultiSelectedIds(all);
                  }}
                >
                  <Text style={[Typography.caption, styles.manualLinkText]}>
                    Select all
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => setMultiSelectedIds(new Set<string>())}
                >
                  <Text style={[Typography.caption, styles.manualLinkText]}>
                    Clear
                  </Text>
                </Pressable>
              </View>
              <View style={{ height: Spacing.sm }} />
              {candidates.map((c, idx) => {
                const id = c.googlePlaceId;
                const checked = !!id && multiSelectedIds.has(id);
                return (
                  <Pressable
                    key={id || `multi-${idx}`}
                    onPress={() => {
                      if (!id) return;
                      setMultiSelectedIds((prev) => {
                        const next = new Set<string>(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    style={({ pressed }) => [
                      styles.candidate,
                      checked && styles.candidateChecked,
                      pressed && styles.candidatePressed,
                    ]}
                  >
                    <View style={styles.multiRow}>
                      <View
                        style={[
                          styles.checkbox,
                          checked && styles.checkboxChecked,
                        ]}
                      >
                        {checked ? (
                          <Text style={styles.checkboxMark}>✓</Text>
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={Typography.bodyStrong} numberOfLines={1}>
                          {c.name}
                        </Text>
                        {c.formattedAddress ? (
                          <Text
                            style={[Typography.caption, styles.muted]}
                            numberOfLines={2}
                          >
                            {c.formattedAddress}
                          </Text>
                        ) : null}
                        {c.category ? (
                          <Text
                            style={[
                              Typography.caption,
                              styles.muted,
                              { marginTop: 2 },
                            ]}
                            numberOfLines={1}
                          >
                            {c.category}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              <View style={{ height: Spacing.md }} />
              <Button
                title={
                  multiSelectedIds.size === 0
                    ? 'Select at least one'
                    : `Save selected (${multiSelectedIds.size})`
                }
                disabled={multiSelectedIds.size === 0 || busy}
                onPress={() => {
                  const selected = candidates.filter(
                    (c) => c.googlePlaceId && multiSelectedIds.has(c.googlePlaceId),
                  );
                  if (selected.length === 0) return;
                  void trackEvent('share_multi_candidate_save_clicked', {
                    source_type: parsed?.source ?? 'link',
                    candidate_count: candidates.length,
                    selected_count: selected.length,
                  });
                  void saveSelectedCandidates(
                    selected,
                    parsed?.url ?? null,
                    parsed?.source ?? 'link',
                  );
                }}
                loading={busy}
              />
              <Pressable
                onPress={() => {
                  setCandidates([]);
                  setMultiSelectedIds(new Set<string>());
                  setFailMessage(null);
                  setManualQuery(extraction?.query ?? aiExtraction?.query ?? '');
                  setPhase('failed');
                }}
                hitSlop={8}
                style={styles.manualLink}
              >
                <Text style={[Typography.caption, styles.manualLinkText]}>
                  None of these — search manually
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ---- Failed state: friendly message + manual search ----- */}
          {phase === 'failed' ? (
            <Card style={styles.section}>
              <Text style={Typography.heading}>Hmm</Text>
              <Text
                style={[
                  Typography.body,
                  styles.muted,
                  { marginTop: Spacing.xs },
                ]}
              >
                {failMessage ?? FAIL_GENERIC}
              </Text>
              <View style={{ height: Spacing.md }} />
              <Input
                value={manualQuery}
                onChangeText={setManualQuery}
                placeholder="Search by place name"
                autoCapitalize="words"
                onSubmitEditing={runManualSearch}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title="Search"
                onPress={runManualSearch}
                disabled={!manualQuery.trim()}
              />
            </Card>
          ) : null}

          {/* ---- TestFlight diagnostics (always visible) ---------- */}
          {/*
           * 2026-05-26: always-on panel that proves on screen which
           * runtime path the share flow took and — when the
           * `process-share-link` Edge Function was NOT reached — the
           * structured reason. Intentionally NOT gated on `__DEV__` so
           * TestFlight testers can take a screenshot.
           */}
          {parsed ? (
            <View style={styles.section}>
              <Card style={styles.debugCard}>
                <Text style={[Typography.caption, styles.muted]}>
                  share runtime diagnostics
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  app: {debugState.appVersion ?? '∅'}
                  {debugState.appBuildNumber ? ` (${debugState.appBuildNumber})` : ''}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  backend configured: {debugState.edgeFunctionConfigured ? 'yes' : 'no'}
                  {debugState.backendConfigSource
                    ? ` (source=${debugState.backendConfigSource})`
                    : ''}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  backend url host: {debugState.backendUrlHost ?? '∅'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  runtime path: {debugState.runtimePath}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  extraction path attempted: {debugState.extractionPathAttempted ?? '∅'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  did call process-share-link:{' '}
                  {debugState.didCallProcessShareLink == null
                    ? '∅'
                    : debugState.didCallProcessShareLink
                      ? 'yes'
                      : 'no'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  http status: {debugState.backendHttpStatus ?? '∅'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  fallback reason: {debugState.fallbackReason ?? '∅'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  server returned null:{' '}
                  {debugState.serverReturnedNull == null
                    ? '∅'
                    : debugState.serverReturnedNull
                      ? 'yes'
                      : 'no'}
                </Text>
                <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                  legacy extraction used:{' '}
                  {debugState.legacyExtractionUsed == null
                    ? '∅'
                    : debugState.legacyExtractionUsed
                      ? 'yes'
                      : 'no'}
                </Text>
              </Card>
            </View>
          ) : null}

          {/* ---- Dev-only debug toggle ------------------------------ */}
          {__DEV__ && parsed ? (
            <View style={styles.section}>
              <Pressable
                onPress={() => setShowDebug((v) => !v)}
                hitSlop={8}
                style={styles.debugToggle}
              >
                <Text style={[Typography.caption, styles.muted]}>
                  {showDebug ? 'Hide debug' : 'Show debug (dev)'}
                </Text>
              </Pressable>
              {showDebug ? (
                <Card style={styles.debugCard}>
                  <Text style={[Typography.caption, styles.muted]}>
                    {PLATFORM_LABELS[parsed.source]}
                  </Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>runtime: {debugState.runtimePath}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>edge configured: {debugState.edgeFunctionConfigured ? 'yes' : 'no'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>backend HTTP: {debugState.backendHttpStatus ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>backend keys: {debugState.backendKeys.length > 0 ? debugState.backendKeys.join(', ') : '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>backend status: {debugState.backendStatus ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>backend reason: {debugState.backendReason ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>parse failure: {debugState.backendParseFailureReason ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>client fallback used: {debugState.usedClientFallback == null ? '∅' : debugState.usedClientFallback ? 'yes' : 'no'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>title: {debugState.metadataTitle ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>description: {debugState.metadataDescription ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>handles: {debugState.handlesDetected.length > 0 ? debugState.handlesDetected.join(', ') : '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>profile enrichment attempted: {debugState.profileEnrichmentAttempted ? 'yes' : 'no'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>profile metadata for AI: {debugState.profileMetadataCountForAi} [{debugState.profileMetadataHandlesForAi.join(', ')}]</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>heuristic: {extraction?.query ?? '∅'} {extraction ? `(${extraction.confidence}${extraction.reason ? ', ' + extraction.reason : ''})` : ''}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>ai query: {debugState.aiQuery ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>chosen query: {debugState.chosenQuery ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>query source: {debugState.querySource ?? '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>query gate: {debugState.queryGateAllowed == null ? '∅' : debugState.queryGateAllowed ? 'allowed' : `blocked (${debugState.queryGateReason ?? 'unknown'})`}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>places: {debugState.placesCandidateNames.length > 0 ? debugState.placesCandidateNames.join(', ') : '∅'}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>final: {debugState.finalStatus ?? '∅'} {debugState.finalReason ? `(${debugState.finalReason})` : ''}</Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.sm }]}>agent:</Text>
                  {debugState.agent ? (
                    <>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  runId: {debugState.agent.runId}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  prompt: {debugState.agent.promptVersion} model: {debugState.agent.modelUsed}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  surface: {debugState.agent.userFacingDecision}{debugState.agent.downgradedFromAutoSave ? ' (downgraded from auto_save)' : ''}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  agent={debugState.agent.agentDecision} safety={debugState.agent.safetyDecision} confidence={debugState.agent.confidence} latencyMs={debugState.agent.latencyMs ?? '∅'}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  safeToAutoSave: {debugState.agent.safeToAutoSave ? 'yes' : 'no'} {debugState.agent.agentDecision === 'auto_save' && debugState.agent.safetyDecision !== 'auto_save' ? '(blocked by safety gate)' : ''}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  tools: {debugState.agent.toolsUsed.join(', ') || '∅'}</Text>
                      {debugState.agent.toolCalls.length > 0 ? (
                        <>
                          <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  tool calls:</Text>
                          {debugState.agent.toolCalls.map((tc, i) => (
                            <Text key={`${tc.tool}-${i}`} style={[Typography.caption, { marginTop: Spacing.xs }]}>    [{tc.status}] {tc.tool}{tc.latencyMs != null ? ` ${tc.latencyMs}ms` : ''}{tc.note ? ` — ${tc.note}` : ''}</Text>
                          ))}
                          {(() => {
                            const blocked = debugState.agent!.toolCalls.filter((t) => t.status === 'blocked');
                            return blocked.length > 0 ? (
                              <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  blocked/rate-limited: {blocked.map((b) => `${b.tool}${b.note ? `(${b.note})` : ''}`).join(', ')}</Text>
                            ) : null;
                          })()}
                        </>
                      ) : null}
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  evidence: {debugState.agent.evidenceUsed.join(', ') || '∅'}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  rejections: {debugState.agent.rejectionReasons.join(', ') || '∅'}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  warnings: {debugState.agent.warnings.join(', ') || '∅'}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  reasoning: {debugState.agent.reasoning || '∅'}</Text>
                      <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  candidates ({debugState.agent.candidates.length}):</Text>
                      {debugState.agent.candidates.map((c) => (
                        <Text key={c.googlePlaceId} style={[Typography.caption, { marginTop: Spacing.xs }]}>    [{(c.matchScore ?? 0).toFixed(2)}] {c.name} — {c.rationale || '∅'}</Text>
                      ))}
                    </>
                  ) : (
                    <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>  ∅ (no agent block; legacy pipeline)</Text>
                  )}
                  <Text style={[Typography.caption, { marginTop: Spacing.sm }]}>profiles:</Text>
                  {debugState.profileResults.length > 0 ? debugState.profileResults.map((profile) => (
                    <Text key={profile.handle} style={[Typography.caption, { marginTop: Spacing.xs }]}>@{profile.handle} fetched={String(profile.fetched)} blocked={String(profile.blocked)} classification={profile.classification ?? '∅'} displayName={profile.displayName ?? '∅'} extractedName={profile.extractedName ?? '∅'} extractedAddress={profile.extractedAddress ?? '∅'} extractedCity={profile.extractedCity ?? '∅'} reason={profile.reason ?? '∅'}</Text>
                  )) : (
                    <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>∅</Text>
                  )}
                  <Text style={[Typography.caption, { marginTop: Spacing.sm }]}>timeline:</Text>
                  {debugState.timeline.map((entry, index) => (
                    <Text key={`${entry.marker}-${index}`} style={[Typography.caption, { marginTop: Spacing.xs }]}>{entry.marker} {entry.detail}</Text>
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------

// Tokens that are pure geography / stopwords; their presence in a query
// does NOT count toward "this query references a business". Mirrors the
// list used by the heuristic extractor.
const GEO_STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'a', 'an', 'of', 'in', 'on', 'at',
  'la', 'los', 'angeles', 'nyc', 'new', 'york', 'sf', 'san', 'francisco',
  'brooklyn', 'queens', 'manhattan', 'bronx', 'highland', 'park', 'silver',
  'lake', 'echo', 'koreatown', 'sawtelle', 'venice', 'santa', 'monica',
  'culver', 'city', 'pasadena', 'long', 'beach', 'arcadia', 'studio',
  'west', 'hollywood', 'weho', 'beverly', 'hills', 'downtown', 'midtown',
  'soho', 'tribeca', 'williamsburg', 'bushwick', 'astoria', 'flushing',
  'chinatown', 'little', 'tokyo', 'grand', 'central', 'market',
  'french', 'quarter', 'nola', 'feliz',
  'street', 'avenue', 'boulevard', 'blvd', 'road', 'drive', 'lane', 'way',
  'east', 'west', 'north', 'south', 'ca', 'ny',
]);

/**
 * True if the extracted query looks like it names a business (i.e. has
 * at least one non-geographic, non-stopword token of length >= 3). Used
 * to decide whether a Places result that is itself just a neighborhood
 * should be trusted for auto-save.
 */
function looksLikeBusinessQuery(q: string): boolean {
  if (!q) return false;
  const tokens = q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return tokens.some((t) => !GEO_STOPWORDS.has(t));
}

// ---------------------------------------------------------------------------
function placesErrorMessage(err: PlacesError): string {
  switch (err.code) {
    case 'MISSING_API_KEY':
      return 'Google Places is not configured.';
    case 'NETWORK':
      return 'Network error. Check your connection and try again.';
    case 'OVER_QUERY_LIMIT':
      return 'Search quota exceeded. Try again later.';
    case 'REQUEST_DENIED':
      return 'Search request denied.';
    case 'INVALID_REQUEST':
    case 'NOT_FOUND':
      return FAIL_NO_RESULTS;
    default:
      return FAIL_GENERIC;
  }
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing.xl + Spacing.lg,
  },
  headerTitle: { marginBottom: Spacing.xs },
  headerBody: { marginBottom: Spacing.lg },
  hint: {
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  section: { marginTop: Spacing.lg },
  muted: { color: Colors.textMuted },

  candidate: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  candidatePressed: { opacity: 0.7 },
  candidateChecked: {
    borderColor: Colors.primary,
    borderWidth: 1,
  },

  multiActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  multiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },

  debugToggle: { alignSelf: 'flex-start', paddingVertical: Spacing.xs },
  debugCard: { marginTop: Spacing.xs },
  manualLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  manualLinkText: {
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
});
