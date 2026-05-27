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

async function patchExistingSavedPlaceForUser(
  client: any,
  savedPlaceId: string,
  source: LegacySource,
  sourceUrl: string,
  autoNote?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    source_type: source,
    source_url: sourceUrl,
  };
  if (autoNote !== undefined) {
    patch.notes = autoNote ?? null;
  }
  const { error } = await client
    .from('saved_places')
    .update(patch)
    .eq('id', savedPlaceId);
  if (error) {
    console.log(
      '[process-share-link] duplicate saved_place update failed',
      error.message,
    );
  }
}

export type SaveResult = {
  savedPlaceId: string;
  placeId: string;
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
    return {
      savedPlaceId: existingForUser.id,
      placeId: existingForUser.place.id,
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
    notes: autoNote ?? null,
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
        return { savedPlaceId: existingSaved.id, placeId: placeId! };
      }
    }
    throw new Error(`saved_places insert: ${savedErr.message}`);
  }
  return { savedPlaceId: saved.id, placeId: placeId! };
}
