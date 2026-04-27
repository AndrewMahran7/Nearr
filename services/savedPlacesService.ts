/**
 * Saved-places service for Nearr.
 *
 * Responsible for the two-step write that turns a Google Places search
 * result into a row the user owns:
 *
 *   1. Upsert the canonical place into `places` (dedup by `google_place_id`).
 *   2. Insert a `saved_places` row tying that place to the current user with
 *      their chosen radius / source / notes.
 *
 * Duplicate saves (`unique(user_id, place_id)`, Postgres error 23505) are
 * caught and surfaced as a non-throwing `{ status: 'duplicate' }` result so
 * the UI can show a friendly message instead of a stack trace.
 */

import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
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

  // --- 1. upsert canonical place -----------------------------------------
  const placePayload = {
    google_place_id: candidate.googlePlaceId,
    name: candidate.name,
    formatted_address: candidate.formattedAddress,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    category: candidate.category,
    google_maps_url: candidate.googleMapsUrl,
  };

  const { data: place, error: placeErr } = await supabase
    .from('places')
    .upsert(placePayload, { onConflict: 'google_place_id' })
    .select()
    .single();

  if (placeErr || !place) {
    console.warn('[savedPlacesService] place upsert failed', placeErr?.message);
    throw new Error(placeErr?.message ?? 'Could not save place.');
  }
  const placeRow = place as PlaceRow;

  // --- 2. insert saved_places row ----------------------------------------
  const savedPayload = {
    user_id: userId,
    place_id: placeRow.id,
    radius_value: radiusValue,
    radius_unit: radiusUnit,
    source_type: input.sourceType ?? 'manual',
    source_url: input.sourceUrl ?? null,
    notes: input.notes ?? null,
  };

  const { data: saved, error: savedErr } = await supabase
    .from('saved_places')
    .insert(savedPayload)
    .select('*, place:places(*)')
    .single();

  if (savedErr) {
    // Postgres unique_violation on (user_id, place_id)
    // PostgREST exposes it as code "23505".
    if ((savedErr as any).code === '23505') {
      console.log('[savedPlacesService] duplicate save', {
        userId,
        placeId: placeRow.id,
      });
      return { status: 'duplicate', place: placeRow };
    }
    console.warn('[savedPlacesService] saved_places insert failed', savedErr.message);
    throw new Error(savedErr.message);
  }

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
  const { data, error } = await supabase
    .from('saved_places')
    .select('*, place:places(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[savedPlacesService] list failed', error.message);
    throw new Error(error.message);
  }
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
}

export async function deleteSavedPlace(id: string): Promise<void> {
  if (isDemoMode()) return await deleteDemoSavedPlace(id);
  console.log('[savedPlacesService] delete', id);
  const { error } = await supabase.from('saved_places').delete().eq('id', id);
  if (error) {
    console.warn('[savedPlacesService] delete failed', error.message);
    throw new Error(error.message);
  }
}
