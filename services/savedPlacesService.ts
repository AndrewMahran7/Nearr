/**
 * Saved-places service for Nearr.
 *
 * Responsible for the two-step write that turns a Google Places search
 * result into a row the user owns:
 *
 *   1. Look up the canonical row in `places` by `google_place_id`. If it
 *      already exists, REUSE its id. Only INSERT if missing. We never
 *      UPDATE the shared `places` row — RLS only permits SELECT/INSERT,
 *      and an UPDATE path (via upsert/onConflict) would be rejected with
 *      "new row violates row-level security policy" for any place that
 *      another user already saved.
 *   2. Insert a `saved_places` row tying that place to the current user
 *      with their chosen radius / source / notes. If the user already has
 *      this place saved (`unique(user_id, place_id)`, Postgres 23505), we
 *      ENRICH the existing row instead of crashing or discarding the new
 *      context: the same saved_places.id and place_id survive, and the
 *      incoming post fills empty source/ai_note fields. See
 *      `lib/savedPlaceSourceMerge.ts` for the merge policy — nothing that
 *      carries user state (notes, reminders, visit/archive, counts) is ever
 *      rewritten by an enrichment.
 */

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { logDebug } from '@/lib/logger';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { triggerGeofenceResync } from '@/lib/geofencing';
import {
  isLikelyOfflineError,
  OfflineMutationError,
  readSavedPlaceFromCache,
  writeSavedPlacesCache,
} from '@/lib/savedPlacesCache';
import {
  deleteDemoSavedPlace,
  getDemoSavedPlace,
  listDemoSavedPlaces,
  saveDemoSavedPlace,
  updateDemoSavedPlace,
  markDemoVisited,
  markDemoArchived,
  unarchiveDemo,
} from '@/services/demo';
import type { PlaceCandidate } from '@/services/placesService';
import { isSameCanonicalPlace } from '@/lib/placeCanonicalization';
import { resolvePlaceCategory, type CategoryResolution } from '@/lib/placeCategory';
import {
  planSavedPlaceEnrichment,
  type GuardedPatch,
  type SavedPlaceEnrichmentPlan,
} from '@/lib/savedPlaceSourceMerge';
import { normalizeShareUrl } from '@/lib/shareAgent/tiktokUrl';
import { attachSavedPlaceSource } from '@/services/savedPlaceSourcesService';
import type {
  PlaceRow,
  RadiusUnit,
  SavedPlace,
  SavedPlaceWithPlace,
  SourceType,
} from '@/types';

export type SaveSavedPlaceInput = {
  candidate: PlaceCandidate;
  /** null/null means "use the category-aware automatic radius". */
  radiusValue: number | null;
  radiusUnit: RadiusUnit | null;
  sourceType?: SourceType;
  sourceUrl?: string | null;
  notes?: string | null;
  aiNote?: string | null;
};

export type SaveSavedPlaceResult =
  | { status: 'saved'; saved: SavedPlaceWithPlace; savedPlaceId: string }
  | {
      status: 'duplicate';
      place: PlaceRow;
      savedPlaceId: string | null;
      /** The existing row re-read AFTER enrichment, so callers can refresh the
       *  cache with the newly attached source instead of showing stale data. */
      saved?: SavedPlaceWithPlace | null;
      /** What this share was actually able to add to the existing save. */
      enrichment?: SavedPlaceEnrichmentPlan;
    };

type ExistingSavedPlaceSource = {
  id: string;
  source_url: string | null;
  source_type: SourceType | null;
  ai_note: string | null;
};

type ExistingSavedPlaceLookup = ExistingSavedPlaceSource & {
  place: PlaceRow;
};

type ExistingSavedPlaceLookupRow = ExistingSavedPlaceSource & {
  place: PlaceRow | PlaceRow[] | null;
};

const shareUrlKey = (url: string): string => normalizeShareUrl(url).url;

