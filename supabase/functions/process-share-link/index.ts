// supabase/functions/process-share-link/index.ts
//
// Server-side handler for the iOS Share Extension's "silent save" flow.
//
// Input  (POST JSON):
//   { url: string, accessToken?: string }
//
// Output (JSON):
//   {
//     status: "saved" | "ambiguous" | "failed_requires_app" | "open_app",
//     message?: string,
//     savedPlaceId?: string,
//     candidates?: PlaceCandidate[],
//     reason?: string
//   }
//
// Runtime: Supabase Edge Functions (Deno).
//
// Required env (set via `supabase secrets set ...`):
//   SUPABASE_URL                  (auto-populated by Supabase runtime)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-populated by Supabase runtime)
//   GEMINI_API_KEY                (optional — heuristic fallback if missing)
//   GOOGLE_PLACES_KEY             (required — server-side text search)
//
// Constraints:
//   - NO secrets ever leak to the client/extension. All calls to Gemini /
//     Google Places happen here.
//   - On any unexpected error we return { status: "open_app" } so the
//     extension falls back to the existing deep-link flow and the user is
//     never stuck.
//   - Saving is idempotent: dedupe places by google_place_id, upsert
//     saved_places by (user_id, place_id).

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — this file targets the Deno Edge runtime, not the RN tsconfig.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ---------------------------------------------------------------------------
// Types (mirrors of the contract documented in ShareExtension.tsx)
// ---------------------------------------------------------------------------

type ResultCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
};

type SearchBias = {
  lat: number;
  lng: number;
};

