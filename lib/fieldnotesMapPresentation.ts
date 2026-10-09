import type { SavedPlaceWithPlace } from '@/types';
import type { MapMarkerDetailLevel } from './mapMarkerPresentation';

export const FIELDNOTES_MAX_PHOTO_MARKERS = 3;

/** Only individual rendered places participate; cluster membership and camera transactions stay untouched. */
export function fieldnotesPhotoMarkerIds(places: readonly SavedPlaceWithPlace[], selectedId: string | null, detailLevel: MapMarkerDetailLevel): Set<string> {
  const ids = new Set<string>();
  if (selectedId && places.some(place => place.id === selectedId)) ids.add(selectedId);
  if (detailLevel !== 'local') return ids;
  // Dataset is already stable. Most recently saved wins, with identity tie-break.
  const recent = [...places].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id));
  for (const place of recent) { if (ids.size >= FIELDNOTES_MAX_PHOTO_MARKERS) break; ids.add(place.id); }
  return ids;
}