/** The chainable subset of a PostgREST update builder used by the guarded
 *  enrichment writes. Kept structural so it needs no supabase-js generics. */
type PostgrestFilter = {
  eq(column: string, value: unknown): PostgrestFilter;
  is(column: string, value: null): PostgrestFilter;
  then<T>(onfulfilled: (value: { error: { message: string } | null }) => T): PromiseLike<T>;
};

function matchesExistingRealPlace(
  candidate: PlaceCandidate,
  existing: ExistingSavedPlaceLookup,
): boolean {
  return isSameCanonicalPlace(candidate, existing.place);
}

/**
 * Enrich a saved place the user already owns. This is the ONLY write path for
 * "the shared post resolved to something I already saved", and it is additive:
 * the row's id, place_id, notes, reminder settings, visit/archive state,
 * opportunity count and created_at are all left exactly as they were.
 *
 * Every enrichment write carries the row state it was planned against, so two
 * share jobs racing on the same place converge on ONE coherent source: the
 * loser's type and note preconditions fail against the winner's row rather
 * than describing the winner's post. A retried job is a no-op.
 */
async function enrichExistingSavedPlace(
  existing: {
    id: string;
    source_url?: string | null;
    source_type?: string | null;
    ai_note?: string | null;
  },
  input: SaveSavedPlaceInput,
): Promise<SavedPlaceEnrichmentPlan> {
  // Radius/notes are caller-supplied user configuration, not source context.
  // No share path passes them; a manual re-save with an explicit radius does.
  const patch: Record<string, unknown> = {};
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.radiusValue !== null || input.radiusUnit !== null) {
    patch.radius_value = input.radiusValue;
    patch.radius_unit = input.radiusUnit;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from('saved_places')
      .update(patch)
      .eq('id', existing.id);
    if (error) {
      console.warn(
        '[savedPlacesService] existing saved_place update failed (non-fatal)',
        error.message,
      );
    }
  }

  const plan = planSavedPlaceEnrichment(
    existing,
    { sourceUrl: input.sourceUrl, sourceType: input.sourceType, aiNote: input.aiNote },
    shareUrlKey,
  );

  // Each guarded patch becomes one conditional UPDATE. `expectSourceUrl` is
  // the observed value, so a row whose source changed underneath us matches
  // zero rows instead of gaining mixed provenance.
  const applyGuarded = async (
    guarded: GuardedPatch<Record<string, unknown>>,
    label: string,
    extra?: (query: PostgrestFilter) => PostgrestFilter,
  ): Promise<void> => {
    let query: PostgrestFilter = supabase
      .from('saved_places')
      .update(guarded.patch)
      .eq('id', existing.id);
    query = guarded.expectSourceUrl === null
      ? query.is('source_url', null)
      : query.eq('source_url', guarded.expectSourceUrl);
    if (guarded.expectSourceType !== undefined) {
      query = guarded.expectSourceType === null
        ? query.is('source_type', null)
        : query.eq('source_type', guarded.expectSourceType);
    }
    if (extra) query = extra(query);
    const { error } = await query;
    if (error) {
      console.warn(`[savedPlacesService] ${label} failed (non-fatal)`, error.message);
    }
  };

  if (plan.sourcePatch) {
    await applyGuarded(plan.sourcePatch, 'source attach');
  }

  if (plan.sourceTypePatch) {
    await applyGuarded(plan.sourceTypePatch, 'source type backfill');
  }

  if (plan.aiNotePatch) {
    await applyGuarded(plan.aiNotePatch, 'ai_note attach', (query) => query.is('ai_note', null));
  }

  logDebug('savedPlacesService', 'enriched existing save', {
    savedPlaceId: existing.id,
    source: plan.source,
    aiNote: plan.aiNote,
  });
  return plan;
}

/** Re-read the enriched row for the cache. Never turns a successful
 *  enrichment into a save failure — the write already committed. */