type Result =
  | { status: 'saved'; savedPlaceId: string; message?: string }
  | { status: 'ambiguous'; candidates: ResultCandidate[]; reason?: string; message?: string }
  | { status: 'failed_requires_app'; reason?: string; message?: string }
  | { status: 'open_app'; reason?: string; message?: string };

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  console.log('[process-share-link] FUNCTION_INVOKED method=' + req.method);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ status: 'open_app', reason: 'method_not_allowed' }, 405);
  }

  let body: { url?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return json({ status: 'open_app', reason: 'invalid_json' }, 400);
  }

  const url = (body.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ status: 'open_app', reason: 'missing_url' }, 400);
  }

  // Accept token from body OR Authorization: Bearer <jwt>.
  const headerAuth = req.headers.get('authorization') ?? '';
  const hasAuthHeader = headerAuth.toLowerCase().startsWith('bearer ');
  const bearer = hasAuthHeader ? headerAuth.slice(7).trim() : '';
  const bodyHasToken = !!(body.accessToken?.trim());
  console.log(
    '[process-share-link] AUTH_STATE has_authorization_header=' + hasAuthHeader +
    ' body_has_access_token=' + bodyHasToken,
  );
  const accessToken = (body.accessToken ?? bearer ?? '').trim();

  try {
    const result = await processShareLink(url, accessToken);
    return json(result, 200);
  } catch (err) {
    console.error('[process-share-link] unhandled error', err);
    return json({ status: 'open_app', reason: 'server_error' }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function processShareLink(url: string, accessToken: string): Promise<Result> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const PLACES_KEY =
    Deno.env.get('GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ??
    '';

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.warn('[process-share-link] missing supabase env');
    return { status: 'open_app', reason: 'server_misconfigured' };
  }
  if (!PLACES_KEY) {
    console.warn('[process-share-link] missing GOOGLE_PLACES_KEY');
    return { status: 'open_app', reason: 'server_misconfigured' };
  }

  // ---- 1. authenticate user ------------------------------------------
  if (!accessToken) {
    return { status: 'open_app', reason: 'missing_auth' };
  }
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser(accessToken);
  if (userErr || !userRes?.user) {
    console.log('[process-share-link] auth failed', userErr?.message);
    return { status: 'open_app', reason: 'invalid_auth' };
  }
  const userId = userRes.user.id;

  // ---- 2. parse share metadata ---------------------------------------
  const source = detectSource(url);
  let title: string | null = null;
  let description: string | null = null;
  try {
    const html = await fetchHtml(url);
    title =
      pickMeta(html, 'og:title') ??
      pickMeta(html, 'twitter:title') ??
      pickTitle(html);
    description =
      pickMeta(html, 'og:description') ??
      pickMeta(html, 'twitter:description') ??
      null;
    title = cleanTitle(title);
    description = cleanDescription(description);
  } catch (err) {
    console.log('[process-share-link] metadata fetch failed', (err as Error)?.message);
  }

  const heuristicQuery = buildQuery(title, description);

  // ---- 2b. Instagram public profile enrichment (best-effort) ---------
  // Strict: max 2 handles per share, 4s per fetch, never throws, never
  // logs raw bio/HTML. If IG blocks us we fall through normally.
  let profileEnrichments: InstagramProfileEnrichment[] = [];
  // Poster handle detected from og:title / meta description / source URL.
  const posterHandle = source === 'instagram'
    ? detectPosterHandle(title, description, url)
    : null;
  if (posterHandle) {
    console.log(`[process-share-link] POSTER_HANDLE_DETECTED handle=@${posterHandle}`);
  }
  if (source === 'instagram') {
    const handlesToEnrich = extractRawHandles(
      title,
      description,
      url,
      MAX_PROFILE_ENRICHMENTS_PER_SHARE,
      posterHandle,
    );
    if (handlesToEnrich.length > 0) {
      console.log(
        `[process-share-link] ACCOUNT_ENRICHMENT_REQUESTED count=${handlesToEnrich.length}`,
      );
      profileEnrichments = await Promise.all(
        handlesToEnrich.map((h) => enrichInstagramProfile(h)),
      );
      for (const e of profileEnrichments) {
        if (e.blocked) {
          console.log(
            `[process-share-link] ACCOUNT_ENRICHMENT_BLOCKED handle=@${e.handle} reasons=${e.reasons.join(',')}`,
          );
        } else if (e.fetched) {
          console.log(
            `[process-share-link] ACCOUNT_ENRICHMENT_FETCHED handle=@${e.handle}`,
          );
          console.log(
            `[process-share-link] ACCOUNT_ENRICHMENT_CLASSIFIED handle=@${e.handle} classification=${e.classification} confidence=${e.confidence} reasons=${e.reasons.join(',')}`,
          );
          if (e.reasons.includes('no_bio_evidence')) {
            console.log(
              `[process-share-link] enrichment_ignored_no_bio_evidence handle=@${e.handle}`,
            );
          }
          if (e.displayName && !e.extractedName) {
            console.log(
              `[process-share-link] display_name_not_used_without_bio_evidence handle=@${e.handle}`,
            );
          }
        } else {
          console.log(
            `[process-share-link] ACCOUNT_ENRICHMENT_SKIPPED handle=@${e.handle} reasons=${e.reasons.join(',')}`,
          );
        }
      }
    }
  }

  // ---- 3. Conditional transcription fallback -------------------------
  // Cheap heuristic confidence on metadata alone. If it's strong enough we
  // skip the transcription call entirely (transcription is the slowest +
  // most fragile step in the whole pipeline). If it's weak, we try to pull
  // a transcript from the configured provider and feed it into the AI step.
  //
  // Confidence is a number in [0,1]; threshold is 0.6. We never block the
  // pipeline on transcription — failures, timeouts, missing config all
  // degrade gracefully to "no transcript" and the AI call proceeds with
  // just title/description as before.
  const metadataConfidence = scoreMetadataConfidence(title, description, heuristicQuery);
  let transcript: string | null = null;
  if (metadataConfidence >= 0.6) {
    console.log(
      `[process-share-link] TRANSCRIPT_SKIPPED_LOW_CONFIDENCE=false url=${truncForLog(url)} confidence=${metadataConfidence.toFixed(2)}`,
    );
  } else {
    console.log(
      `[process-share-link] TRANSCRIPT_REQUESTED url=${truncForLog(url)} confidence=${metadataConfidence.toFixed(2)}`,
    );
    transcript = await fetchTranscriptSafe(url);
    if (transcript) {
      console.log(
        `[process-share-link] TRANSCRIPT_SUCCESS url=${truncForLog(url)} length=${transcript.length}`,
      );
    } else {
      console.log(
        `[process-share-link] TRANSCRIPT_FAILED url=${truncForLog(url)} confidence=${metadataConfidence.toFixed(2)}`,
      );
    }
  }

  // ---- 4. AI extraction (Gemini) -------------------------------------
  const ai = await extractPlaceAI({
    sourceType: source,
    url,
    title: title ?? undefined,
    description: description ?? undefined,
    transcript: transcript ?? undefined,
    fallbackQuery: heuristicQuery ?? undefined,
    profileEnrichments,
  });

  if (transcript) {
    console.log(
      `[process-share-link] TRANSCRIPT_USED_IN_AI url=${truncForLog(url)} length=${transcript.length} aiConfidence=${ai.confidence}`,
    );
  }

  let chosenQuery = (ai.query && ai.query.trim()) || heuristicQuery || '';
  let confidence: 'high' | 'medium' | 'low' = ai.confidence;
  let accountIdentityUsed = false;
  const accountIdentityQuery = buildAccountIdentityQuery({
    title,
    description,
    sourceUrl: url,
    posterHandle,
    profileEnrichments,
  });
  const preliminaryStrength = classifyQueryStrength({
    query: chosenQuery,
    confidence,
    sourceContextText: null,
    accountIdentityUsed: false,
  });
  if (accountIdentityQuery && (!chosenQuery || preliminaryStrength === 'weak')) {
    chosenQuery = accountIdentityQuery.query;
    confidence = accountIdentityQuery.confidence;
    accountIdentityUsed = true;
  }
  const sourceContext = extractLocationContext(
    [title, description, chosenQuery].filter(Boolean).join('\n'),
  );
  const contextBias = sourceContext
    ? await geocodeContextText(sourceContext, PLACES_KEY)
    : null;
  const queryStrength = classifyQueryStrength({
    query: chosenQuery,
    confidence,
    sourceContextText: sourceContext,
    accountIdentityUsed,
  });
  console.log(`[share-extract] query_strength=${queryStrength}`);
  console.log(`[share-extract] account_identity_used=${accountIdentityUsed}`);
  if (accountIdentityQuery?.query) {
    console.log(`[share-rank] account_query=${accountIdentityQuery.query}`);
  }
  console.log(`[share-rank] source_context=${sourceContext ?? 'none'}`);
  console.log(`[share-rank] context_bias_used=${!!contextBias}`);
  console.log('[share-rank] device_bias_used=false');

  // ---- 4b. Feature 5: auto-note from share context -------------------
  const autoNote = generateAutoNote(title, description, transcript);
  if (autoNote) {
    console.log(`[process-share-link] AI_NOTE_GENERATED note="${autoNote}"`);
  } else {
    console.log('[process-share-link] AI_NOTE_SKIPPED_LOW_CONFIDENCE');
  }

  // ---- 4c. Feature 4: @handle fallback (no transcript, low confidence) -
  // Only Places queries derived from bio evidence (extractedName +
  // extractedAddress/extractedCity) are used here. Raw or humanized
  // handles are NEVER used as Places queries.
  type FallbackQuery = {
    query: string;
    handle: string;
    requiredNameHint?: string;
  };
  const fallbackQueries: FallbackQuery[] = [];

  // Build a lookup of enrichments by handle (lowercase).
  const enrichmentByHandle = new Map(
    profileEnrichments.map((e) => [e.handle.toLowerCase(), e]),
  );

  // Priority A: poster account enrichment if classified restaurant_or_business
  // with bio-derived geo anchor.
  if (posterHandle) {
    const pe = enrichmentByHandle.get(posterHandle.toLowerCase());
    if (pe?.fetched && pe.classification === 'restaurant_or_business') {
      const q = buildPlacesQueryFromEnrichment(pe);
      if (q) {
        console.log(`[process-share-link] POSTER_HANDLE_PRIORITIZED handle=@${pe.handle}`);
        fallbackQueries.push({ query: q, handle: pe.handle, requiredNameHint: pe.extractedName });
      }
    }
  }

  // Priority B: tagged handle enrichments with bio-derived geo anchor.
  // Only use if the enriched profile is classified restaurant_or_business.
  // If both poster and a tagged handle have valid enrichment and the caption
  // does not clearly name one venue, both are queued; the results are returned
  // as ambiguous so the user can confirm.
  const queuedHandles = new Set(fallbackQueries.map((f) => f.handle.toLowerCase()));
  for (const pe of profileEnrichments) {
    if (queuedHandles.has(pe.handle.toLowerCase())) continue;
    if (!pe.fetched) continue;
    if (pe.classification !== 'restaurant_or_business') continue;
    const q = buildPlacesQueryFromEnrichment(pe);
    if (q) {
      console.log(`[process-share-link] TAGGED_HANDLE_ENRICHMENT_USED handle=@${pe.handle}`);
      fallbackQueries.push({ query: q, handle: pe.handle, requiredNameHint: pe.extractedName });
    }
  }

  if (!transcript && confidence === 'low' && fallbackQueries.length > 0) {
    for (const fq of fallbackQueries) {
      console.log(
        `[process-share-link] HANDLE_QUERY_ATTEMPTED query="${fq.query}" handle=@${fq.handle} url=${truncForLog(url)}`,
      );
      try {
        const handleResults = await searchPlaces(fq.query, PLACES_KEY);
        let handleBusinesses = handleResults.filter(
          (c) => !isAddressLikeTypes(c.types) && !isLocalityLikeTypes(c.types),
        );

        // Wrong-result guard: discard Places results that don't name-overlap
        // the bio-extracted name. Prevents a query for "Mad Yolks Los Angeles"
        // from returning an unrelated business.
        if (fq.requiredNameHint && handleBusinesses.length > 0) {
          const filtered = handleBusinesses.filter(
            (c) => nameOverlapScore(c.name, fq.requiredNameHint!) >= 1,
          );
          if (filtered.length > 0) {
            handleBusinesses = filtered;
          } else {
            console.log(
              `[process-share-link] HANDLE_RESULTS_FILTERED_NAME_MISMATCH handle=@${fq.handle} hint="${fq.requiredNameHint}" discarded=${handleBusinesses.length}`,
            );
            handleBusinesses = [];
          }
        }

        if (handleBusinesses.length > 0) {
          console.log(
            `[process-share-link] ACCOUNT_ENRICHMENT_USED_FOR_PLACES handle=@${fq.handle} results=${handleBusinesses.length}`,
          );
          // Never auto-save from the low-confidence handle fallback.
          // Always surface candidates for user confirmation.
          if (handleBusinesses.length === 1) {
            console.log(
              `[process-share-link] HANDLE_FALLBACK_BLOCKED_AUTOSAVE place="${handleBusinesses[0].name}"`,
            );
          }
          console.log(
            `[process-share-link] HANDLE_FALLBACK_RETURNED_AMBIGUOUS count=${handleBusinesses.length}`,
          );
          return {
            status: 'ambiguous',
            candidates: handleBusinesses.slice(0, 5),
            reason: 'handle_candidates',
          };
        } else {
          console.log(
            `[process-share-link] HANDLE_QUERY_FAILED query="${fq.query}" handle=@${fq.handle} reason=no_results`,
          );
        }
      } catch (err) {
        console.log(
          `[process-share-link] HANDLE_QUERY_FAILED query="${fq.query}" handle=@${fq.handle} reason=${(err as Error)?.message}`,
        );
      }
    }
  }
  if (!chosenQuery) {
    return { status: 'failed_requires_app', reason: 'no_query' };
  }

  // ---- 5. Google Places search (main) --------------------------------
  let candidates: ResultCandidate[];
  try {
    candidates = await searchPlaces(chosenQuery, PLACES_KEY, contextBias ?? undefined);
  } catch (err) {
    console.warn('[process-share-link] places search failed', (err as Error)?.message);
    return { status: 'open_app', reason: 'places_error' };
  }

  // Filter out raw geocoded addresses / regions — we never want to silently
  // save "Highland Park" or a street address. The host app's flow has more
  // sophisticated address-resolution logic; here we just defer to it.
  const businesses = candidates.filter(
    (c) => !isAddressLikeTypes(c.types) && !isLocalityLikeTypes(c.types),
  );

  const rankedBusinesses = rankCandidates(businesses, chosenQuery, contextBias);
  const trustedBusinesses = rankedBusinesses.filter((candidate) => {
    const rejection = getCandidateRejectionReason(candidate, chosenQuery, contextBias);
    if (rejection) {
      console.log(`[share-rank] rejected_candidate_reason=${rejection}`);
      return false;
    }
    return true;
  });

  console.log('[share-rank] candidates', trustedBusinesses.slice(0, 5).map((candidate) => ({
    name: candidate.name,
    address: candidate.formattedAddress ?? null,
    googlePlaceId: candidate.googlePlaceId,
  })));

  if (trustedBusinesses.length === 0) {
    if (candidates.length > 0) {
      // We got results but they were all addresses/regions — let the host
      // app try its richer resolution.
      return { status: 'failed_requires_app', reason: 'address_only' };
    }
    return { status: 'failed_requires_app', reason: 'no_candidate' };
  }

  const strongMatchBusinesses = trustedBusinesses.filter((candidate) =>
    hasStrongNameMatch(candidate.name, chosenQuery),
  );
  const accountIdentityOnly =
    accountIdentityQuery?.source === 'account_display_name' ||
    accountIdentityQuery?.source === 'account_handle';
  const explicitAddressSignal = PROFILE_ADDRESS_RE.test(chosenQuery);
  const explicitSourceBusinessSignal =
    !accountIdentityOnly &&
    confidence === 'high' &&
    !isGenericWeakQuery(chosenQuery) &&
    looksLikeBusinessQuery(chosenQuery);

  if (queryStrength === 'weak') {
    console.log('[share-rank] auto_save_blocked_reason=weak_query');
    if (strongMatchBusinesses.length > 0) {
      console.log('[share-rank] auto_save_blocked_reason=needs_user_confirmation');
      return {
        status: 'ambiguous',
        candidates: strongMatchBusinesses.slice(0, 5),
        reason: 'weak_query',
      };
    }
    return { status: 'failed_requires_app', reason: 'weak_query' };
  }

  // ---- 5. decide silent-save vs ambiguous ----------------------------
  const top = trustedBusinesses[0];
  const second = trustedBusinesses[1];
  const hasSourceContext = !!contextBias;
  const hasVerifiedProfileEvidence = accountIdentityQuery?.source === 'verified_profile';
  const topHasStrongAutoSaveEvidence =
    explicitAddressSignal ||
    (hasSourceContext && hasStrongNameMatch(top.name, chosenQuery)) ||
    (explicitSourceBusinessSignal && hasStrongNameMatch(top.name, chosenQuery)) ||
    (hasVerifiedProfileEvidence && hasStrongNameMatch(top.name, chosenQuery));

  const dominant =
    !second ||
    (confidence === 'high' && hasMeaningfulNameMatch(top.name, chosenQuery));

  const canSilentSave =
    queryStrength === 'strong' &&
    confidence === 'high' &&
    dominant &&
    hasMeaningfulNameMatch(top.name, chosenQuery) &&
    topHasStrongAutoSaveEvidence &&
    !accountIdentityOnly;

  if (!canSilentSave) {
    if (accountIdentityOnly && !hasSourceContext && !hasVerifiedProfileEvidence) {
      console.log('[share-rank] auto_save_blocked_reason=account_identity_not_enough');
    } else if (!topHasStrongAutoSaveEvidence) {
      console.log(
        `[share-rank] auto_save_blocked_reason=${hasSourceContext ? 'needs_user_confirmation' : 'no_source_context_name_not_strong'}`,
      );
    }
    return {
      status: 'ambiguous',
      candidates: trustedBusinesses.slice(0, 5),
      reason: 'multiple_candidates',
    };
  }

  // ---- 6. save (idempotent) ------------------------------------------
  try {
    const savedPlaceId = await saveForUser(
      userClient,
      userId,
      top,
      url,
      source,
      autoNote,
    );
    return {
      status: 'saved',
      savedPlaceId,
      message: `Saved "${top.name}" to Nearr`,
    };
  } catch (err) {
    console.warn('[process-share-link] save failed', (err as Error)?.message);
    return { status: 'failed_requires_app', reason: 'save_error' };
  }
}

// ---------------------------------------------------------------------------
// Save logic (mirrors services/savedPlacesService.ts contract)
// ---------------------------------------------------------------------------

async function saveForUser(
  client: any,
  userId: string,
  c: ResultCandidate,
  sourceUrl: string,
  source: 'tiktok' | 'instagram' | 'link',
  autoNote?: string | null,
): Promise<string> {
  // 1. Resolve canonical places row (SELECT first, INSERT only if missing).
  let placeId: string | null = null;
  if (c.googlePlaceId) {
    const { data: existing, error: lookupErr } = await client
      .from('places')
      .select('id')
      .eq('google_place_id', c.googlePlaceId)
      .maybeSingle();
    if (lookupErr) throw new Error(`place lookup: ${lookupErr.message}`);
    if (existing) placeId = existing.id;
  }

  if (!placeId) {
    const payload = {
      google_place_id: c.googlePlaceId,
      name: c.name,
      formatted_address: c.formattedAddress ?? null,
      latitude: c.latitude,
      longitude: c.longitude,
      category: pickCategory(c.types),
      google_maps_url: null, // textsearch doesn't return canonical URL
    };
    const { data: inserted, error: insertErr } = await client
      .from('places')
      .insert(payload)
      .select('id')
      .single();
    if (insertErr) {
      // 23505: race with another concurrent insert. Recover by re-selecting.
      if ((insertErr as any).code === '23505' && c.googlePlaceId) {
        const { data: raced } = await client
          .from('places')
          .select('id')
          .eq('google_place_id', c.googlePlaceId)
          .maybeSingle();
        if (raced) placeId = raced.id;
      }
      if (!placeId) throw new Error(`place insert: ${insertErr.message}`);
    } else {
      placeId = inserted.id;
    }
  }

  // 2. Upsert saved_places by (user_id, place_id).
  const savedPayload = {
    user_id: userId,
    place_id: placeId,
    radius_value: null, // use profile default
    radius_unit: null,
    source_type: source,
    source_url: sourceUrl,
    notes: autoNote ?? null, // Feature 5: AI-generated note
  };

  const { data: saved, error: savedErr } = await client
    .from('saved_places')
    .insert(savedPayload)
    .select('id')
    .single();

  if (savedErr) {
    if ((savedErr as any).code === '23505') {
      // Already saved; refresh source fields and return existing id.
      const { data: existingSaved } = await client
        .from('saved_places')
        .select('id')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .maybeSingle();
      if (existingSaved) {
        await client
          .from('saved_places')
          .update({ source_type: source, source_url: sourceUrl })
          .eq('id', existingSaved.id);
        return existingSaved.id;
      }
    }
    throw new Error(`saved_places insert: ${savedErr.message}`);
  }
  return saved.id;
}

// ---------------------------------------------------------------------------
// Google Places (server-side text search)
// ---------------------------------------------------------------------------

async function searchPlaces(
  query: string,
  key: string,
  bias?: SearchBias,
): Promise<ResultCandidate[]> {
  const params = new URLSearchParams({ query, key });
  if (bias) {
    params.set('location', `${bias.lat},${bias.lng}`);
    params.set('radius', '50000');
  }
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
  );
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  const json = await res.json();
  const status = json.status as string;
  if (status !== 'OK' && status !== 'ZERO_RESULTS') {
    throw new Error(`Places ${status}: ${json.error_message ?? ''}`);
  }
  return (json.results ?? []).slice(0, 8).map((r: any) => ({
    googlePlaceId: r.place_id,
    name: r.name,
    formattedAddress: r.formatted_address ?? undefined,
    latitude: r.geometry?.location?.lat,
    longitude: r.geometry?.location?.lng,
    types: Array.isArray(r.types) ? r.types : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Gemini (server-side AI extraction)
// ---------------------------------------------------------------------------

type AIResult = { query: string; confidence: 'high' | 'medium' | 'low'; reason: string };

async function extractPlaceAI(input: {
  sourceType?: string;
  url?: string;
  title?: string;
  description?: string;
  transcript?: string;
  fallbackQuery?: string;
  profileEnrichments?: InstagramProfileEnrichment[];
}): Promise<AIResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!apiKey) {
    return {
      query: (input.fallbackQuery ?? input.title ?? '').trim(),
      confidence: 'low',
      reason: 'GEMINI_API_KEY not configured',
    };
  }
  const prompt = buildAIPrompt(input);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('empty gemini response');
    const obj = JSON.parse(extractJsonObject(text) ?? text);
    const query = typeof obj.query === 'string' ? obj.query.trim() : '';
    const confRaw = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : '';
    const confidence: 'high' | 'medium' | 'low' =
      confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'low';
    if (!query) {
      return {
        query: (input.fallbackQuery ?? '').trim(),
        confidence: 'low',
        reason: 'gemini empty query',
      };
    }
    return { query, confidence, reason: typeof obj.reason === 'string' ? obj.reason : '' };
  } catch (err) {
    console.log('[process-share-link] gemini failed', (err as Error)?.message);
    return {
      query: (input.fallbackQuery ?? input.title ?? '').trim(),
      confidence: 'low',
      reason: 'gemini error',
    };
  }
}

function buildAIPrompt(input: {
  sourceType?: string;
  url?: string;
  title?: string;
  description?: string;
  transcript?: string;
  fallbackQuery?: string;
  profileEnrichments?: InstagramProfileEnrichment[];
}): string {
  // Truncate transcript to keep token cost predictable. The prompt instructs
  // the model to use it ONLY if title/description are insufficient, so a
  // short window is fine in practice.
  const TRANSCRIPT_MAX = 1800;
  const rawT = (input.transcript ?? '').trim();
  const transcript = rawT.length > TRANSCRIPT_MAX
    ? rawT.slice(0, TRANSCRIPT_MAX) + '…'
    : rawT;

  // Build a sanitized profile-enrichment summary. Only include classification
  // and EXTRACTED business evidence. Never include raw bio text in the prompt.
  const profileLines: string[] = [];
  for (const e of input.profileEnrichments ?? []) {
    if (!e.fetched) continue;
    const parts = [
      `@${e.handle}`,
      `classification=${e.classification}`,
      `confidence=${e.confidence}`,
    ];
    if (e.displayName) parts.push(`displayName="${e.displayName.replace(/"/g, "'")}"`);
    if (e.extractedName) parts.push(`extractedName="${e.extractedName.replace(/"/g, "'")}"`);
    if (e.extractedAddress) parts.push(`extractedAddress="${e.extractedAddress.replace(/"/g, "'")}"`);
    if (e.extractedCity) parts.push(`extractedCity="${e.extractedCity.replace(/"/g, "'")}"`);
    profileLines.push(parts.join(' '));
  }
  const profileBlock = profileLines.length > 0
    ? profileLines.join('\n')
    : '(none)';

  return [
    'You are a place-extraction assistant for a maps app.',
    'Identify the PRIMARY real-world restaurant or place that this social media post is ABOUT.',
    'The primary venue is where the poster is eating, visiting, or recommending.',
    '',
    'Evidence priority (highest to lowest):',
    '  1. Explicit address in caption/title (highest confidence).',
    '  2. Explicit restaurant/place name in caption/title.',
    '  3. Profile bio evidence: extractedName + extractedAddress/extractedCity from profileMetadata.',
    '  4. Transcript content (only when 1-3 are absent or ambiguous).',
    '  5. Nothing else — do NOT infer from handle text, display names, or general keywords.',
    '',
    'CRITICAL — handle text is NOT evidence:',
    '  - Do NOT use the words inside an @handle to guess a restaurant name.',
    '  - @handles are only pointers to profile metadata. Ignore the handle string itself.',
    '  - @handle alone, however business-like it looks, is NOT sufficient evidence.',
    '',
    'Tagged accounts in a post are NOT automatically the primary venue:',
    '  - A tagged account may be a supplier, collaborator, ingredient source, or credit.',
    '  - Only treat a tagged account as the primary venue if caption/bio/transcript',
    '    clearly establishes it as the place being visited or reviewed.',
    '  - If the poster\'s own profile (classification=restaurant_or_business) has bio',
    '    evidence and the caption does not clearly name a different restaurant,',
    '    prefer the poster\'s profile as the primary venue.',
    '',
    'displayName rules:',
    '  - displayName is an account name, NOT a confirmed restaurant name.',
    '  - Do NOT output a displayName as the restaurant name unless the bio confirms it',
    '    with extractedAddress or extractedCity. Without geo evidence, confidence = "low".',
    '',
    'profileMetadata comes from PUBLIC Instagram profile pages:',
    '  - Use ONLY extractedName/extractedAddress/extractedCity (derived from bio text).',
    '  - If classification is food_creator/repost_page/personal_account/unrelated_or_unknown,',
    '    do NOT treat that handle as a venue identity.',
    '  - If classification=restaurant_or_business but extractedAddress and extractedCity',
    '    are both absent, treat as low confidence.',
    '',
    'Output rules:',
    '  - The query MUST be a physical place name + location, NEVER a social handle.',
    '  - Prefer named venues over neighborhoods. City/neighborhood alone → confidence = "low".',
    'Return STRICT JSON: {"query": string, "confidence": "high"|"medium"|"low", "reason": string}',
    '',
    `sourceType: ${input.sourceType ?? ''}`,
    `url: ${input.url ?? ''}`,
    `title: ${input.title ?? ''}`,
    `description: ${input.description ?? ''}`,
    `transcript: ${transcript}`,
    `fallbackQuery: ${input.fallbackQuery ?? ''}`,
    `profileMetadata:\n${profileBlock}`,
  ].join('\n');
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Share metadata (ported from lib/shareParser.ts, RN-free)
// ---------------------------------------------------------------------------

const USER_AGENT = 'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const FETCH_TIMEOUT_MS = 8000;

function detectSource(url: string): 'tiktok' | 'instagram' | 'link' {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  return 'link';
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function pickMeta(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtml(m[1]);
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtml(m[1]) : null;
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim()
    .replace(/\s+on TikTok.*/i, '')
    .replace(/\s*\|\s*Instagram.*/i, '')
    .replace(/\s*•\s*Instagram.*/i, '')
    .replace(/\s*\(@[^)]+\)\s*on Instagram.*/i, '')
    .replace(/\s*-\s*YouTube.*/i, '')
    .trim()
    .replace(/^["\u201C\u201D'`]+|["\u201C\u201D'`]+$/g, '')
    .trim();
  return s || null;
}

function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 240) s = s.slice(0, 237).trimEnd() + '\u2026';
  return s;
}

function buildQuery(title: string | null, description: string | null): string | null {
  const candidate = title ?? firstSentence(description);
  if (!candidate) return null;
  let q = candidate
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+on Instagram\b.*$/i, ' ')
    .replace(/\s+on TikTok\b.*$/i, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{So}\p{Sk}]/gu, ' ')
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length > 120) q = q.slice(0, 120).trim();
  return q || null;
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^[^.!?\n]{4,}/);
  return m ? m[0].trim() : s.trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Place type filtering (subset of services/placesService.ts)
