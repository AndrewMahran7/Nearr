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
 *      gracefully update the existing row's source / notes / radius
 *      instead of crashing.
 */

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import { triggerGeofenceResync } from '@/lib/geofencing';
import { distanceMeters } from '@/lib/geo';
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
import { isAddressLikePlace, type PlaceCandidate } from '@/services/placesService';
import type {
  PlaceRow,
  RadiusUnit,
  SavedPlace,
  SavedPlaceWithPlace,
  SourceType,
} from '@/types';

export type SaveSavedPlaceInput = {
  candidate: PlaceCandidate;
  /** null/null means "use the profile default radius". */
  radiusValue: number | null;
  radiusUnit: RadiusUnit | null;
  sourceType?: SourceType;
  sourceUrl?: string | null;
  notes?: string | null;
};

export type SaveSavedPlaceResult =
  | { status: 'saved'; saved: SavedPlaceWithPlace; savedPlaceId: string }
  | { status: 'duplicate'; place: PlaceRow; savedPlaceId: string | null };

type ExistingSavedPlaceLookup = Pick<SavedPlace, 'id' | 'source_url'> & {
  place: PlaceRow;
};

type ExistingSavedPlaceLookupRow = Pick<SavedPlace, 'id' | 'source_url'> & {
  place: PlaceRow | PlaceRow[] | null;
};

const DEDUPE_DISTANCE_M = 40;

function normalizeDedupeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeAddressName(value: string | null | undefined): boolean {
  const normalized = normalizeDedupeText(value);
  if (!normalized) return false;
  return /^\d{1,6}\s+/.test(normalized) &&
    /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place)\b/.test(normalized);
}

function sameNormalizedName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeDedupeText(a);
  const right = normalizeDedupeText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function isNearbyPlace(candidate: PlaceCandidate, place: PlaceRow): boolean {
  if (
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude) ||
    !Number.isFinite(place.latitude) ||
    !Number.isFinite(place.longitude)
  ) {
    return false;
  }
  return (
    distanceMeters(
      { latitude: candidate.latitude, longitude: candidate.longitude },
      { latitude: place.latitude, longitude: place.longitude },
    ) <= DEDUPE_DISTANCE_M
  );
}

function matchesExistingRealPlace(
  candidate: PlaceCandidate,
  existing: ExistingSavedPlaceLookup,
): boolean {
  if (candidate.googlePlaceId && existing.place.google_place_id === candidate.googlePlaceId) {
    return true;
  }

  if (!isNearbyPlace(candidate, existing.place)) {
    return false;
  }

  const sameAddress =
    !!candidate.formattedAddress &&
    !!existing.place.formatted_address &&
    normalizeDedupeText(candidate.formattedAddress) ===
      normalizeDedupeText(existing.place.formatted_address);
  const sameName = sameNormalizedName(candidate.name, existing.place.name);
  const candidateIsAddressLike =
    isAddressLikePlace(candidate) || looksLikeAddressName(candidate.name);
  const existingIsAddressLike =
    looksLikeAddressName(existing.place.name) ||
    (!!existing.place.formatted_address &&
      normalizeDedupeText(existing.place.name) ===
        normalizeDedupeText(existing.place.formatted_address));

  if (sameName && sameAddress) return true;
  if (sameName) return true;
  if ((candidateIsAddressLike || existingIsAddressLike) && sameAddress) return true;
  return false;
}

async function patchExistingSavedPlace(
  savedPlaceId: string,
  input: SaveSavedPlaceInput,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.sourceType !== undefined) patch.source_type = input.sourceType;
  if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.radiusValue !== null || input.radiusUnit !== null) {
    patch.radius_value = input.radiusValue;
    patch.radius_unit = input.radiusUnit;
  }
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from('saved_places')
    .update(patch)
    .eq('id', savedPlaceId);
  if (error) {
    console.warn(
      '[savedPlacesService] existing saved_place update failed (non-fatal)',
      error.message,
    );
  }
}