async function readSavedPlaceAfterEnrichment(
  savedPlaceId: string,
): Promise<SavedPlaceWithPlace | null> {
  try {
    return await getSavedPlace(savedPlaceId);
  } catch (err) {
    console.warn(
      '[savedPlacesService] enriched row re-read failed (non-fatal)',
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

async function patchSavedPlaceCategory(
  savedPlaceId: string,
  resolution: CategoryResolution,
): Promise<void> {
  const { error } = await supabase
    .from('saved_places')
    .update({
      category: resolution.category,
      category_source: resolution.source,
      category_confidence: resolution.confidence,
      category_model_version: resolution.modelVersion,
      categorized_at: new Date().toISOString(),
    })
    .eq('id', savedPlaceId)
    .eq('category_user_overridden', false);
  if (error) console.warn('[savedPlacesService] category update failed', error.message);
}

async function findExistingSavedPlaceForUser(
  userId: string,
  candidate: PlaceCandidate,
  sourceUrl: string | null | undefined,
): Promise<ExistingSavedPlaceLookup | null> {
  const { data, error } = await supabase
    .from('saved_places')
    .select('id, source_url, source_type, ai_note, place:places(*)')
    .eq('user_id', userId);

  if (error) {
    console.warn('[savedPlacesService] fallback dedupe lookup failed', error.message);
    return null;
  }

  const rows = ((data ?? []) as ExistingSavedPlaceLookupRow[])
    .map((row) => {
      const place = Array.isArray(row.place) ? row.place[0] : row.place;
      if (!place) return null;
      return {
        id: row.id,
        source_url: row.source_url ?? null,
        source_type: row.source_type ?? null,
        ai_note: row.ai_note ?? null,
        place,
      } satisfies ExistingSavedPlaceLookup;
    })
    .filter((row): row is ExistingSavedPlaceLookup => row !== null);
  if (rows.length === 0) return null;

  if (sourceUrl) {
    const exactSourceMatch = rows.find((row) => row.source_url === sourceUrl);
    if (exactSourceMatch) return exactSourceMatch;
  }

  return rows.find((row) => matchesExistingRealPlace(candidate, row)) ?? null;
}

/** Upsert place + insert saved_place. Throws on unexpected errors. */
export async function saveSavedPlace(
  input: SaveSavedPlaceInput,
): Promise<SaveSavedPlaceResult> {
  if (isDemoMode()) return await saveDemoSavedPlace(input);
  const { candidate, radiusValue, radiusUnit } = input;
  const categoryResolution = resolvePlaceCategory({
    placeName: candidate.name,
    googlePrimaryType: candidate.primaryType,
    googleTypes: candidate.rawTypes,
  });

  logDebug('savedPlacesService', 'saving', {
    googlePlaceId: candidate.googlePlaceId,
    name: candidate.name,
    radiusValue,
    radiusUnit,
  });

  // --- auth ---------------------------------------------------------------
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(`Not signed in: ${userErr.message}`);
  const userId = userRes.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const existingForUser = await findExistingSavedPlaceForUser(
    userId,
    candidate,
    input.sourceUrl,
  );
  if (existingForUser?.source_url && input.sourceUrl && existingForUser.source_url === input.sourceUrl) {
    console.debug('[savedPlacesService] exact source_url duplicate, reusing existing save', {
      sourceUrl: input.sourceUrl,
      savedPlaceId: existingForUser.id,
      placeId: existingForUser.place.id,
    });
    const enrichment = await enrichExistingSavedPlace(existingForUser, input);
    await patchSavedPlaceCategory(existingForUser.id, categoryResolution);
    await attachSavedPlaceSource({
      userId,
      savedPlaceId: existingForUser.id,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      aiNote: input.aiNote,
    });
    return {
      status: 'duplicate',
      place: existingForUser.place,
      savedPlaceId: existingForUser.id,
      saved: await readSavedPlaceAfterEnrichment(existingForUser.id),
      enrichment,
    };
  }

  // --- 1. resolve canonical place (SELECT first, INSERT only if missing) -
  // We deliberately do NOT use `.upsert(..., { onConflict: 'google_place_id' })`
  // here. Upsert compiles to INSERT ... ON CONFLICT DO UPDATE, and the
  // `places` table's RLS policy only grants SELECT + INSERT (no UPDATE),
  // so the conflict path would fail with:
  //   "new row violates row-level security policy (USING expression) for
  //    table \"places\""
  // ...whenever the place was previously inserted (by this user or any
  // other user). Reusing the existing row by id is correct anyway —
  // `places` is intentionally a shared, dedup-by-google_place_id table.
  let placeRow: PlaceRow | null = null;

  if (candidate.googlePlaceId) {
    const { data: existing, error: lookupErr } = await supabase
      .from('places')
      .select('*')
      .eq('google_place_id', candidate.googlePlaceId)
      .maybeSingle();

    if (lookupErr) {
      console.warn('[savedPlacesService] place lookup failed', lookupErr.message);
      throw new Error(lookupErr.message);
    }

    if (existing) {
      console.debug('[savedPlacesService] place exists, reusing', {
        googlePlaceId: candidate.googlePlaceId,
        placeId: (existing as PlaceRow).id,
      });
      placeRow = existing as PlaceRow;
    }
  }

  if (!placeRow && existingForUser?.place) {
    console.debug('[savedPlacesService] fallback dedupe matched existing user place', {
      candidateGooglePlaceId: candidate.googlePlaceId,
      existingPlaceId: existingForUser.place.id,
      existingSavedPlaceId: existingForUser.id,
      rule: 'exact_name_address_nearby',
    });
    placeRow = existingForUser.place;
  }

  if (!placeRow) {
    const placePayload = {
      google_place_id: candidate.googlePlaceId,
      name: candidate.name,
      formatted_address: candidate.formattedAddress,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      category: candidate.category,
      google_maps_url: candidate.googleMapsUrl,
      short_formatted_address: candidate.shortFormattedAddress ?? null,
      google_primary_type: candidate.primaryType ?? null,
      google_types: candidate.rawTypes ?? null,
      google_type_label: candidate.googleMapsTypeLabel ?? candidate.primaryTypeDisplayName ?? null,
      business_status: candidate.businessStatus ?? null,
    };

    console.debug('[savedPlacesService] inserting new place', {
      googlePlaceId: candidate.googlePlaceId,
    });

    const { data: inserted, error: insertErr } = await supabase
      .from('places')
      .insert(placePayload)
      .select()
      .single();

    if (insertErr || !inserted) {
      // Race: another client inserted the same google_place_id between our
      // SELECT and INSERT. Recover by re-selecting.
      if ((insertErr as any)?.code === '23505' && candidate.googlePlaceId) {
        const { data: raced } = await supabase
          .from('places')
          .select('*')
          .eq('google_place_id', candidate.googlePlaceId)
          .maybeSingle();
        if (raced) {
          placeRow = raced as PlaceRow;
        }
      }
      if (!placeRow) {
        console.warn(
          '[savedPlacesService] place insert failed',
          insertErr?.message,
        );
        throw new Error(insertErr?.message ?? 'Could not save place.');
      }
    } else {
      placeRow = inserted as PlaceRow;
    }
  }

  // --- 2. insert (or update) saved_places row ----------------------------
  const savedPayload = {
    user_id: userId,
    place_id: placeRow.id,
    radius_value: radiusValue,
    radius_unit: radiusUnit,
    source_type: input.sourceType ?? 'manual',
    source_url: input.sourceUrl ?? null,
    // User notes are authored only. Source-derived memory cues belong in
    // `ai_note`, never in the field presented as the user's own writing.
    notes: input.notes ?? null,
    ai_note: input.aiNote ?? null,
    category: categoryResolution.category,
    category_source: categoryResolution.source,
    category_confidence: categoryResolution.confidence,
    category_model_version: categoryResolution.modelVersion,
    category_user_overridden: false,
    categorized_at: new Date().toISOString(),
  };

  console.debug('[savedPlacesService] saving user place', {
    userId,
    placeId: placeRow.id,
  });

  const { data: saved, error: savedErr } = await supabase
    .from('saved_places')
    .insert(savedPayload)
    .select('*, place:places(*)')
    .single();

  if (savedErr) {
    // Postgres unique_violation on (user_id, place_id) — user already has
    // this place saved. Update the existing row's source / radius / notes
    // so a re-save from a new link refreshes those fields, and return it
    // as a duplicate so the UI can show "Already saved".
    if ((savedErr as any).code === '23505') {
      console.debug('[savedPlacesService] saved_places duplicate, enriching existing', {
        userId,
        placeId: placeRow.id,
      });

      const { data: existingSaved, error: existingSavedErr } = await supabase
        .from('saved_places')
        .select('id, source_url, source_type, ai_note')
        .eq('user_id', userId)
        .eq('place_id', placeRow.id)
        .maybeSingle();

      if (existingSavedErr) {
        console.warn(
          '[savedPlacesService] duplicate lookup failed (non-fatal)',
          existingSavedErr.message,
        );
      }

      let enrichment: SavedPlaceEnrichmentPlan | undefined;
      if (existingSaved?.id) {
        enrichment = await enrichExistingSavedPlace(existingSaved, input);
        await patchSavedPlaceCategory(existingSaved.id, categoryResolution);
        await attachSavedPlaceSource({
          userId,
          savedPlaceId: existingSaved.id,
          sourceUrl: input.sourceUrl,
          sourceType: input.sourceType,
          aiNote: input.aiNote,
        });
      }

      return {
        status: 'duplicate',
        place: placeRow,
        savedPlaceId: existingSaved?.id ?? null,
        saved: existingSaved?.id ? await readSavedPlaceAfterEnrichment(existingSaved.id) : null,
        enrichment,
      };
    }
    console.warn('[savedPlacesService] saved_places insert failed', savedErr.message);
    throw new Error(savedErr.message);
  }

  // Resync OS-level geofences after a successful save. Fire-and-forget;
  // never block the UI on geofence registration.
  triggerGeofenceResync();

  const savedPlaceId = (saved as SavedPlace).id;
  await attachSavedPlaceSource({
    userId,
    savedPlaceId,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    aiNote: input.aiNote,
  });
  const hydrated = await readSavedPlaceAfterEnrichment(savedPlaceId);

  return {
    status: 'saved',
    saved: hydrated ?? saved as SavedPlace & { place: PlaceRow },
    savedPlaceId,
  };
}

// ---------------------------------------------------------------------------
// Read / update / delete
// ---------------------------------------------------------------------------

/** List the current user's saved places, newest first, with the joined place. */
export async function listSavedPlaces(
  options: { persistCache?: boolean } = {},
): Promise<SavedPlaceWithPlace[]> {
  if (isDemoMode()) return await listDemoSavedPlaces();
  if (isMapPreviewMode()) return await listDemoSavedPlaces();

  // Log the session state before querying so we can confirm RLS will pass.
  // Never log the actual token — only booleans.
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  logDebug('savedPlacesService', 'listSavedPlaces start', {
    sessionPresent: !!sessionData.session,
    userIdPresent: !!sessionUserId,
  });

  const { data, error } = await supabase
    .from('saved_places')
    .select('*, place:places(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn(
      '[savedPlacesService] list failed',
      'message=', error.message,
      'code=', (error as any).code,
      'details=', (error as any).details,
    );
    throw new Error(error.message);
  }
  logDebug('savedPlacesService', 'listSavedPlaces done', { count: (data ?? []).length });
  let rows = (data ?? []) as SavedPlaceWithPlace[];
  // Keep the map's authoritative saved-place query unchanged. Child source
  // provenance is additive and failure-tolerant during staged rollout.
  if (rows.length > 0) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('saved_place_sources')
      .select('*')
      .in('saved_place_id', rows.map((row) => row.id))
      .order('first_attached_at', { ascending: true });
    if (!sourceError) {
      const bySaved = new Map<string, any[]>();
      for (const source of sourceRows ?? []) {
        const group = bySaved.get(source.saved_place_id) ?? [];
        group.push(source);
        bySaved.set(source.saved_place_id, group);
      }
      rows = rows.map((row) => ({ ...row, sources: bySaved.get(row.id) ?? [] }));
    } else {
      console.warn('[savedPlacesService] source list failed (non-fatal)', sourceError.message);
    }
  }
  // Refresh the offline cache on every successful list. The hook
  // (`useSavedPlaces`) also writes the cache, but doing it here covers any
  // service caller that bypasses the hook (future code, scripts).
  if (sessionUserId && options.persistCache !== false) void writeSavedPlacesCache(sessionUserId, rows);
  return rows;
}

/**
 * Fetch a single saved place by its `saved_places.id`.
 *
 * Offline behaviour (Stage 0 read-only cache): if the network fetch fails
 * with a likely-offline error AND the row is present in the cache written
 * by `listSavedPlaces`, we return the cached copy so the detail screen
 * still renders. Cached data may be stale; mutations remain blocked.
 */
export async function getSavedPlace(id: string): Promise<SavedPlaceWithPlace | null> {
  if (isDemoMode()) return await getDemoSavedPlace(id);
  if (isMapPreviewMode()) return await getDemoSavedPlace(id);
  try {
    const { data, error } = await supabase
      .from('saved_places')
      .select('*, place:places(*), sources:saved_place_sources(*)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.warn('[savedPlacesService] get failed', error.message);
      // Wrap network-y errors so the cache-fallback branch below runs.
      if (isLikelyOfflineError(error)) throw new Error(error.message);
      throw new Error(error.message);
    }
    return (data as SavedPlaceWithPlace | null) ?? null;
  } catch (err) {
    if (!isLikelyOfflineError(err)) throw err;
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUserId = sessionData.session?.user?.id ?? null;
    const cached = await readSavedPlaceFromCache(sessionUserId, id);
    if (cached) {
      console.log('[offline] using_cached_saved_places id=', id);
      return cached;
    }
    throw err;
  }
}

export type SavedPlacePatch = {
  radius_value?: number | null;
  radius_unit?: RadiusUnit | null;
  notifications_enabled?: boolean;
  notes?: string | null;
  ai_note?: string | null;
};

/**
 * Resolve the shared `places` row for a candidate, reusing the existing row
 * whenever the canonical google_place_id is already known. `places` is a shared
 * dedupe-by-google_place_id table, so we only ever SELECT or INSERT.
 */
async function resolvePlaceRowForCandidate(candidate: PlaceCandidate): Promise<PlaceRow> {
  if (candidate.googlePlaceId) {
    const { data: existing, error } = await supabase
      .from('places')
      .select('*')
      .eq('google_place_id', candidate.googlePlaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (existing) return existing as PlaceRow;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('places')
    .insert({
      google_place_id: candidate.googlePlaceId,
      name: candidate.name,
      formatted_address: candidate.formattedAddress,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      category: candidate.category,
      google_maps_url: candidate.googleMapsUrl,
      short_formatted_address: candidate.shortFormattedAddress ?? null,
      google_primary_type: candidate.primaryType ?? null,
      google_types: candidate.rawTypes ?? null,
      google_type_label: candidate.googleMapsTypeLabel ?? candidate.primaryTypeDisplayName ?? null,
      business_status: candidate.businessStatus ?? null,
    })
    .select()
    .single();

  if (inserted) return inserted as PlaceRow;
  // Race: another client inserted the same google_place_id — re-select.
  if ((insertErr as { code?: string } | null)?.code === '23505' && candidate.googlePlaceId) {
    const { data: raced } = await supabase
      .from('places')
      .select('*')
      .eq('google_place_id', candidate.googlePlaceId)
      .maybeSingle();
    if (raced) return raced as PlaceRow;
  }
  throw new Error(insertErr?.message ?? 'Could not resolve place.');
}

/**
 * Re-point an EXISTING saved place at the correct provider result after Nearr
 * saved the wrong one.
 *
 * Updates the row in place — it never inserts a second saved_places row — and
 * preserves the user's note plus the original social-post context. RLS scopes
 * the update to the owner. The category is recomputed from the new provider
 * types unless the user had explicitly overridden it.
 */
export async function correctSavedPlace(args: {
  savedPlaceId: string;
  replacement: PlaceCandidate;
}): Promise<{
  saved: SavedPlaceWithPlace;
  mergedSavedPlaceId: string | null;
  sourceJobId: string | null;
  sourceResultId: string | null;
  sourceRuleVersion: string | null;
}> {
  if (isDemoMode() || isMapPreviewMode()) {
    throw new Error('Corrections are unavailable in preview mode.');
  }
  const placeRow = await resolvePlaceRowForCandidate(args.replacement);
  const categoryResolution = resolvePlaceCategory({
    placeName: args.replacement.name,
    googlePrimaryType: args.replacement.primaryType,
    googleTypes: args.replacement.rawTypes,
  });

  const { data: correctionRows, error: correctionError } = await supabase.rpc(
    'correct_saved_place_provider',
    {
      p_saved_place_id: args.savedPlaceId,
      p_place_id: placeRow.id,
      p_corrected_google_place_id: args.replacement.googlePlaceId,
      p_category: categoryResolution.category,
      p_category_source: categoryResolution.source,
      p_category_confidence: categoryResolution.confidence,
      p_category_model_version: categoryResolution.modelVersion,
    },
  );
  if (correctionError) rethrowMutationError('correct place', correctionError);
  const correction = (Array.isArray(correctionRows) ? correctionRows[0] : correctionRows) as {
    saved_place_id?: string;
    merged_saved_place_id?: string | null;
    source_job_id?: string | null;
    source_result_id?: string | null;
    source_rule_version?: string | null;
  } | null;
  if (!correction?.saved_place_id) {
    throw new Error('The correction did not complete. Please retry.');
  }
  const retainedId = correction.saved_place_id;
  const { data: retained, error: retainedErr } = await supabase
    .from('saved_places')
    .select('*, place:places(*), sources:saved_place_sources(*)')
    .eq('id', retainedId)
    .maybeSingle();
  if (retainedErr) rethrowMutationError('correct place', retainedErr);
  if (!retained) throw new Error('This saved place is no longer available.');
  triggerGeofenceResync();
  return {
    saved: retained as SavedPlaceWithPlace,
    mergedSavedPlaceId: correction?.merged_saved_place_id ?? null,
    sourceJobId: correction?.source_job_id ?? null,
    sourceResultId: correction?.source_result_id ?? null,
    sourceRuleVersion: correction?.source_rule_version ?? null,
  };
}

/**
 * Convert a likely-offline error from a saved-place mutation into the
 * typed `OfflineMutationError` the UI knows how to display. Re-throws
 * any other error untouched.
 *
 * Action label is used both in the friendly message and the log line so
 * we can confirm in support traces which surface tried to write while
 * offline.
 */
function rethrowMutationError(action: string, err: unknown): never {
  if (isLikelyOfflineError(err)) {
    console.log(`[offline] network_action_blocked action=${action}`);
    throw new OfflineMutationError();
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export async function updateSavedPlace(id: string, patch: SavedPlacePatch): Promise<void> {
  if (isDemoMode()) return await updateDemoSavedPlace(id, patch);
  console.log('[savedPlacesService] update', id, patch);
  try {
    const { error } = await supabase.from('saved_places').update(patch).eq('id', id);
    if (error) {
      console.warn('[savedPlacesService] update failed', error.message);
      rethrowMutationError('update', error);
    }
  } catch (err) {
    rethrowMutationError('update', err);
  }
  // Toggling reminders / changing radius affects the geofence set.
  if (
    patch.notifications_enabled !== undefined ||
    patch.radius_value !== undefined ||
    patch.radius_unit !== undefined
  ) {
    triggerGeofenceResync();
  }
}

export async function deleteSavedPlace(id: string): Promise<void> {
  if (isDemoMode()) return await deleteDemoSavedPlace(id);
  console.log('[savedPlacesService] delete', id);
  try {
    const { error } = await supabase.from('saved_places').delete().eq('id', id);
    if (error) {
      console.warn('[savedPlacesService] delete failed', error.message);
      rethrowMutationError('delete', error);
    }
  } catch (err) {
    rethrowMutationError('delete', err);
  }
  triggerGeofenceResync();
}

// ---------------------------------------------------------------------------
// Opportunity / visited / archived state
// ---------------------------------------------------------------------------

/**
 * Mark a saved place as visited. Visited rows are hidden from the default
 * Places filter and excluded from proximity / geofence eligibility.
 *
 * Also turns reminders off so the OS-level geofence is dropped on the next
 * resync (and so the explicit `archived_at IS NULL AND visited_at IS NULL`
 * filter is redundant-safe).
 */
export async function markVisited(savedPlaceId: string): Promise<void> {
  if (isDemoMode()) return await markDemoVisited(savedPlaceId);
  const nowIso = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('saved_places')
      .update({
        visited_at: nowIso,
        notifications_enabled: false,
      })
      .eq('id', savedPlaceId);
    if (error) {
      console.warn('[savedPlacesService] markVisited failed', error.message);
      rethrowMutationError('mark_visited', error);
    }
  } catch (err) {
    rethrowMutationError('mark_visited', err);
  }
  triggerGeofenceResync();
}

/**
 * Mark a saved place as archived. When `exhausted` is true (auto-archive
 * after the user declines the 3rd opportunity) we also stamp
 * `reminders_exhausted_at` so the analytics + future "opportunity expired"
 * UI can distinguish manual archive from reminder-exhaustion archive.
 */
export async function markArchived(
  savedPlaceId: string,
  opts: { exhausted?: boolean } = {},
): Promise<void> {
  if (isDemoMode()) return await markDemoArchived(savedPlaceId, opts);
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    archived_at: nowIso,
    notifications_enabled: false,
  };
  if (opts.exhausted) {
    patch.reminders_exhausted_at = nowIso;
  }
  try {
    const { error } = await supabase
      .from('saved_places')
      .update(patch)
      .eq('id', savedPlaceId);
    if (error) {
      console.warn('[savedPlacesService] markArchived failed', error.message);
      rethrowMutationError('mark_archived', error);
    }
  } catch (err) {
    rethrowMutationError('mark_archived', err);
  }
  triggerGeofenceResync();
}

/**
 * Restore an archived saved place. Clears `archived_at` and
 * `reminders_exhausted_at`; does NOT automatically re-enable notifications
 * (the user can flip the per-place toggle in the detail screen).
 */
export async function unarchive(savedPlaceId: string): Promise<void> {
  if (isDemoMode()) return await unarchiveDemo(savedPlaceId);
  try {
    const { error } = await supabase
      .from('saved_places')
      .update({
        archived_at: null,
        reminders_exhausted_at: null,
      })
      .eq('id', savedPlaceId);
    if (error) {
      console.warn('[savedPlacesService] unarchive failed', error.message);
      rethrowMutationError('unarchive', error);
    }
  } catch (err) {
    rethrowMutationError('unarchive', err);
  }
  triggerGeofenceResync();
}

