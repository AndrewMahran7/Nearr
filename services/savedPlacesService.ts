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
import {
  deleteDemoSavedPlace,
  getDemoSavedPlace,
  listDemoSavedPlaces,
  saveDemoSavedPlace,
  updateDemoSavedPlace,
} from '@/services/demo';
import type { PlaceCandidate } from '@/services/placesService';
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
  | { status: 'saved'; saved: SavedPlaceWithPlace }
  | { status: 'duplicate'; place: PlaceRow };

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

      const patch: Record<string, unknown> = {};
      // Only overwrite source fields when the caller actually supplied
      // them — preserves an existing TikTok source if the user later
      // re-saves the same place via manual search.
      if (input.sourceType !== undefined) patch.source_type = input.sourceType;
      if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (radiusValue !== null || radiusUnit !== null) {
        patch.radius_value = radiusValue;
        patch.radius_unit = radiusUnit;
      }

      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await supabase
          .from('saved_places')
          .update(patch)
          .eq('user_id', userId)
          .eq('place_id', placeRow.id);
        if (updErr) {
          console.warn(
            '[savedPlacesService] duplicate update failed (non-fatal)',
            updErr.message,
          );
        }
      }
      return { status: 'duplicate', place: placeRow };
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
