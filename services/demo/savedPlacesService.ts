/**
 * Demo saved-places service. AsyncStorage-backed CRUD that mirrors the
 * real `services/savedPlacesService.ts` API.
 *
 * - Initialized once from `DEMO_SEED_SAVED_PLACES` if storage is empty.
 * - Duplicates (same google_place_id) return `{status: 'duplicate', ...}`
 *   to mirror the real PG `23505` behavior.
 * - Resetting reseeds to the original demo dataset.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEMO_PLACE_CATALOG,
  DEMO_SEED_SAVED_PLACES,
  type DemoPlaceCatalogEntry,
} from '@/lib/demoData';
import { DEMO_USER } from '@/lib/demoMode';
import type {
  PlaceRow,
  SavedPlace,
  SavedPlaceWithPlace,
} from '@/types';
import type {
  SavedPlacePatch,
  SaveSavedPlaceInput,
  SaveSavedPlaceResult,
} from '@/services/savedPlacesService';

const STORAGE_KEY = 'nearr.demo.savedPlaces';

let cache: SavedPlaceWithPlace[] | null = null;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function load(): Promise<SavedPlaceWithPlace[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      cache = JSON.parse(raw) as SavedPlaceWithPlace[];
      return cache;
    }
  } catch (e) {
    console.warn('[demo:saved] load failed', e);
  }
  cache = seed();
  await persist();
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('[demo:saved] persist failed', e);
  }
}

function seed(): SavedPlaceWithPlace[] {
  const now = Date.now();
  const out: SavedPlaceWithPlace[] = [];
  for (const s of DEMO_SEED_SAVED_PLACES) {
    const cat = DEMO_PLACE_CATALOG.find((p) => p.googlePlaceId === s.googlePlaceId);
    if (!cat) continue;
    const created = new Date(now - s.ageHours * 60 * 60 * 1000).toISOString();
    out.push({
      id: s.savedId,
      user_id: DEMO_USER.id,
      place_id: `demo-place-${cat.googlePlaceId}`,
      radius_value: s.radius_value,
      radius_unit: s.radius_unit,
      notes: s.notes,
      source_type: s.source_type,
      source_url: s.source_url,
      notifications_enabled: s.notifications_enabled,
      last_notified_at: null,
      notification_count: 0,
      reminder_opportunity_count: 0,
      archived_at: null,
      visited_at: null,
      reminders_exhausted_at: null,
      created_at: created,
      updated_at: created,
      place: catalogToPlaceRow(cat, created),
    });
  }
  // Newest first.
  out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return out;
}

function catalogToPlaceRow(e: DemoPlaceCatalogEntry, createdIso: string): PlaceRow {
  return {
    id: `demo-place-${e.googlePlaceId}`,
    google_place_id: e.googlePlaceId,
    name: e.name,
    formatted_address: e.formattedAddress,
    latitude: e.latitude,
    longitude: e.longitude,
    category: e.category,
    google_maps_url: e.googleMapsUrl,
    created_at: createdIso,
  };
}

// ---------------------------------------------------------------------------
// Public API (mirrors services/savedPlacesService.ts)
// ---------------------------------------------------------------------------

export async function listDemoSavedPlaces(): Promise<SavedPlaceWithPlace[]> {
  const list = await load();
  // Always return a copy sorted newest-first.
  return [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

/**
 * Synchronous accessor for the seeded demo dataset. Bypasses AsyncStorage so
 * callers (e.g. Map Preview Mode) can render markers on the very first frame
 * without a loading state. The returned data is built from `DEMO_SEED_SAVED_PLACES`
 * and is independent of any user edits persisted to storage.
 */
export function getDemoSeededSavedPlacesSync(): SavedPlaceWithPlace[] {
  return seed();
}

export async function getDemoSavedPlace(id: string): Promise<SavedPlaceWithPlace | null> {
  const list = await load();
  return list.find((s) => s.id === id) ?? null;
}