// ---------------------------------------------------------------------------

const ADDRESS_LIKE = new Set([
  'street_address','premise','subpremise','route','intersection',
  'postal_code','postal_code_prefix','postal_code_suffix','plus_code','geocode',
]);
const LOCALITY_LIKE = new Set([
  'locality','sublocality','sublocality_level_1','sublocality_level_2',
  'neighborhood','administrative_area_level_1','administrative_area_level_2',
  'administrative_area_level_3','country','political',
]);
const BUSINESS_LIKE = new Set([
  'restaurant','cafe','bar','bakery','food','meal_takeaway','meal_delivery',
  'store','shopping_mall','clothing_store','book_store','grocery_or_supermarket',
  'supermarket','convenience_store','gym','spa','beauty_salon','lodging',
  'museum','art_gallery','movie_theater','night_club','tourist_attraction',
  'amusement_park','park','stadium','liquor_store','pharmacy','pet_store',
]);

function isAddressLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => ADDRESS_LIKE.has(t));
}
function isLocalityLikeTypes(types?: string[]): boolean {
  if (!types?.length) return false;
  if (types.some((t) => BUSINESS_LIKE.has(t))) return false;
  return types.some((t) => LOCALITY_LIKE.has(t));
}

function pickCategory(types?: string[]): string | null {
  if (!types?.length) return null;
  const skip = new Set(['point_of_interest', 'establishment', 'food']);
  const first = types.find((t) => !skip.has(t)) ?? types[0];
  return first ? first.replace(/_/g, ' ') : null;
}

