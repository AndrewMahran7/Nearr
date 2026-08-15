// supabase/functions/process-share-link/save.ts
//
// Persist a resolved candidate as a `places` row + `saved_places`
// row for a user. Behavior is preserved BIT-FOR-BIT from the
// legacy index.ts (`saveForUser` + helpers) — same dedupe
// distance (40m), same SELECT-then-INSERT race recovery, same
// patch-on-duplicate flow.

// @ts-nocheck — Deno runtime.

import type { ResolvedCandidate, LegacySource } from './types.ts';
import {
  haversineMeters,
  normalizeName,
  isAddressLikeTypes,
  pickCategory,
} from './places/placeNormalization.ts';
import { resolvePlaceCategory } from '../../../lib/placeCategory.ts';

export const SAVE_DEDUPE_DISTANCE_M = 40;

const ADDRESS_NAME_RE = /^\s*\d{1,6}\s+\S+/i;
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place)\b\.?/i;

function looksLikeAddressName(value: string | null | undefined): boolean {
  if (!value) return false;
  return ADDRESS_NAME_RE.test(value) && STREET_SUFFIX_RE.test(value);
}

type ExistingSavedPlaceRow = {
  id: string;
  source_url: string | null;
  place_id: string;
  place: {
    id: string;
    google_place_id: string | null;
    name: string;
    formatted_address: string | null;
    latitude: number;
    longitude: number;
  };
};

function sameNormalizedName(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeName(left ?? '');
  const b = normalizeName(right ?? '');
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function isNearbySavedPlaceMatch(
  candidate: ResolvedCandidate,
  existing: ExistingSavedPlaceRow,
): boolean {
  if (
    candidate.googlePlaceId &&
    existing.place.google_place_id === candidate.googlePlaceId
  ) {
    return true;
  }
  if (
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude) ||
    !Number.isFinite(existing.place.latitude) ||
    !Number.isFinite(existing.place.longitude)
  ) {
    return false;
  }
  if (
    haversineMeters(
      candidate.latitude!,
      candidate.longitude!,
      existing.place.latitude,
      existing.place.longitude,
    ) > SAVE_DEDUPE_DISTANCE_M
  ) {
    return false;
  }
  const sameName = sameNormalizedName(candidate.name, existing.place.name);
  const sameAddress =
    !!candidate.formattedAddress &&
    !!existing.place.formatted_address &&
    normalizeName(candidate.formattedAddress) ===
      normalizeName(existing.place.formatted_address);
  const candidateIsAddressLike =
    isAddressLikeTypes(candidate.types) || looksLikeAddressName(candidate.name);
  const existingIsAddressLike =
    looksLikeAddressName(existing.place.name) ||
    (!!existing.place.formatted_address &&
      normalizeName(existing.place.name) ===
        normalizeName(existing.place.formatted_address));
  if (sameName && sameAddress) return true;
  if (sameName) return true;
  if ((candidateIsAddressLike || existingIsAddressLike) && sameAddress) return true;
  return false;
}

async function findExistingSavedPlaceForUser(
  client: any,
  userId: string,
  candidate: ResolvedCandidate,
  sourceUrl: string,
): Promise<ExistingSavedPlaceRow | null> {
  const { data, error } = await client
    .from('saved_places')
    .select(
      'id, source_url, place_id, place:places(id, google_place_id, name, formatted_address, latitude, longitude)',
    )
    .eq('user_id', userId);
  if (error) {
    console.log('[process-share-link] save fallback lookup failed', error.message);
    return null;
  }
  const rows = (data ?? []) as ExistingSavedPlaceRow[];
  if (rows.length === 0) return null;
  const exactSourceMatch = rows.find(
    (row) => row.source_url && row.source_url === sourceUrl,
  );
  if (exactSourceMatch) return exactSourceMatch;
  return rows.find((row) => isNearbySavedPlaceMatch(candidate, row)) ?? null;
}

/**
 * Attach a resolved share's context to a saved place the user ALREADY has.
 *
 * Fill-if-empty, never destructive: `saved_places` is a single-source model,
 * so an existing post stays attached and a later, different post is preserved
 * rather than overwritten. `notes` is user-authored and is never written here —
 * generated cues belong in `ai_note`. Both writes are guarded on the column
 * still being empty, which makes concurrent jobs and retries converge.
 */
async function patchExistingSavedPlaceForUser(
  client: any,
  savedPlaceId: string,
  source: LegacySource,
  sourceUrl: string,
  autoNote?: string | null,
): Promise<void> {
  const { error } = await client
    .from('saved_places')
    .update({ source_type: source, source_url: sourceUrl })
    .eq('id', savedPlaceId)
    .is('source_url', null);
  if (error) {
    console.log(
      '[process-share-link] duplicate saved_place source attach failed',
      error.message,
    );
  }
  const note = typeof autoNote === 'string' ? autoNote.trim() : '';
  if (note) {
    const { error: noteError } = await client
      .from('saved_places')
      .update({ ai_note: note })
      .eq('id', savedPlaceId)
      .is('ai_note', null);
    if (noteError) {
      console.log(
        '[process-share-link] duplicate saved_place ai_note attach failed',
        noteError.message,
      );
    }
  }
}

