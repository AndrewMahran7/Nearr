import type { PlaceCandidate } from '../services/placesService';
import type { ShareJobCandidate } from '../services/shareJobsService';

export function isPersistableShareJobCandidate(
  candidate: ShareJobCandidate | null | undefined,
): candidate is ShareJobCandidate {
  return !!candidate?.googlePlaceId &&
    !!candidate.name &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude);
}

/** Preserve the complete bounded photo inventory across Quick Check -> save. */
export function shareJobCandidateToPlaceCandidate(candidate: ShareJobCandidate): PlaceCandidate {
  if (!isPersistableShareJobCandidate(candidate)) {
    throw new Error('This result needs a place selection before it can be saved.');
  }
  return {
    googlePlaceId: candidate.googlePlaceId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress,
    latitude: candidate.latitude as number,
    longitude: candidate.longitude as number,
    category: null,
    googleMapsUrl: null,
    rawTypes: candidate.types,
    primaryType: candidate.primaryType,
    primaryTypeDisplayName: candidate.primaryTypeDisplayName,
    googleMapsTypeLabel: candidate.googleMapsTypeLabel,
    shortFormattedAddress: candidate.shortFormattedAddress,
    businessStatus: candidate.businessStatus,
    photoUrl: candidate.photoUrl ?? null,
    photoUrls: candidate.photoUrls,
  };
}