const STOP = new Set(['the','and','for','restaurant','cafe','bar','food','place']);
function nameOverlapScore(name: string, query: string): number {
  const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x));
  const c = new Set(tok(name));
  let hits = 0;
  for (const t of tok(query)) if (c.has(t)) hits++;
  return hits;
}

function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMeaningfulNameMatch(name: string, query: string): boolean {
  const normalizedName = normalizeName(name);
  const normalizedQuery = normalizeName(query);
  if (!normalizedName || !normalizedQuery) return true;
  if (
    normalizedName === normalizedQuery ||
    normalizedName.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedName)
  ) {
    return true;
  }
  const overlap = nameOverlapScore(name, query);
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length >= 3 && !STOP.has(token));
  if (queryTokens.length <= 2) return overlap >= 1;
  return overlap >= 2;
}

function hasStrongNameMatch(name: string, query: string): boolean {
  const normalizedName = normalizeName(name);
  const normalizedQuery = normalizeName(query);
  if (!normalizedName || !normalizedQuery) return false;
  if (
    normalizedName === normalizedQuery ||
    normalizedName.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedName)
  ) {
    return true;
  }
  const overlap = nameOverlapScore(name, query);
  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length <= 2) return overlap >= 2;
  return overlap >= Math.min(3, queryTokens.length);
}

function looksLikeBusinessQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return PROFILE_BUSINESS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isGenericWeakQuery(query: string): boolean {
  if (!query) return true;
  if (/^(?:my|our|this|that|best|favorite|hidden gem|vibes|going|follow|check out|come with|need to go|you need to go|you have to try)\b/i.test(query)) {
    return true;
  }
  if (/\b(?:vibes only|with the crew|must try|slaps|so good|fire|yum|yummy|delicious|food recs?)\b/i.test(query)) {
    return true;
  }
  const tokens = tokenizeQuery(query);
  return tokens.length <= 2 && !looksLikeBusinessQuery(query) && !PROFILE_ADDRESS_RE.test(query);
}

function classifyQueryStrength(params: {
  query: string | null | undefined;
  confidence: 'high' | 'medium' | 'low';
  sourceContextText: string | null;
  accountIdentityUsed: boolean;
}): 'strong' | 'medium' | 'weak' {
  const query = (params.query ?? '').trim();
  if (!query) return 'weak';
  if (PROFILE_ADDRESS_RE.test(query)) return 'strong';
  const hasContext = !!params.sourceContextText || PROFILE_CITY_STATE_RE.test(query);
  const businessLike = looksLikeBusinessQuery(query) || isLikelyBusinessIdentity(query);
  if (isGenericWeakQuery(query) && !businessLike) return 'weak';
  if (businessLike && hasContext) return 'strong';
  if (businessLike && (params.accountIdentityUsed || params.confidence !== 'low')) return 'medium';
  if (businessLike && tokenizeQuery(query).length >= 3 && !isGenericWeakQuery(query)) return 'medium';
  return 'weak';
}

function isLikelyBusinessIdentity(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (PROFILE_CREATOR_PHRASES.some((phrase) => normalized.includes(phrase))) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const businessHits = tokens.filter((token) =>
    PROFILE_BUSINESS_KEYWORDS.some((keyword) => keyword.replace(/\s+/g, '') === token || keyword === token),
  ).length;
  if (businessHits >= 1 && tokens.length >= 2) return true;
  return tokens.length >= 3 && !/\b(?:foodie|hungry|eats|bites|finds|guide|reviews)\b/i.test(normalized);
}

