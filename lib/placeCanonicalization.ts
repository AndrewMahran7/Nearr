import { distanceMeters } from './geo';

export const CANONICAL_FALLBACK_DISTANCE_M = 40;

export type CanonicalPlaceCandidate = {
  googlePlaceId?: string | null;
  name?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type CanonicalExistingPlace = {
  google_place_id?: string | null;
  name?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function normalizeCanonicalPlaceText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactNormalizedText(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeCanonicalPlaceText(left);
  const b = normalizeCanonicalPlaceText(right);
  return !!a && a === b;
}

function finiteCoordinates(value: CanonicalPlaceCandidate | CanonicalExistingPlace): value is typeof value & {
  latitude: number;
  longitude: number;
} {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

/**
 * Conservative semantic identity for a user's saved destinations.
 *
 * Provider identity is authoritative. The fallback exists for provider-less
 * address results, but requires exact normalized name AND exact normalized
 * address plus close coordinates. Proximity, category, source relation, or a
 * substring-similar name are never sufficient evidence on their own.
 */
export function isSameCanonicalPlace(
  candidate: CanonicalPlaceCandidate,
  existing: CanonicalExistingPlace,
): boolean {
  const candidateGoogleId = candidate.googlePlaceId?.trim() || null;
  const existingGoogleId = existing.google_place_id?.trim() || null;
  if (candidateGoogleId || existingGoogleId) {
    return !!candidateGoogleId && candidateGoogleId === existingGoogleId;
  }

  if (!exactNormalizedText(candidate.name, existing.name)) return false;
  if (!exactNormalizedText(candidate.formattedAddress, existing.formatted_address)) return false;
  if (!finiteCoordinates(candidate) || !finiteCoordinates(existing)) return false;

  return distanceMeters(
    { latitude: candidate.latitude, longitude: candidate.longitude },
    { latitude: existing.latitude, longitude: existing.longitude },
  ) <= CANONICAL_FALLBACK_DISTANCE_M;
}
