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
  type LocationBias,
  type PlaceCandidate,
} from '@/services/placesService';
import { listSavedPlaces, saveSavedPlace } from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import * as Location from 'expo-location';

type Phase =
  | 'idle' // showing paste input, waiting for user
  | 'parsing' // fetching OG metadata
  | 'searching' // calling Google Places
  | 'saving' // upserting place + saved_places
  | 'choose' // multiple candidates, user must pick
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

export default function ShareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string }>();

  const [url, setUrl] = useState(params.url ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [parsed, setParsed] = useState<ParsedShare | null>(null);
  const [extraction, setExtraction] = useState<PlaceExtraction | null>(null);
  const [aiExtraction, setAiExtraction] = useState<AIExtractResult | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  // Dev-only debug toggle: lets us inspect what we extracted without ever
  // surfacing it to normal users.
  const [showDebug, setShowDebug] = useState(false);

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
        if (__DEV__) {
          console.debug('[share] user location available for bias');
        }
      } catch (err) {
        if (__DEV__) console.debug('[share] user location lookup skipped', err);
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
    if (__DEV__) {
      console.log('[share] auto-running from incoming url param', incoming);
    }
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

    // Reset prior attempt state.
    setCandidates([]);
    setFailMessage(null);
    setAiExtraction(null);

    // ---- 1. parse ------------------------------------------------------
    setPhase('parsing');
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
    console.log('[share] heuristic extraction', extracted);

    // ---- 2b. AI enhancement (best-effort, never blocks) ---------------
    // extractPlaceAI is guaranteed never to throw and falls back to a
    // low-confidence wrapper around fallbackQuery when GEMINI_API_KEY is
    // not present (i.e. in the mobile bundle). That means in production
    // RN this is a fast no-op; only server / EAS-with-secret builds will
    // actually hit Gemini. UI must never block on AI failure.
    let ai: AIExtractResult | null = null;
    try {
      ai = await extractPlaceAI({
        sourceType: parsedResult.source,
        url: parsedResult.url,
        title: parsedResult.title ?? undefined,
        description: parsedResult.description ?? undefined,
        fallbackQuery: extracted?.query,
      });
      setAiExtraction(ai);
      console.log('[share] ai extraction', {
        query: ai.query,
        confidence: ai.confidence,
      });
    } catch (err) {
      // extractPlaceAI is no-throw, but be defensive anyway.
      console.warn('[share] ai extraction threw (ignored)', (err as Error)?.message);
      ai = null;
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
    if (ai && ai.confidence === 'high' && ai.query) {
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

    if (__DEV__) {
      console.debug('[share] flow chose query', {
        chosenQuery,
        chosenConfidence,
        chosenReason,
        heuristic: extracted?.query,
        ai: ai?.query,
      });
    }

    const preliminaryStrength = classifyPlaceQueryStrength({
      query: chosenQuery,
      extractionReason: chosenReason,
      confidence: chosenConfidence,
      accountIdentityUsed: false,
    });
    if (accountIdentity?.query && preliminaryStrength === 'weak') {
      chosenQuery = accountIdentity.query;
      chosenConfidence = accountIdentity.confidence;
      chosenReason = accountIdentity.reason;
      accountIdentityUsed = true;
    }

    if (!chosenQuery) {
      // We couldn't synthesize ANY query at all -- only here do we fall
      // back to manual search.
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
      if (__DEV__) {
        console.debug('[share] location context', {
          contextText,
          resolved: !!contextLatLng,
        });
      }
    }

    const queryStrength = classifyPlaceQueryStrength({
      query: chosenQuery,
      extractionReason: chosenReason,
      confidence: chosenConfidence,
      sourceContextText: contextText,
      accountIdentityUsed,
    });
    console.log(`[share-extract] query_strength=${queryStrength}`);
    console.log(`[share-extract] account_identity_used=${accountIdentityUsed}`);
    if (accountIdentity?.query) {
      console.log(`[share-rank] account_query=${accountIdentity.query}`);
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
      },
      { contextText, contextLatLng },
    );
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
    } = { chosenReason: null, accountIdentityUsed: false },
    locationCtx: {
      contextText: string | null;
      contextLatLng: LocationBias | null;
    } = { contextText: null, contextLatLng: null },
  ) {
    setPhase('searching');
    // Bias priority: explicit post context > user device location > none.
    const bias: LocationBias | undefined =
      locationCtx.contextLatLng ?? userLatLngRef.current ?? undefined;
    console.log(
      `[share-rank] source_context=${locationCtx.contextText ?? 'none'}`,
    );
    console.log(
      `[share-rank] context_bias_used=${!!locationCtx.contextLatLng}`,
    );
    console.log(
      `[share-rank] device_bias_used=${!locationCtx.contextLatLng && !!userLatLngRef.current}`,
    );
    let results: PlaceCandidate[] = [];
    try {
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
      return;
    }

    console.log('[share] places results', { query, count: results.length });

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
      extractedBusinessName: query,
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
        console.log(`[share-rank] rejected_candidate_reason=${rejection}`);
        return false;
      }
      return true;
    });

    if (finalResults.length === 0) {
      void trackEvent('save_failed', {
        source_type: sourceType,
        flow:
          params.url && isLikelyUrl(params.url)
            ? 'share_extension'
            : 'paste_link',
        query,
        candidate_count: 0,
        error_code: 'all_candidates_rejected',
        confidence: chosenConfidence,
      });
      setFailMessage(FAIL_NO_RESULTS);
      setManualQuery(query);
      setPhase('failed');
      return;
    }
    if (__DEV__) {
      console.debug('[places] franchise resolution', {
        query,
        isMultiLocation,
        contextText: locationCtx.contextText,
        hasContextLatLng: !!locationCtx.contextLatLng,
        hasUserLatLng: !!userLatLngRef.current,
        chosen: finalResults[0]?.name ?? null,
        candidateCount: finalResults.length,
      });
    }

    console.log('[share-rank] candidates', finalResults.slice(0, 5).map((candidate) => ({
      name: candidate.name,
      address: candidate.formattedAddress ?? null,
      googlePlaceId: candidate.googlePlaceId ?? null,
    })));

    const hasSourceContext = !!locationCtx.contextLatLng;
    const strongMatchCandidates = finalResults.filter((candidate) =>
      hasStrongNameMatch(candidate, query),
    );
    const accountIdentityOnly =
      queryEvidence.accountIdentityUsed ||
      isAccountIdentityReason(queryEvidence.chosenReason);
    const explicitAddressSignal = isExplicitAddressQuery(query);
    const explicitSourceBusinessSignal = hasExplicitSourceBusinessSignal(
      queryEvidence.chosenReason,
    );
    const topHasStrongAutoSaveEvidence = (candidate: PlaceCandidate): boolean =>
      explicitAddressSignal ||
      (hasSourceContext && hasStrongNameMatch(candidate, query)) ||
      (explicitSourceBusinessSignal && hasStrongNameMatch(candidate, query));

    if (queryStrength === 'weak') {
      console.log('[share-rank] auto_save_blocked_reason=weak_query');
      if (strongMatchCandidates.length > 0) {
        console.log('[share-rank] auto_save_blocked_reason=needs_user_confirmation');
        setCandidates(strongMatchCandidates.slice(0, 5));
        setPhase('choose');
        return;
      }
      setFailMessage(FAIL_NO_RESULTS);
      setManualQuery(query);
      setPhase('failed');
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
        if (__DEV__) {
          console.debug('[share] flow', {
            extractedQuery: query,
            placesCount: results.length,
            topCandidate: results[0]?.name,
            addressLike: isAddressLikePlace(results[0]),
            resolvedCandidate: only.name,
            candidatesShown: 1,
            reason: 'single-locality-needs-confirmation',
          });
        }
        setCandidates(finalResults);
        setPhase('choose');
        return;
      }
      if (!hasMeaningfulNameMatch(only, query)) {
        console.log('[share-rank] rejected_candidate_reason=name_mismatch');
        setFailMessage(FAIL_NO_RESULTS);
        setManualQuery(query);
        setPhase('failed');
        return;
      }
      if (accountIdentityOnly && !hasSourceContext) {
        console.log('[share-rank] auto_save_blocked_reason=account_identity_not_enough');
        setCandidates(strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults);
        setPhase('choose');
        return;
      }
      if (!topHasStrongAutoSaveEvidence(only)) {
        console.log(
          `[share-rank] auto_save_blocked_reason=${hasSourceContext ? 'needs_user_confirmation' : 'no_source_context_name_not_strong'}`,
        );
        setCandidates(strongMatchCandidates.length > 0 ? strongMatchCandidates.slice(0, 5) : finalResults);
        setPhase('choose');
        return;
      }
      if (__DEV__) {
        console.debug('[share] flow', {
          extractedQuery: query,
          placesCount: results.length,
          topCandidate: results[0]?.name,
          addressLike: isAddressLikePlace(results[0]),
          resolvedCandidate: only.name,
          candidatesShown: 0,
          reason: 'single-result-auto-save',
        });
      }
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
      hasMeaningfulNameMatch(finalResults[0], query) &&
      topHasStrongAutoSaveEvidence(finalResults[0]) &&
      !accountIdentityOnly
    ) {
      if (__DEV__) {
        console.debug('[share] flow', {
          extractedQuery: query,
          placesCount: results.length,
          topCandidate: results[0]?.name,
          addressLike: isAddressLikePlace(results[0]),
          resolvedCandidate: finalResults[0].name,
          candidatesShown: 0,
          reason: 'high-confidence-auto-save',
        });
      }
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
      hasMeaningfulNameMatch(finalResults[0], query) &&
      topHasStrongAutoSaveEvidence(finalResults[0]) &&
      !accountIdentityOnly
    ) {
      if (__DEV__) {
        console.debug('[share] flow', {
          extractedQuery: query,
          placesCount: results.length,
          topCandidate: results[0]?.name,
          resolvedCandidate: finalResults[0].name,
          candidatesShown: 0,
          reason: 'franchise-closest-branch-auto-save',
        });
      }
      await saveCandidate(finalResults[0], sourceUrl, sourceType);
      return;
    }

    // Multiple candidates → let the user pick. NEVER fall through to the
    // manual-search card when we have real results.
    if (accountIdentityOnly && !hasSourceContext) {
      console.log('[share-rank] auto_save_blocked_reason=account_identity_not_enough');
    } else {
      console.log('[share-rank] auto_save_blocked_reason=needs_user_confirmation');
    }
    if (__DEV__) {
      console.debug('[share] flow', {
        extractedQuery: query,
        placesCount: results.length,
        topCandidate: results[0]?.name,
        addressLike: isAddressLikePlace(results[0]),
        resolvedCandidate: finalResults[0]?.name,
        candidatesShown: finalResults.length,
        reason: 'show-candidates',
      });
    }
    setCandidates(finalResults);
    setPhase('choose');
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
    }
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
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[share] render', {
      url,
      phase,
      candidates: candidates.length,
      failMessage,
    });
  }

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
                We found a few matches. Pick the right one:
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
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                    title: {parsed.title ?? '∅'}
                  </Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                    cleaned: {parsed.suggestedQuery ?? '∅'}
                  </Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                    heuristic: {extraction?.query ?? '∅'}{' '}
                    {extraction
                      ? `(${extraction.confidence}${
                          extraction.reason ? ', ' + extraction.reason : ''
                        })`
                      : ''}
                  </Text>
                  <Text style={[Typography.caption, { marginTop: Spacing.xs }]}>
                    ai: {aiExtraction?.query ?? '∅'}{' '}
                    {aiExtraction ? `(${aiExtraction.confidence})` : ''}
                  </Text>
                  {parsed.description ? (
                    <Text
                      style={[Typography.caption, { marginTop: Spacing.xs }]}
                      numberOfLines={4}
                    >
                      desc: {parsed.description}
                    </Text>
                  ) : null}
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