function humanizeHandle(handle: string): string {
  let s = handle.replace(/[._]+/g, ' ').toLowerCase();
  const splitTokens = [
    ...PROFILE_BUSINESS_KEYWORDS,
    'house', 'bros', 'co', 'company',
    'los', 'angeles', 'new', 'york', 'san', 'francisco', 'santa', 'monica',
    'brooklyn', 'queens', 'manhattan', 'venice', 'pasadena', 'arcadia',
    'highland', 'park', 'silver', 'lake', 'echo', 'feliz', 'studio',
    'downtown', 'hollywood', 'beverly', 'hills',
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const token of splitTokens) {
      const compact = token.replace(/\s+/g, '');
      if (!/^[a-z]+$/.test(compact)) continue;
      const reBefore = new RegExp(`([a-z])(${compact})(?=[a-z]|$)`, 'g');
      s = s.replace(reBefore, '$1 $2');
      const reAfter = new RegExp(`(^|\\s)(${compact})(?=[a-z])`, 'g');
      s = s.replace(reAfter, '$1$2 ');
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

function buildAccountIdentityQuery(params: {
  title: string | null;
  description: string | null;
  sourceUrl: string;
  posterHandle: string | null;
  profileEnrichments: InstagramProfileEnrichment[];
}): {
  query: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'verified_profile' | 'account_display_name' | 'account_handle';
} | null {
  const posterEnrichment = params.posterHandle
    ? params.profileEnrichments.find((entry) => entry.handle.toLowerCase() === params.posterHandle?.toLowerCase())
    : null;
  if (
    posterEnrichment?.classification === 'restaurant_or_business' &&
    posterEnrichment.extractedName &&
    (posterEnrichment.extractedAddress || posterEnrichment.extractedCity)
  ) {
    return {
      query: posterEnrichment.extractedName.trim(),
      confidence: 'high',
      source: 'verified_profile',
    };
  }
  if (posterEnrichment?.displayName && isLikelyBusinessIdentity(posterEnrichment.displayName)) {
    return {
      query: posterEnrichment.displayName.trim(),
      confidence: 'medium',
      source: 'account_display_name',
    };
  }

  const displayName = parseDisplayNameFromOgTitle(params.title) ??
    parseDisplayNameFromMetaDescription(params.description) ??
    null;
  if (displayName && isLikelyBusinessIdentity(displayName)) {
    return {
      query: displayName.trim(),
      confidence: 'medium',
      source: 'account_display_name',
    };
  }

  const profileMatch = params.sourceUrl.match(
    /(?:instagram|tiktok)\.com\/(?!(?:p|reel|reels|tv|explore|stories|accounts|video)\b)([A-Za-z0-9._]{2,30})(?:\/|$)/i,
  );
  const urlHandle = profileMatch?.[1] ?? null;
  const corroboratedHandle = params.posterHandle ?? urlHandle;
  const handle = params.posterHandle ?? urlHandle;
  if (corroboratedHandle && displayName && isLikelyBusinessIdentity(displayName)) {
    return {
      query: displayName.trim(),
      confidence: 'medium',
      source: 'account_display_name',
    };
  }

  if (handle && isLikelyBusinessIdentity(handle)) {
    return {
      query: humanizeHandle(handle),
      confidence: 'low',
      source: 'account_handle',
    };
  }

  return null;
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function rankCandidates(
  candidates: ResultCandidate[],
  query: string,
  contextBias: SearchBias | null,
): ResultCandidate[] {
  return [...candidates]
    .map((candidate) => {
      let score = 0;
      if (candidate.types?.some((type) => BUSINESS_LIKE.has(type))) score += 25;
      if (hasMeaningfulNameMatch(candidate.name, query)) score += 18;
      score += nameOverlapScore(candidate.name, query) * 12;
      if (
        contextBias &&
        Number.isFinite(candidate.latitude) &&
        Number.isFinite(candidate.longitude)
      ) {
        const km =
          haversineMeters(
            contextBias.lat,
            contextBias.lng,
            candidate.latitude!,
            candidate.longitude!,
          ) / 1000;
        if (km > 250) score -= 220;
        else if (km > 100) score -= 120;
        else if (km > 40) score -= 60;
        else score -= Math.min(30, km * 0.75);
      }
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ candidate }) => candidate);
}

function getCandidateRejectionReason(
  candidate: ResultCandidate,
  query: string,
  contextBias: SearchBias | null,
): 'far_from_source_context' | 'name_mismatch' | null {
  if (!hasMeaningfulNameMatch(candidate.name, query)) {
    return 'name_mismatch';
  }
  if (
    contextBias &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude)
  ) {
    const km =
      haversineMeters(
        contextBias.lat,
        contextBias.lng,
        candidate.latitude!,
        candidate.longitude!,
      ) / 1000;
    if (km > 250 && nameOverlapScore(candidate.name, query) < 2) {
      return 'far_from_source_context';
    }
  }
  return null;
}

const LOCATION_CONTEXT_ALIASES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bNYC\b/i, value: 'New York, NY' },
  { pattern: /\bNY\b/i, value: 'New York, NY' },
  { pattern: /\bNew York\b/i, value: 'New York, NY' },
  { pattern: /\bBrooklyn\b/i, value: 'Brooklyn, NY' },
  { pattern: /\bManhattan\b/i, value: 'Manhattan, NY' },
  { pattern: /\bLos Angeles\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bLA\b/i, value: 'Los Angeles, CA' },
  { pattern: /\bOrange County\b/i, value: 'Orange County, CA' },
  { pattern: /\bOC\b/i, value: 'Orange County, CA' },
  { pattern: /\bSanta Cruz\b/i, value: 'Santa Cruz, CA' },
];

function normalizeLocationContext(value: string): string {
  const trimmed = value.replace(/[.!?]+$/g, '').trim();
  for (const alias of LOCATION_CONTEXT_ALIASES) {
    if (alias.pattern.test(trimmed)) return alias.value;
  }
  return trimmed;
}