async function findExistingSavedPlaceForUser(
  userId: string,
  candidate: PlaceCandidate,
  sourceUrl: string | null | undefined,
): Promise<ExistingSavedPlaceLookup | null> {
  const { data, error } = await supabase
    .from('saved_places')
    .select('id, source_url, place:places(*)')
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
        source_url: row.source_url,
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

  console.log('[savedPlacesService] saving', {
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
    await patchExistingSavedPlace(existingForUser.id, input);
    return {
      status: 'duplicate',
      place: existingForUser.place,
      savedPlaceId: existingForUser.id,
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
      addressLikeName: isAddressLikePlace(candidate),
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
    notes: input.notes ?? null,
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
      console.debug('[savedPlacesService] saved_places duplicate, updating existing', {
        userId,
        placeId: placeRow.id,
      });

      const { data: existingSaved, error: existingSavedErr } = await supabase
        .from('saved_places')
        .select('id')
        .eq('user_id', userId)
        .eq('place_id', placeRow.id)
        .maybeSingle();

      if (existingSavedErr) {
        console.warn(
          '[savedPlacesService] duplicate lookup failed (non-fatal)',
          existingSavedErr.message,
        );
      }

      if (existingSaved?.id) {
        await patchExistingSavedPlace(existingSaved.id, input);
      }

      return {
        status: 'duplicate',
        place: placeRow,
        savedPlaceId: existingSaved?.id ?? null,
      };
    }
    console.warn('[savedPlacesService] saved_places insert failed', savedErr.message);
    throw new Error(savedErr.message);
  }

  // Resync OS-level geofences after a successful save. Fire-and-forget;
  // never block the UI on geofence registration.
  triggerGeofenceResync();

  return {
    status: 'saved',
    saved: saved as SavedPlace & { place: PlaceRow },
    savedPlaceId: (saved as SavedPlace).id,
  };
}

// ---------------------------------------------------------------------------
// Read / update / delete
// ---------------------------------------------------------------------------

/** List the current user's saved places, newest first, with the joined place. */
export async function listSavedPlaces(): Promise<SavedPlaceWithPlace[]> {
  if (isDemoMode()) return await listDemoSavedPlaces();
  if (isMapPreviewMode()) return await listDemoSavedPlaces();

  // Log the session state before querying so we can confirm RLS will pass.
  // Never log the actual token — only booleans.
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUserId = sessionData.session?.user?.id;
  console.log(
    '[savedPlacesService] listSavedPlaces start, sessionPresent=', !!sessionData.session,
    'userIdPresent=', !!sessionUserId,
  );

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
  console.log('[savedPlacesService] listSavedPlaces done, count=', (data ?? []).length);
  return (data ?? []) as SavedPlaceWithPlace[];
}

/** Fetch a single saved place by its `saved_places.id`. */
export async function getSavedPlace(id: string): Promise<SavedPlaceWithPlace | null> {
  if (isDemoMode()) return await getDemoSavedPlace(id);
  if (isMapPreviewMode()) return await getDemoSavedPlace(id);
  const { data, error } = await supabase
    .from('saved_places')
    .select('*, place:places(*)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn('[savedPlacesService] get failed', error.message);
    throw new Error(error.message);
  }
  return (data as SavedPlaceWithPlace | null) ?? null;
}

export type SavedPlacePatch = {
  radius_value?: number | null;
  radius_unit?: RadiusUnit | null;
  notifications_enabled?: boolean;
  notes?: string | null;
};

export async function updateSavedPlace(id: string, patch: SavedPlacePatch): Promise<void> {
  if (isDemoMode()) return await updateDemoSavedPlace(id, patch);
  console.log('[savedPlacesService] update', id, patch);
  const { error } = await supabase.from('saved_places').update(patch).eq('id', id);
  if (error) {
    console.warn('[savedPlacesService] update failed', error.message);
    throw new Error(error.message);
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
  const { error } = await supabase.from('saved_places').delete().eq('id', id);
  if (error) {
    console.warn('[savedPlacesService] delete failed', error.message);
    throw new Error(error.message);
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
  const { error } = await supabase
    .from('saved_places')
    .update({
      visited_at: nowIso,
      notifications_enabled: false,
    })
    .eq('id', savedPlaceId);
  if (error) {
    console.warn('[savedPlacesService] markVisited failed', error.message);
    throw new Error(error.message);
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
  const { error } = await supabase
    .from('saved_places')
    .update(patch)
    .eq('id', savedPlaceId);
  if (error) {
    console.warn('[savedPlacesService] markArchived failed', error.message);
    throw new Error(error.message);
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
  const { error } = await supabase
    .from('saved_places')
    .update({
      archived_at: null,
      reminders_exhausted_at: null,
    })
    .eq('id', savedPlaceId);
  if (error) {
    console.warn('[savedPlacesService] unarchive failed', error.message);
    throw new Error(error.message);
  }
  triggerGeofenceResync();
}