export async function saveDemoSavedPlace(
  input: SaveSavedPlaceInput,
): Promise<SaveSavedPlaceResult> {
  const list = await load();
  const { candidate, radiusValue, radiusUnit } = input;

  // Duplicate check on (user_id, place_id) ≈ google_place_id in demo.
  const existing = list.find(
    (s) => s.place.google_place_id === candidate.googlePlaceId,
  );
  if (existing) {
    console.log('[demo:saved] duplicate', candidate.googlePlaceId);
    return {
      status: 'duplicate',
      place: existing.place,
      savedPlaceId: existing.id,
    };
  }

  const nowIso = new Date().toISOString();
  const placeRow: PlaceRow = {
    id: `demo-place-${candidate.googlePlaceId}`,
    google_place_id: candidate.googlePlaceId,
    name: candidate.name,
    formatted_address: candidate.formattedAddress,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    category: candidate.category,
    google_maps_url: candidate.googleMapsUrl,
    created_at: nowIso,
  };
  const saved: SavedPlace = {
    id: `demo-saved-${candidate.googlePlaceId}-${Date.now()}`,
    user_id: DEMO_USER.id,
    place_id: placeRow.id,
    radius_value: radiusValue,
    radius_unit: radiusUnit,
    notes: input.notes ?? null,
    source_type: input.sourceType ?? 'manual',
    source_url: input.sourceUrl ?? null,
    notifications_enabled: true,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const withPlace: SavedPlaceWithPlace = { ...saved, place: placeRow };

  cache = [withPlace, ...list];
  await persist();
  console.log('[demo:saved] saved', candidate.name);
  return { status: 'saved', saved: withPlace, savedPlaceId: withPlace.id };
}

export async function updateDemoSavedPlace(
  id: string,
  patch: SavedPlacePatch,
): Promise<void> {
  const list = await load();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) {
    console.warn('[demo:saved] update: not found', id);
    return;
  }
  const cur = list[idx];
  const next: SavedPlaceWithPlace = {
    ...cur,
    radius_value: patch.radius_value !== undefined ? patch.radius_value : cur.radius_value,
    radius_unit: patch.radius_unit !== undefined ? patch.radius_unit : cur.radius_unit,
    notifications_enabled:
      patch.notifications_enabled !== undefined
        ? patch.notifications_enabled
        : cur.notifications_enabled,
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
    updated_at: new Date().toISOString(),
  };
  cache = [...list.slice(0, idx), next, ...list.slice(idx + 1)];
  await persist();
  console.log('[demo:saved] updated', id, patch);
}

export async function deleteDemoSavedPlace(id: string): Promise<void> {
  const list = await load();
  cache = list.filter((s) => s.id !== id);
  await persist();
  console.log('[demo:saved] deleted', id);
}

/** Wipe AsyncStorage and reseed from the original demo dataset. */
export async function resetDemoSavedPlaces(): Promise<void> {
  cache = seed();
  await persist();
  console.log('[demo:saved] reset to seed');
}

// ---------------------------------------------------------------------------
// Opportunity / visited / archived helpers
// ---------------------------------------------------------------------------

async function patchById(
  id: string,
  patch: Partial<SavedPlaceWithPlace>,
): Promise<void> {
  const list = await load();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) {
    console.warn('[demo:saved] patch: not found', id);
    return;
  }
  const next: SavedPlaceWithPlace = {
    ...list[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  cache = [...list.slice(0, idx), next, ...list.slice(idx + 1)];
  await persist();
}

export async function markDemoVisited(id: string): Promise<void> {
  await patchById(id, {
    visited_at: new Date().toISOString(),
    notifications_enabled: false,
  });
  console.log('[demo:saved] visited', id);
}

export async function markDemoArchived(
  id: string,
  opts: { exhausted?: boolean } = {},
): Promise<void> {
  const nowIso = new Date().toISOString();
  await patchById(id, {
    archived_at: nowIso,
    notifications_enabled: false,
    reminders_exhausted_at: opts.exhausted ? nowIso : null,
  });
  console.log('[demo:saved] archived', id, opts);
}

export async function unarchiveDemo(id: string): Promise<void> {
  await patchById(id, {
    archived_at: null,
    reminders_exhausted_at: null,
  });
  console.log('[demo:saved] unarchived', id);
}