function extractLocationContext(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  const pinIdx = text.search(/[\u{1F4CD}\u{1F4CC}]/u);
  if (pinIdx >= 0) {
    const tail = text.slice(pinIdx + 2, pinIdx + 200).split(/[\n\r]/)[0];
    const cleaned = tail
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(/["\u201C\u201D'`]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const stopMatch = cleaned.split(/\b(?:also|and|or|plus)\b|[+|]/i)[0].trim();
    if (stopMatch && stopMatch.length >= 3 && stopMatch.length <= 80) {
      return normalizeLocationContext(stopMatch);
    }
  }
  const addressMatch = cleanedText.match(
    /\b\d{1,5}\s+[A-Za-z0-9.'\- ]{2,60}\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|ct|court|pl|place)\b[^\n,;]*?(?:,\s*[A-Za-z.'\- ]+)?(?:,\s*[A-Z]{2})?/i,
  );
  if (addressMatch?.[0]) return normalizeLocationContext(addressMatch[0]);
  const cityState = cleanedText.match(/\b([A-Z][A-Za-z][\w'.\- ]{1,30}?),\s*([A-Z]{2})\b/);
  if (cityState?.[0]) return normalizeLocationContext(cityState[0]);
  const trailing = text.match(
    /,\s*([A-Z][\p{L}.'\u2019-]+(?:[\s,]+[A-Z][\p{L}.'\u2019-]+){0,4})\s*[.!?]?\s*$/u,
  );
  if (trailing?.[1]) return normalizeLocationContext(trailing[1]);
  for (const alias of LOCATION_CONTEXT_ALIASES) {
    if (alias.pattern.test(cleanedText)) return alias.value;
  }
  return null;
}

async function geocodeContextText(
  contextText: string,
  key: string,
): Promise<SearchBias | null> {
  const trimmed = contextText.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({ query: trimmed, key });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
  );
  if (!res.ok) return null;
  const json = await res.json();
  const status = json.status as string;
  if (status !== 'OK' && status !== 'ZERO_RESULTS') return null;
  const raw = Array.isArray(json.results) ? json.results : [];
  if (raw.length === 0) return null;
  const first = raw[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Transcription fallback (SoScripted)
//
// Mirrors lib/transcription/providers/soscripted.ts but inlined here because
// the Edge Function runs on Deno and cannot import the Node-side lib code
// directly. Both must stay behaviorally consistent.
//
// Contracts:
//   - Never throws. Returns null on any failure (timeout, non-2xx, parse).
//   - Hard timeout per provider so a slow third party can never stall the
//     share-save flow.
//   - Honors TRANSCRIPTION_PROVIDER env var. Supported values:
//       "placeholder"  → no-op, returns null (default when unset)
//       "soscripted"   → POST https://soscripted.com/transcript-api
//       "self_hosted"  → POST $SELF_HOSTED_TRANSCRIPTION_URL/transcribe
//                        (yt-dlp + Whisper microservice; see transcription-service/)
// ---------------------------------------------------------------------------

const SOSCRIPTED_ENDPOINT = 'https://soscripted.com/transcript-api';
const SOSCRIPTED_TIMEOUT_MS = 7_000;
// Self-hosted Whisper can take 20–40s on CPU; cap so the Edge Function
// itself doesn't time out (Supabase default ~60s).
const SELF_HOSTED_TIMEOUT_MS = 45_000;

async function fetchTranscriptSafe(url: string): Promise<string | null> {
  const provider = (Deno.env.get('TRANSCRIPTION_PROVIDER') ?? '').trim().toLowerCase();
  if (!provider || provider === 'placeholder') {
    // No provider configured -- silently degrade. This preserves prior
    // behavior (no transcription) when the env var isn't set.
    return null;
  }
  if (!isLikelyVideoUrl(url)) {
    // Skip non-video shares (e.g. plain http links). Avoids burning the
    // transcript-API budget on URLs it can't process.
    return null;
  }

  if (provider === 'self_hosted') {
    return await fetchSelfHostedTranscript(url);
  }
  if (provider === 'soscripted') {
    return await fetchSoScriptedTranscript(url);
  }
  console.log(`[process-share-link] unknown TRANSCRIPTION_PROVIDER="${provider}" -- skipping`);
  return null;
}

async function fetchSoScriptedTranscript(url: string): Promise<string | null> {
  const apiKey = (Deno.env.get('SOSCRIPTED_API_KEY') ?? '').trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOSCRIPTED_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const res = await fetch(SOSCRIPTED_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.log(`[process-share-link] soscripted http ${res.status}`);
      return null;
    }
    const json = await res.json().catch(() => null) as any;
    if (!json || typeof json !== 'object') return null;
    const t =
      (typeof json.transcript === 'string' && json.transcript) ||
      (typeof json.text === 'string' && json.text) ||
      (typeof json?.data?.transcript === 'string' && json.data.transcript) ||
      (typeof json?.data?.text === 'string' && json.data.text) ||
      (typeof json?.result?.transcript === 'string' && json.result.transcript) ||
      (typeof json?.result?.text === 'string' && json.result.text) ||
      '';
    const trimmed = (t as string).trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message;
    console.log(`[process-share-link] soscripted error ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSelfHostedTranscript(url: string): Promise<string | null> {
  const baseUrl = (Deno.env.get('SELF_HOSTED_TRANSCRIPTION_URL') ?? '').trim();
  if (!baseUrl) {
    console.log('[process-share-link] TRANSCRIPT_SELF_HOSTED_FAILED reason=missing_endpoint');
    return null;
  }

  // Cheap pre-flight: if the service isn't reachable / healthy we skip
  // the (slow, expensive) /transcribe call entirely. This keeps us from
  // waiting up to 45s on a known-down service.
  const healthy = await selfHostedHealthCheck(baseUrl);
  if (!healthy) {
    console.log(
      `[process-share-link] TRANSCRIPT_SKIPPED_SERVICE_UNHEALTHY url=${truncForLog(url)}`,
    );
    return null;
  }

  const endpoint = buildSelfHostedUrl(baseUrl, '/transcribe');
  const apiKey = (Deno.env.get('TRANSCRIPTION_SERVICE_API_KEY') ?? '').trim();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SELF_HOSTED_TIMEOUT_MS);
  const startedAt = Date.now();
  console.log(`[process-share-link] TRANSCRIPT_SELF_HOSTED_REQUESTED url=${truncForLog(url)}`);
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.log(
        `[process-share-link] TRANSCRIPT_SELF_HOSTED_FAILED url=${truncForLog(url)} reason=http_${res.status}`,
      );
      return null;
    }
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; transcript?: string; error?: string }
      | null;
    if (!json || typeof json !== 'object') {
      console.log(
        `[process-share-link] TRANSCRIPT_SELF_HOSTED_FAILED url=${truncForLog(url)} reason=parse_error`,
      );
      return null;
    }
    if (json.success && typeof json.transcript === 'string' && json.transcript.trim().length > 0) {
      const transcript = json.transcript.trim();
      console.log(
        `[process-share-link] TRANSCRIPT_SELF_HOSTED_SUCCESS url=${truncForLog(url)} length=${transcript.length} ms=${Date.now() - startedAt}`,
      );
      return transcript;
    }
    console.log(
      `[process-share-link] TRANSCRIPT_SELF_HOSTED_FAILED url=${truncForLog(url)} reason=${json.error ?? 'empty_transcript'}`,
    );
    return null;
  } catch (err) {
    const isAbort = (err as Error)?.name === 'AbortError';
    const reason = isAbort ? 'timeout' : (err as Error)?.message;
    console.log(
      `[process-share-link] ${isAbort ? 'TRANSCRIPT_SELF_HOSTED_TIMEOUT' : 'TRANSCRIPT_SELF_HOSTED_FAILED'} url=${truncForLog(url)} reason=${reason}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// SELF_HOSTED_TRANSCRIPTION_URL may be configured as either:
//   https://host.example.com           → append the requested path
//   https://host.example.com/transcribe → strip /transcribe, then append
// We always want /health to hit /health and /transcribe to hit /transcribe.
function buildSelfHostedUrl(baseUrl: string, path: '/health' | '/transcribe'): string {
  let trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('/transcribe')) {
    trimmed = trimmed.slice(0, -'/transcribe'.length).replace(/\/+$/, '');
  } else if (trimmed.toLowerCase().endsWith('/health')) {
    trimmed = trimmed.slice(0, -'/health'.length).replace(/\/+$/, '');
  }
  return `${trimmed}${path}`;
}

const SELF_HOSTED_HEALTH_TIMEOUT_MS = 2_000;

async function selfHostedHealthCheck(baseUrl: string): Promise<boolean> {
  const endpoint = buildSelfHostedUrl(baseUrl, '/health');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SELF_HOSTED_HEALTH_TIMEOUT_MS);
  console.log(`[process-share-link] TRANSCRIPT_HEALTH_CHECK_REQUESTED endpoint=${truncForLog(endpoint)}`);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.log(`[process-share-link] TRANSCRIPT_HEALTH_CHECK_FAILED reason=http_${res.status}`);
      return false;
    }
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; yt_dlp_available?: boolean; ffmpeg_available?: boolean }
      | null;
    if (!body || body.ok !== true) {
      console.log('[process-share-link] TRANSCRIPT_HEALTH_CHECK_FAILED reason=not_ok');
      return false;
    }
    // The service answers, but its native deps are missing → can't transcribe.
    if (body.yt_dlp_available === false || body.ffmpeg_available === false) {
      console.log(
        `[process-share-link] TRANSCRIPT_HEALTH_CHECK_FAILED reason=missing_binaries yt_dlp=${body.yt_dlp_available} ffmpeg=${body.ffmpeg_available}`,
      );
      return false;
    }
    console.log('[process-share-link] TRANSCRIPT_HEALTH_CHECK_SUCCESS');
    return true;
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message;
    console.log(`[process-share-link] TRANSCRIPT_HEALTH_CHECK_FAILED reason=${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyVideoUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes('tiktok.com') ||
    u.includes('instagram.com/reel') ||
    u.includes('instagram.com/p/') ||
    u.includes('instagram.com/tv/') ||
    u.includes('youtube.com/shorts') ||
    u.includes('youtu.be/')
  );
}

// ---------------------------------------------------------------------------
// Metadata heuristic confidence
//
// Returns a score in [0,1] estimating how confident we are that the
// title/description ALONE name a real venue. Used to decide whether to
// spend the transcription budget. Threshold: < 0.6 -> fetch transcript.
//
// Heuristic (cheap on purpose -- the AI step does the real work):
//   + 0.2 baseline if we have any heuristicQuery at all
//   + 0.3 for each capitalized multi-word proper-noun-ish token (cap at 2)
//   + 0.2 if title/description contains an @handle
//   + 0.2 if it contains an explicit venue cue ("at <Capitalized>", "@", "in <Capitalized>")
//   - 0.3 if the only useful tokens are generic ("food", "vibes", "spot"…)
// ---------------------------------------------------------------------------

const VENUE_KEYWORDS = new Set([
  'restaurant','cafe','coffee','bar','pub','bistro','brewery','bakery','diner',
  'pizzeria','taqueria','grill','kitchen','lounge','club','market','shop','store',
  'gallery','museum','theater','theatre','park','gym','spa','hotel','inn',
]);
const GENERIC_TOKENS = new Set([
  'food','vibes','spot','place','best','amazing','must','try','love','foodie',
  'aesthetic','cute','nice','good','great','review','tour','visit',
]);

function scoreMetadataConfidence(
  title: string | null,
  description: string | null,
  heuristicQuery: string | null,
): number {
  if (!heuristicQuery) return 0;
  let score = 0.2;

  const properNounTokens = (heuristicQuery.match(/\b[A-Z][a-zA-Z'’]{2,}\b/g) ?? []).length;
  score += Math.min(properNounTokens, 2) * 0.3;

  const blob = `${title ?? ''} ${description ?? ''}`;

  if (/\b(?:at|in)\s+[A-Z][a-zA-Z'’]{2,}/.test(blob)) score += 0.2;

  const lower = heuristicQuery.toLowerCase();
  const hasVenueKeyword = [...VENUE_KEYWORDS].some((k) => lower.includes(k));
  if (hasVenueKeyword) score += 0.1;

  const tokens = lower.split(/\s+/).filter((t) => t.length >= 3);
  const usefulTokens = tokens.filter((t) => !GENERIC_TOKENS.has(t));
  if (tokens.length > 0 && usefulTokens.length === 0) score -= 0.3;

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return score;
}

function truncForLog(s: string): string {
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

// ---------------------------------------------------------------------------
// Feature 4: @handle extraction helper
//
// @handles are only pointers to profile metadata. Handle text is never
// used as restaurant evidence. Places queries are only built from
// bio-derived extractedName + extractedAddress/extractedCity.
// ---------------------------------------------------------------------------

type HandleCandidate = {
  handle: string;
  /** Where the handle came from. */
  source: 'poster' | 'caption_tag' | 'url' | 'unknown';
};

/**
 * Try to determine the poster's Instagram handle from share metadata.
 * Returns lowercase handle without @, or null if not determinable.
 *
 * For a reel URL like instagram.com/reel/XXX the path does not contain the
 * poster's handle. Instead, og:title often reads:
 *   "Mad Yolks (@mad_yolks) • Instagram photo"
 * and og:description starts with
 *   "N Followers … - Mad Yolks (@mad_yolks) on Instagram: \"…\""
 * We also check the source URL itself in case it IS a profile URL.
 */
function detectPosterHandle(
  title: string | null,
  description: string | null,
  sourceUrl: string,
): string | null {
  // 1. Source URL is a profile page: instagram.com/<handle>/
  const profileMatch = sourceUrl.match(
    /instagram\.com\/(?!(?:p|reel|reels|tv|explore|stories|accounts)\b)([A-Za-z0-9._]{2,30})(?:\/|$)/i,
  );
  if (profileMatch) return profileMatch[1].toLowerCase();

  // 2. og:title: "Name (@handle) • …"
  if (title) {
    const m = title.match(/\(@([A-Za-z0-9._]{2,30})\)/);
    if (m) return m[1].toLowerCase();
  }

  // 3. og:description / meta description
  if (description) {
    // "… - Name (@handle) on Instagram:"
    const m = description.match(/\(@([A-Za-z0-9._]{2,30})\)\s+on\s+Instagram/i);
    if (m) return m[1].toLowerCase();
  }

  return null;
}



// ---------------------------------------------------------------------------
// Feature 5: auto-note generation
//
// Generates a short (<=8 word) food/experience note from share context.
// Returns null if confidence is too low to produce a useful note.
// ---------------------------------------------------------------------------

function generateAutoNote(
  title: string | null,
  description: string | null,
  transcript: string | null,
): string | null {
  // Prefer transcript > title > description as the primary signal.
  const text = [transcript, title, description].filter(Boolean).join(' ');
  if (!text) return null;

  const lower = text.toLowerCase();

  const foodKeywords = [
    'burger', 'burgers', 'pizza', 'tacos', 'taco', 'ramen', 'sushi',
    'sandwich', 'sandwiches', 'dumplings', 'dumpling', 'pasta', 'steak',
    'chicken', 'fish', 'seafood', 'matcha', 'coffee', 'latte', 'espresso',
    'croissant', 'pastry', 'pastries', 'brunch', 'cocktails', 'cocktail',
    'wine', 'dessert', 'ice cream', 'gelato', 'fried rice', 'noodles',
    'boba', 'donut', 'donuts', 'wings', 'ribs', 'bbq', 'barbecue',
  ];

  const qualifiers = [
    'amazing', 'great', 'best', 'incredible', 'delicious', 'fantastic',
    'perfect', 'classic', 'fire', 'juicy', 'crispy', 'tender', 'fluffy',
    'fresh', 'spicy', 'creamy', 'cheesy', 'smoky', 'good',
  ];

  const experienceKeywords = [
    'date night', 'date-night', 'romantic', 'cozy', 'rooftop', 'outdoor',
    'hidden gem', 'brunch spot', 'anniversary',
  ];

  // Try experience keywords first (high signal).
  for (const kw of experienceKeywords) {
    if (lower.includes(kw)) {
      return `Saved for ${kw}`;
    }
  }

  // Try food keyword with optional qualifier.
  for (const kw of foodKeywords) {
    if (!lower.includes(kw)) continue;
    for (const q of qualifiers) {
      const re = new RegExp(`${q}\\s+${kw.replace(/\s/g, '\\s+')}`, 'i');
      if (re.test(text)) {
        const note = `Saved for ${q} ${kw}`;
        if (note.split(' ').length <= 8) return note;
      }
    }
    // No qualifier found — use the keyword alone.
    const note = `Saved for ${kw}`;
    if (note.split(' ').length <= 8) return note;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Instagram public profile enrichment
//
// Best-effort fetch of public Instagram profile pages to:
//   1. Classify a handle as a real business vs. a creator/repost page.
//   2. Extract a real place name / address / city to feed Google Places.
//
// Strict rules:
//   - PUBLIC pages only. No login. No cookies. No credentials.
//   - No browser automation, no third-party scraping APIs.
//   - Strict per-handle timeout (4s). Hard cap on enrichments per share (2).
//   - Never throws. Failures return { fetched:false, blocked, confidence:'low' }.
//   - Do not log raw bio or HTML. Log only classification + reason codes.
//   - When Instagram returns a login wall, 4xx, 5xx, or empty meta tags,
//     the share flow continues normally (no inflated confidence).
// ---------------------------------------------------------------------------

type InstagramProfileClassification =
  | 'restaurant_or_business'
  | 'food_creator'
  | 'repost_page'
  | 'personal_account'
  | 'unrelated_or_unknown';

type InstagramProfileEnrichment = {
  platform: 'instagram';
  handle: string;
  fetched: boolean;
  blocked: boolean;
  classification: InstagramProfileClassification;
  displayName?: string;
  /** Sanitized bio. Bounded length. Stored only in-memory; never logged. */
  bio?: string;
  website?: string;
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
};

const PROFILE_FETCH_TIMEOUT_MS = 4_000;
const MAX_PROFILE_ENRICHMENTS_PER_SHARE = 2;
const PROFILE_BIO_MAX_LEN = 400;
const PROFILE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const PROFILE_BUSINESS_KEYWORDS: readonly string[] = [
  'restaurant', 'cafe', 'café', 'coffee', 'bakery', 'bar', 'pub', 'pizza',
  'pizzeria', 'ramen', 'sushi', 'taco', 'tacos', 'taqueria', 'burger',
  'burgers', 'kitchen', 'grill', 'bistro', 'diner', 'dessert', 'boba',
  'ice cream', 'gelato', 'bbq', 'barbecue', 'noodle', 'noodles', 'dumpling',
  'deli', 'eatery', 'brunch', 'brasserie', 'trattoria', 'osteria', 'izakaya',
  'taproom', 'brewery', 'winery', 'patisserie', 'creperie', 'cantina',
  'smokehouse', 'steakhouse', 'sandwich', 'chicken', 'donut', 'doughnut',
];

const PROFILE_CREATOR_PHRASES: readonly string[] = [
  'food blogger', 'food critic', 'food writer', 'food influencer',
  'content creator', 'foodie', 'food creator', 'reviews', 'food reviews',
  'restaurant reviews', 'finds', 'food finds', 'guide', 'food guide',
  'eats', 'best eats', 'media', 'magazine', 'newsletter', 'curator',
];

// Address: "<#> <street name> <suffix>". Conservative.
const PROFILE_ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][\w'.\- ]{1,40}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway)\b\.?/i;

// City + state pattern: "Los Angeles, CA" / "Brooklyn, NY".
const PROFILE_CITY_STATE_RE =
  /\b([A-Z][a-zA-Z][\w'.\- ]{1,30}?),\s*([A-Z]{2})\b/;

const PROFILE_WEBSITE_RE = /\bhttps?:\/\/[^\s"'<>]+/i;

/**
 * Enrich a single Instagram handle from its public profile page.
 * Best-effort. Always resolves; never throws.
 */
async function enrichInstagramProfile(
  handle: string,
): Promise<InstagramProfileEnrichment> {
  const safeHandle = (handle ?? '').replace(/^@+/, '').trim();
  const empty: InstagramProfileEnrichment = {
    platform: 'instagram',
    handle: safeHandle,
    fetched: false,
    blocked: false,
    classification: 'unrelated_or_unknown',
    confidence: 'low',
    reasons: [],
  };
  if (!safeHandle || !/^[A-Za-z0-9._]{2,30}$/.test(safeHandle)) {
    return { ...empty, reasons: ['invalid_handle'] };
  }

  const url = `https://www.instagram.com/${encodeURIComponent(safeHandle)}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROFILE_FETCH_TIMEOUT_MS);

  let html = '';
  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': PROFILE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    httpStatus = res.status;
    if (!res.ok) {
      // 401/403/429/5xx → treat as blocked.
      const blocked = res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500;
      return {
        ...empty,
        blocked,
        reasons: [`http_${res.status}`],
      };
    }
    html = await res.text();
  } catch (err) {
    const isAbort = (err as Error)?.name === 'AbortError';
    return {
      ...empty,
      blocked: false,
      reasons: [isAbort ? 'timeout' : 'fetch_error'],
    };
  } finally {
    clearTimeout(timer);
  }

  if (!html || html.length < 200) {
    return { ...empty, reasons: ['empty_html'] };
  }

  // Login wall detection. IG often renders a thin shell with a login prompt
  // for unauthenticated requests to private/limited profiles.
  const looksLikeLoginWall =
    /loginForm|"requires_login":true|Log in to Instagram|Log in to see/i.test(html);
  if (looksLikeLoginWall && !pickMeta(html, 'og:description')) {
    return { ...empty, blocked: true, reasons: ['login_wall'] };
  }

  // Parse public meta only.
  const ogTitle = pickMeta(html, 'og:title');
  const ogDescription = pickMeta(html, 'og:description');
  const metaDescription = pickMeta(html, 'description'); // <meta name="description">
  const twTitle = pickMeta(html, 'twitter:title');
  const twDescription = pickMeta(html, 'twitter:description');
  const pageTitle = pickTitle(html);

  // og:title typically: "Display Name (@handle) • Instagram photos and videos"
  // meta name="description" typically:
  //   "1,645 Followers, 302 Following, 187 Posts - CruzHacks (@cruzhacks) on Instagram: "⭐️ UC Santa Cruz's Premier Hackathon ...""
  // The quoted portion after "on Instagram:" is the actual profile bio.
  // Prefer meta name="description" over og:description for the bio since it
  // more reliably includes the quoted bio text in the format IG uses for
  // unauthenticated public page renders.
  const rawTitle = ogTitle ?? twTitle ?? pageTitle ?? '';

  // Try meta name="description" first for the bio (highest fidelity).
  const bioFromMetaDesc = metaDescription
    ? extractInstagramBioFromMetaDescription(metaDescription)
    : undefined;

  // Fallback: derive bio from og:description (or twitter:description).
  const rawDesc = ogDescription ?? twDescription ?? metaDescription ?? '';
  const bioFromOgDesc = parseBioFromOgDescription(rawDesc, undefined, safeHandle);

  const displayName = parseDisplayNameFromOgTitle(rawTitle) ??
    parseDisplayNameFromMetaDescription(metaDescription) ?? undefined;
  const bio = bioFromMetaDesc ?? bioFromOgDesc;

  if (!displayName && !bio) {
    return {
      ...empty,
      fetched: true,
      reasons: ['no_useful_metadata'],
    };
  }

  const evidence = extractBusinessEvidenceFromProfileMetadata(
    displayName,
    bio,
    /* website */ undefined,
  );

  // Classify.
  const classification = classifyProfile({
    handle: safeHandle,
    displayName,
    bio,
    evidence,
  });

  return {
    platform: 'instagram',
    handle: safeHandle,
    fetched: true,
    blocked: false,
    classification: classification.classification,
    displayName,
    bio: bio?.slice(0, PROFILE_BIO_MAX_LEN),
    website: evidence.website,
    extractedName: evidence.extractedName,
    extractedAddress: evidence.extractedAddress,
    extractedCity: evidence.extractedCity,
    confidence: classification.confidence,
    reasons: classification.reasons,
  };
}

function parseDisplayNameFromOgTitle(s: string | null | undefined): string | null {
  if (!s) return null;
  // "Display Name (@handle) • Instagram photos and videos"
  const m = s.match(/^(.*?)\s*\(@[A-Za-z0-9._]+\)/);
  if (m && m[1]) return m[1].trim().slice(0, 80);
  // Fallback: take part before bullet/pipe.
  const cleaned = s.split(/\s*[•|·]\s*/)[0]?.trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

/**
 * Extract the display name from meta name="description" content.
 *
 * Format IG uses for public profiles:
 *   "1,645 Followers, 302 Following, 187 Posts - CruzHacks (@cruzhacks) on Instagram: ..."
 *
 * Returns the name before the (@handle) portion, e.g. "CruzHacks".
 */
function parseDisplayNameFromMetaDescription(s: string | null | undefined): string | null {
  if (!s) return null;
  // Match: "... - <Name> (@handle) on Instagram:"
  const m = s.match(/[-–]\s+(.*?)\s*\(@[A-Za-z0-9._]+\)\s+on Instagram:/i);
  if (m && m[1]) return m[1].trim().slice(0, 80);
  return null;
}

/**
 * Extract the actual profile bio from meta name="description" content.
 *
 * IG encodes the profile bio as a quoted string after "on Instagram:":
 *   "1,645 Followers, 302 Following, 187 Posts - CruzHacks (@cruzhacks) on Instagram: "⭐️ UC Santa Cruz's Premier Hackathon ...""
 *
 * Returns the unquoted bio text, e.g. "⭐️ UC Santa Cruz's Premier Hackathon ..."
 * Returns null if the pattern is not found.
 *
 * Examples:
 *   extractInstagramBioFromMetaDescription(
 *     '1,645 Followers, 302 Following, 187 Posts - CruzHacks (@cruzhacks) on Instagram: "⭐️ UC Santa Cruz\'s Premier Hackathon"'
 *   ) → '⭐️ UC Santa Cruz\'s Premier Hackathon'
 *
 *   extractInstagramBioFromMetaDescription(
 *     '200 Followers, 50 Following, 12 Posts - Joe\'s Pizza (@joespizzanyc) on Instagram: "7 Carmine St, New York, NY · Best pizza in NYC"'
 *   ) → '7 Carmine St, New York, NY · Best pizza in NYC'
 */
function extractInstagramBioFromMetaDescription(s: string): string | null {
  if (!s) return null;
  // Match: `... on Instagram: "bio text"` — both curly (\u201C/\u201D) and straight quotes.
  const m = s.match(/on Instagram:\s*[\u201C"]([\s\S]*?)[\u201D"]?\s*$/i);
  if (m && m[1]) {
    const bio = m[1].replace(/\s+/g, ' ').trim();
    return bio.length >= 2 ? bio.slice(0, PROFILE_BIO_MAX_LEN) : null;
  }
  // Fallback: everything after "on Instagram: " without quotes.
  const m2 = s.match(/on Instagram:\s+([\s\S]{4,})/i);
  if (m2 && m2[1]) {
    const bio = m2[1].replace(/\s+/g, ' ').trim();
    return bio.length >= 2 ? bio.slice(0, PROFILE_BIO_MAX_LEN) : null;
  }
  return null;
}

function parseBioFromOgDescription(
  desc: string | null | undefined,
  displayName?: string,
  handle?: string,
): string | undefined {
  if (!desc) return undefined;
  // IG og:description usually starts with "N Followers, M Following, K Posts - See Instagram photos and videos from <Name>"
  // followed sometimes by " - <bio prefix>". We try to take whatever is AFTER
  // the standard "See Instagram..." sentinel as bio content.
  const sentinelRe = /See Instagram (?:photos|reels and photos|posts and reels|videos|reels) (?:from|by)\s+[^.\n]{1,80}\.?/i;
  let bio: string | undefined;
  const splitIdx = desc.search(sentinelRe);
  if (splitIdx >= 0) {
    const afterMatch = desc.slice(splitIdx).replace(sentinelRe, '').trim();
    if (afterMatch.length >= 4) bio = afterMatch;
  }
  // Fallback: if og:description is short (< 220 chars) and doesn't look like
  // the followers boilerplate, treat it as the bio.
  if (!bio && desc.length < 220 && !/Followers,\s*\d/.test(desc)) {
    bio = desc;
  }
  if (!bio) return undefined;

  // Strip leading display name / handle echoes.
  if (displayName) {
    bio = bio.replace(new RegExp(`^${escapeReg(displayName)}[\\s:,-]+`, 'i'), '');
  }
  if (handle) {
    bio = bio.replace(new RegExp(`^@?${escapeReg(handle)}[\\s:,-]+`, 'i'), '');
  }
  bio = bio.replace(/\s+/g, ' ').trim();
  if (bio.length > PROFILE_BIO_MAX_LEN) bio = bio.slice(0, PROFILE_BIO_MAX_LEN);
  return bio || undefined;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type BusinessEvidence = {
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  website?: string;
  hasBusinessKeyword: boolean;
  hasCreatorPhrase: boolean;
};

function extractBusinessEvidenceFromProfileMetadata(
  displayName?: string,
  bio?: string,
  website?: string,
): BusinessEvidence {
  const ev: BusinessEvidence = {
    hasBusinessKeyword: false,
    hasCreatorPhrase: false,
  };

  // IMPORTANT: scan BIO only for keyword/creator signals.
  // Using displayName in the scan would let a display name like "Ramen Palace"
  // classify any account as a restaurant even with zero bio evidence.
  const bioLower = (bio ?? '').toLowerCase();

  for (const kw of PROFILE_BUSINESS_KEYWORDS) {
    if (bioLower.includes(kw)) {
      ev.hasBusinessKeyword = true;
      break;
    }
  }
  for (const p of PROFILE_CREATOR_PHRASES) {
    if (bioLower.includes(p)) {
      ev.hasCreatorPhrase = true;
      break;
    }
  }

  if (bio) {
    const addr = bio.match(PROFILE_ADDRESS_RE);
    if (addr) ev.extractedAddress = addr[0].replace(/\s+/g, ' ').trim();
    const cs = bio.match(PROFILE_CITY_STATE_RE);
    if (cs) ev.extractedCity = `${cs[1].trim()}, ${cs[2]}`;
    const w = bio.match(PROFILE_WEBSITE_RE);
    if (w) ev.website = w[0];
  }
  if (website && !ev.website) ev.website = website;

  if (displayName) {
    // Only promote displayName to extractedName when BIO contains real
    // business evidence (address, city, or business keyword).
    // A display name alone — however business-sounding — is NOT evidence
    // that the account represents a single physical restaurant.
    const bioHasEvidence =
      !!ev.extractedAddress ||
      !!ev.extractedCity ||
      ev.hasBusinessKeyword;
    if (bioHasEvidence) {
      ev.extractedName = displayName.trim().slice(0, 80);
    } else {
      // displayName is kept as metadata on the enrichment object but must
      // not be used as a Places query on its own.
      // Callers log: display_name_not_used_without_bio_evidence
    }
  }

  return ev;
}

function classifyProfile(input: {
  handle: string;
  displayName?: string;
  bio?: string;
  evidence: BusinessEvidence;
}): { classification: InstagramProfileClassification; confidence: 'high' | 'medium' | 'low'; reasons: string[] } {
  const { handle, evidence } = input;
  const reasons: string[] = [];

  // Creator/repost evidence wins over business evidence (avoid wrong saves).
  if (evidence.hasCreatorPhrase) {
    reasons.push('bio_creator_phrase');
    return { classification: 'food_creator', confidence: 'high', reasons };
  }
  // Strong business signals: address OR (business keyword + city/state).
  if (evidence.extractedAddress) {
    reasons.push('bio_address');
    if (evidence.extractedCity) reasons.push('bio_city_state');
    return {
      classification: 'restaurant_or_business',
      confidence: 'high',
      reasons,
    };
  }
  if (evidence.hasBusinessKeyword && evidence.extractedCity) {
    reasons.push('bio_business_keyword');
    reasons.push('bio_city_state');
    return {
      classification: 'restaurant_or_business',
      confidence: 'high',
      reasons,
    };
  }
  if (evidence.hasBusinessKeyword) {
    reasons.push('bio_business_keyword');
    return {
      classification: 'restaurant_or_business',
      confidence: 'medium',
      reasons,
    };
  }

  // No bio evidence at all. A business-like handle or display name is not
  // enough — log and return unrelated_or_unknown so the handle is not
  // searched as a venue name.
  reasons.push('no_bio_evidence');
  return {
    classification: 'unrelated_or_unknown',
    confidence: 'low',
    reasons,
  };
}

/**
 * Build a Google Places query from a fetched + classified profile.
 *
 * Requires at least one geo anchor (address or city) from the bio.
 * displayName or handle alone are NOT sufficient — we would risk searching
 * an unrelated business with the same display name in a different city.
 * Logs enrichment_query_blocked_no_address_or_city when blocked.
 */
function buildPlacesQueryFromEnrichment(
  e: InstagramProfileEnrichment,
): string | null {
  if (e.classification !== 'restaurant_or_business') return null;

  // Require at least one geo anchor derived from the bio.
  const hasGeoAnchor = !!e.extractedAddress || !!e.extractedCity;
  if (!hasGeoAnchor) {
    console.log(
      `[process-share-link] enrichment_query_blocked_no_address_or_city handle=@${e.handle}`,
    );
    return null;
  }

  const parts: string[] = [];
  // Prefer bio-derived name; never fall back to raw displayName or handle.
  if (e.extractedName) parts.push(e.extractedName);
  if (e.extractedAddress) parts.push(e.extractedAddress);
  else if (e.extractedCity) parts.push(e.extractedCity);
  const q = parts.join(' ').replace(/\s+/g, ' ').trim();

  if (q.length < 4) {
    console.log(
      `[process-share-link] enrichment_query_blocked_no_address_or_city handle=@${e.handle}`,
    );
    return null;
  }
  return q;
}

/**
 * Extract raw @handles from text (no creator filtering). Used to decide
 * which handles to enrich. Returns at most `limit` unique lowercase handles
 * in order of first appearance.
 */
function extractRawHandles(
  title: string | null,
  description: string | null,
  sourceUrl: string,
  limit: number,
  posterHandle: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (h: string) => {
    const key = h.toLowerCase();
    if (seen.has(key)) return;
    if (!/^[A-Za-z0-9._]{2,30}$/.test(h)) return;
    if (/^\d+$/.test(h)) return;
    seen.add(key);
    out.push(h);
  };

  // Poster handle always comes first so it is enriched before caption-tagged handles.
  if (posterHandle) push(posterHandle);

  const blob = [title, description].filter(Boolean).join('\n');
  const re = /@([A-Za-z0-9._]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    push(m[1]);
    if (out.length >= limit) return out;
  }
  // Pull handle from URL path: instagram.com/<handle>/...
  const urlMatch = sourceUrl.match(/instagram\.com\/([A-Za-z0-9._]+)(?:\/|$)/i);
  if (urlMatch) {
    const reserved = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts']);
    if (!reserved.has(urlMatch[1].toLowerCase())) push(urlMatch[1]);
  }
  return out.slice(0, limit);
}