export type SaveResult = {
  savedPlaceId: string;
  placeId: string;
  /** True when the place was ALREADY in the user's saved places (reused an
   *  existing row via source_url match, place-dedupe, or a unique-violation
   *  recovery) rather than inserting a new saved_places row. */
  reused: boolean;
};

export async function saveForUser(args: {
  client: any;
  userId: string;
  candidate: ResolvedCandidate;
  sourceUrl: string;
  source: LegacySource;
  autoNote?: string | null;
}): Promise<SaveResult> {
  const { client, userId, candidate, sourceUrl, source, autoNote } = args;
  const categoryResolution = resolvePlaceCategory({
    placeName: candidate.name,
    googlePrimaryType: candidate.primaryType,
    googleTypes: candidate.types,
  });

  const existingForUser = await findExistingSavedPlaceForUser(
    client, userId, candidate, sourceUrl,
  );
  if (existingForUser?.source_url === sourceUrl) {
    console.log(
      `[process-share-link] SAVE_DUPLICATE_SOURCE_URL_REUSED savedPlaceId=${existingForUser.id} placeId=${existingForUser.place.id}`,
    );
    await patchExistingSavedPlaceForUser(
      client, existingForUser.id, source, sourceUrl, autoNote,
    );
    await client.from('saved_places').update({
      category: categoryResolution.category,
      category_source: categoryResolution.source,
      category_confidence: categoryResolution.confidence,
      category_model_version: categoryResolution.modelVersion,
      categorized_at: new Date().toISOString(),
    }).eq('id', existingForUser.id).eq('category_user_overridden', false);
    return {
      savedPlaceId: existingForUser.id,
      placeId: existingForUser.place.id,
      reused: true,
    };
  }

  // 1. Resolve canonical places row (SELECT first, INSERT only if missing).
  let placeId: string | null = null;
  if (candidate.googlePlaceId) {
    const { data: existing, error: lookupErr } = await client
      .from('places')
      .select('id')
      .eq('google_place_id', candidate.googlePlaceId)
      .maybeSingle();
    if (lookupErr) throw new Error(`place lookup: ${lookupErr.message}`);
    if (existing) placeId = existing.id;
  }
  if (!placeId && existingForUser?.place?.id) {
    console.log(
      `[process-share-link] SAVE_FALLBACK_DEDUPE_REUSED placeId=${existingForUser.place.id} savedPlaceId=${existingForUser.id}`,
    );
    placeId = existingForUser.place.id;
  }
  if (!placeId) {
    const payload = {
      google_place_id: candidate.googlePlaceId,
      name: candidate.name,
      formatted_address: candidate.formattedAddress ?? null,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      category: pickCategory(candidate.types),
      google_maps_url: null,
      short_formatted_address: candidate.shortFormattedAddress ?? null,
      google_primary_type: candidate.primaryType ?? null,
      google_types: candidate.types ?? null,
      google_type_label: candidate.googleMapsTypeLabel ?? candidate.primaryTypeDisplayName ?? null,
      business_status: candidate.businessStatus ?? null,
    };
    const { data: inserted, error: insertErr } = await client
      .from('places')
      .insert(payload)
      .select('id')
      .single();
    if (insertErr) {
      if ((insertErr as any).code === '23505' && candidate.googlePlaceId) {
        const { data: raced } = await client
          .from('places')
          .select('id')
          .eq('google_place_id', candidate.googlePlaceId)
          .maybeSingle();
        if (raced) placeId = raced.id;
      }
      if (!placeId) throw new Error(`place insert: ${insertErr.message}`);
    } else {
      placeId = inserted.id;
    }
  }

  // 2. Upsert saved_places.
  const savedPayload = {
    user_id: userId,
    place_id: placeId,
    radius_value: null,
    radius_unit: null,
    source_type: source,
    source_url: sourceUrl,
    // Generated context lives in `ai_note`; `notes` stays user-authored.
    notes: null,
    ai_note: autoNote ?? null,
    category: categoryResolution.category,
    category_source: categoryResolution.source,
    category_confidence: categoryResolution.confidence,
    category_model_version: categoryResolution.modelVersion,
    category_user_overridden: false,
    categorized_at: new Date().toISOString(),
  };
  const { data: saved, error: savedErr } = await client
    .from('saved_places')
    .insert(savedPayload)
    .select('id')
    .single();
  if (savedErr) {
    if ((savedErr as any).code === '23505') {
      const { data: existingSaved } = await client
        .from('saved_places')
        .select('id')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .maybeSingle();
      if (existingSaved) {
        await patchExistingSavedPlaceForUser(
          client, existingSaved.id, source, sourceUrl, autoNote,
        );
        await client.from('saved_places').update({
          category: categoryResolution.category,
          category_source: categoryResolution.source,
          category_confidence: categoryResolution.confidence,
          category_model_version: categoryResolution.modelVersion,
          categorized_at: new Date().toISOString(),
        }).eq('id', existingSaved.id).eq('category_user_overridden', false);
        return { savedPlaceId: existingSaved.id, placeId: placeId!, reused: true };
      }
    }
    throw new Error(`saved_places insert: ${savedErr.message}`);
  }
  return { savedPlaceId: saved.id, placeId: placeId! };
}
