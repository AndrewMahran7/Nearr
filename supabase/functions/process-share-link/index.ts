// supabase/functions/process-share-link/index.ts
//
// Thin HTTP router for the share-save Edge Function.
//
// Flow:
//   OPTIONS                  → CORS preflight
//   POST (debug_gemini mode) → stubbed JSON debug echo (legacy mode
//                              is currently unused by production
//                              clients; preserved as a contract)
//   POST (save mode)         → resolve + (auto-)save when policy
//                              permits, else extract-only response
//   POST (extract* modes)    → resolve + return extracted shape
//
// All heavy lifting lives in `resolver/resolveSharedPlace.ts` and
// `save.ts`. This file MUST stay short and obvious.

// @ts-nocheck — Deno runtime.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import { preflight } from './cors.ts';
import { readEnv, validateEnv } from './env.ts';
import { parseRequest } from './request.ts';
import { authenticate } from './auth.ts';
import {
  statusSaved,
  statusExtracted,
  statusAmbiguous,
  statusOpenApp,
  statusFailedRequiresApp,
  statusFailed,
  json,
} from './response.ts';
import { logShareDebug } from './diagnostics/logger.ts';

import { detectPlatform, legacySourceFor } from './platform/detectPlatform.ts';
import { fetchPostMetadata } from './metadata/fetchMetadata.ts';
import { extractHandles } from './evidence/handleExtraction.ts';
import { extractEvidence } from './evidence/extractEvidence.ts';
import { extractTaggedLocation } from './evidence/taggedLocation.ts';
import { resolveSharedPlace } from './resolver/resolveSharedPlace.ts';
import { saveForUser } from './save.ts';
import { persistResolverRun } from './shadowRun.ts';
import { normalizeShareUrl } from '../../../lib/shareAgent/tiktokUrl.ts';

// ---------------------------------------------------------------------------

serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return preflight();

  const parsed = await parseRequest(req);
  if (!parsed.ok) {
    if (parsed.reason === 'method_not_allowed') {
      return statusFailed('method_not_allowed', 405);
    }
    return statusFailed(parsed.reason, 400);
  }
  const { url, accessToken, mode } = parsed.req;
  logShareDebug('request:received', { mode, hasUrl: !!url });

  const envRaw = readEnv();
  const envCheck = validateEnv(envRaw);
  if (!envCheck.ok) {
    logShareDebug('request:env_missing', { reason: envCheck.reason });
    return statusFailed(envCheck.reason, 500);
  }
  const env = envCheck.env;

  // debug_gemini: legacy diagnostic endpoint. Preserved as a
  // documented contract — returns a minimal "not configured" payload
  // when not implemented in the new architecture.
  if (mode === 'debug_gemini') {
    return json({
      status: 'gemini_debug',
      ok: false,
      reason: 'debug_gemini_not_implemented_in_v2_router',
    });
  }

  // ---- Auth -----------------------------------------------------
  const auth = await authenticate(env, accessToken);
  if (!auth.ok) {
    logShareDebug('request:auth_failed', { reason: auth.reason });
    return statusFailed(auth.reason, 401);
  }
  const { userId, userClient } = auth;

  // ---- Fetch metadata -------------------------------------------
  // Normalize first: lowercase host + strip share-sheet tracking params
  // (`_r`, `_t`, `is_from_webapp`, `sender_device`, …). Short links
  // (vm./vt.tiktok.com) are redirect-resolved to canonical inside
  // fetchPostMetadata (via `res.url`).
  const normalizedInput = normalizeShareUrl(url);
  const requestUrl = normalizedInput.url || url;
  const platform = detectPlatform(requestUrl);
  if (platform === 'tiktok') {
    logShareDebug('tiktok-share:input', {
      rawInputPresent: !!url,
      isShortLink: normalizedInput.isShortLink,
      normalized: normalizedInput.wasModified,
    });
  }
  const meta = await fetchPostMetadata(requestUrl, platform);
  if (!meta.ok) {
    logShareDebug('metadata:failed', { reason: meta.reason });
    if (platform === 'tiktok') {
      logShareDebug('tiktok-share:metadata_failed', { reason: meta.reason });
    }
    return statusFailedRequiresApp({
      reason: 'metadata_failed',
      diagnostics: { metadataError: meta.error },
    });
  }
  const { title, description, html } = meta.metadata;
  // Post-redirect canonical URL — persisted as the source URL so short
  // links are stored in their stable `@user/video/<id>` form.
  const canonicalUrl = meta.resolvedUrl || requestUrl;
  logShareDebug('metadata:fetched', {
    platform,
    titleLen: title?.length ?? 0,
    descLen: description?.length ?? 0,
  });
  if (platform === 'tiktok') {
    logShareDebug('tiktok-share:metadata', {
      redirectFollowed: canonicalUrl !== requestUrl,
      metadataTitleLen: title?.length ?? 0,
      metadataDescLen: description?.length ?? 0,
      usedOEmbed: meta.usedTikTokOEmbed,
    });
  }

  // ---- Build evidence -------------------------------------------
  const handles = extractHandles({ platform, title, description, html });
  // First-class tagged-location evidence (YouTube recordingDetails, TikTok
  // POI, IG location tag). Currently always null — the interface boundary is
  // ready but no provider is wired yet (see evidence/taggedLocation.ts), so
  // this is behavior-preserving. When present it becomes the resolver's
  // highest-priority, Places-verified evidence source.
  const taggedLocation = extractTaggedLocation({
    platform,
    html,
    resolvedUrl: canonicalUrl,
    title,
    description,
  });
  const evidence = extractEvidence({
    platform,
    title,
    description,
    handles,
    taggedLocation,
  });
  logShareDebug('evidence:built', {
    keys: evidence.keys,
    hasAddress: !!evidence.address,
    venueHintCount: evidence.venueNameHints.length,
    isRoundup: evidence.isRoundup,
    hasTaggedLocation: !!evidence.taggedLocation,
  });
  if (platform === 'tiktok') {
    logShareDebug('tiktok-share:evidence', {
      evidenceAddressCount: evidence.addresses?.length ?? (evidence.address ? 1 : 0),
    });
  }

  // ---- Resolve --------------------------------------------------
  const result = await resolveSharedPlace({ evidence, env });
  // Which evidence source produced the result — the resolver records
  // `evidenceSourceWon` for the tagged-location path; otherwise infer from the
  // evidence the caption pipeline used. Purely diagnostic.
  const evidenceSourceWon =
    (result.diagnostics?.evidenceSourceWon as string | undefined) ??
    (evidence.taggedLocation
      ? 'tagged_location'
      : evidence.address
      ? 'caption_explicit_address'
      : evidence.venueNameHints.length > 0
      ? 'caption_venue_hint'
      : evidence.handles.venueHandles.length > 0
      ? 'venue_handle_tagged'
      : 'caption_text');
  logShareDebug('resolver:result', {
    decision: result.decision,
    confidence: result.confidence,
    candidates: result.candidates.length,
    warnings: result.warnings,
    evidenceSourceWon,
  });
  if (platform === 'tiktok') {
    logShareDebug('tiktok-share:decision', { decision: result.decision });
  }

  // Fire-and-forget diagnostics persistence. Failure is logged
  // under [agent-shadow] but never blocks the response.
  try {
    const latencyMs = Date.now() - startedAt;
    const persist = persistResolverRun({
      userId, url: canonicalUrl, platform, result, latencyMs,
    });
    // @ts-ignore — EdgeRuntime is a Deno Deploy global.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(persist);
    } else {
      persist.catch(() => undefined);
    }
  } catch {
    // never let diagnostics impact the request path
  }

  const source = legacySourceFor(platform);
  const extraction = buildExtractionPayload({
    url: canonicalUrl,
    platform,
    source,
    title,
    description,
    evidence,
    result,
  });
  const diagnostics = result.diagnostics;

  // ---- Extract-mode contract ------------------------------------
  // Per legacy contract: in extract mode the wire-level `status` is
  // ALWAYS 'extracted'. The actual outcome is carried inside
  // `extraction.agent.userFacingDecision` so clients (and the gold
  // evaluator) can pick the right UX.
  if (mode !== 'save') {
    return statusExtracted({
      candidate: result.primaryCandidate,
      candidates: result.candidates,
      extracted: extraction,
      diagnostics,
    });
  }

  // ---- Save-mode dispatch ---------------------------------------
  switch (result.decision) {
    case 'auto_save': {
      if (!result.safeToAutoSave || !result.primaryCandidate) {
        return statusExtracted({
          candidate: result.primaryCandidate,
          candidates: result.candidates,
          extracted: extraction,
          diagnostics,
        });
      }
      try {
        const saved = await saveForUser({
          client: userClient,
          userId,
          candidate: result.primaryCandidate,
          sourceUrl: canonicalUrl,
          source,
        });
        return statusSaved({
          placeId: saved.placeId,
          googlePlaceId: result.primaryCandidate.googlePlaceId,
          saved: { id: saved.savedPlaceId },
          extracted: extraction,
          diagnostics,
        });
      } catch (err) {
        logShareDebug('save:failed', { error: (err as Error)?.message });
        return statusFailedRequiresApp({
          reason: 'save_failed',
          extracted: extraction,
          diagnostics: { ...diagnostics, saveError: (err as Error)?.message },
        });
      }
    }

    case 'candidate_picker':
    case 'candidate_confirmation':
    case 'multi_candidate_confirmation':
      return statusAmbiguous({
        candidates: result.candidates,
        primaryCandidate: result.primaryCandidate,
        extracted: extraction,
        diagnostics,
      });

    case 'manual_fallback':
      return statusOpenApp({
        reason: result.failureReason ?? 'manual_fallback',
        extracted: extraction,
        diagnostics,
      });

    case 'failed':
    default:
      return statusFailedRequiresApp({
        reason: result.failureReason ?? 'resolver_failed',
        extracted: extraction,
        diagnostics,
      });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExtractionPayload(args: {
  url: string;
  platform: string;
  source: string;
  title: string | null;
  description: string | null;
  evidence: ReturnType<typeof extractEvidence>;
  result: Awaited<ReturnType<typeof resolveSharedPlace>>;
}) {
  const { evidence, result } = args;
  const agentCandidates = result.candidates.map((c) => ({
    name: c.name,
    formattedAddress: c.formattedAddress,
    googlePlaceId: c.googlePlaceId,
    latitude: c.latitude,
    longitude: c.longitude,
    types: c.types,
    matchScore: c.confidenceScore,
    evidence: c.evidence,
    reasons: c.reasons,
  }));
  const resolvedPlace = result.primaryCandidate
    ? agentCandidates.find(
        (c) => c.googlePlaceId === result.primaryCandidate!.googlePlaceId,
      ) ?? null
    : null;

  // 2026-05-27 — backward-compat fields required by the React Native
  // host parser (`lib/shareExtractionBackend.ts.coerceBackendExtraction`)
  // and `app/share.tsx`. The new resolver does not produce a single
  // "query" string with a categorical source the way the legacy
  // pipeline did, so we synthesize the shape from evidence + the
  // cleaned search query that was actually issued to Places.
  const placeNameHint = evidence.venueNameHints[0] ?? null;
  const addressHint = evidence.address?.raw ?? null;
  const posterHandle = evidence.handles.posterHandle ?? null;
  const taggedAccounts = evidence.handles.taggedHandles ?? [];
  const handlesDetected = [
    posterHandle,
    ...taggedAccounts,
  ].filter((h): h is string => !!h);
  const query = result.cleanSearchQuery
    ?? placeNameHint
    ?? addressHint
    ?? '';
  let querySource: string;
  if (result.cleanSearchQuery && addressHint && result.cleanSearchQuery.includes(addressHint)) {
    querySource = 'address';
  } else if (placeNameHint) {
    querySource = 'caption_venue_hint';
  } else if (posterHandle) {
    querySource = 'account_handle';
  } else if (addressHint) {
    querySource = 'address';
  } else {
    querySource = 'none';
  }
  const queryKind = addressHint
    ? 'address'
    : placeNameHint
      ? 'venue_name'
      : posterHandle
        ? 'handle'
        : 'unknown';
  const searchAllowed = query.length > 0 && !evidence.isRoundup;
  const blockedReason = evidence.isRoundup ? 'roundup_post' : null;

  return {
    source: args.source,
    url: args.url,
    title: args.title,
    description: args.description,
    handlesDetected,
    query,
    querySource,
    queryKind,
    searchAllowed,
    blockedReason,
    confidence: result.confidence,
    placeName: placeNameHint,
    address: addressHint,
    city: evidence.cityState?.city ?? evidence.address?.city ?? null,
    state: evidence.cityState?.state ?? evidence.address?.state ?? null,
    sourceContext: evidence.cityState
      ? `${evidence.cityState.city}, ${evidence.cityState.state}`
      : null,
    posterHandle,
    posterType: 'unknown' as const,
    taggedAccounts,
    profileMetadata: [],
    requiredNameHint: placeNameHint,
    verifiedProfileQuery: null,
    isRoundup: evidence.isRoundup,
    evidenceKeys: evidence.keys,
    warnings: result.warnings,
    // ---- `agent` block: the evaluator + shadow-diagnostics surface.
    //      Mirrors lib/shareAgent AgentResponse shape so the eval
    //      script and the host app's diagnostics UI both work.
    agent: {
      userFacingDecision: result.decision,
      safeToAutoSave: result.safeToAutoSave,
      confidence: result.confidence,
      candidates: agentCandidates,
      resolvedPlace,
      evidenceUsed: result.evidenceUsed,
      warnings: result.warnings,
      toolCalls: [],
      diagnostics: result.diagnostics,
    },
    finalCandidates: agentCandidates,
  };
}
