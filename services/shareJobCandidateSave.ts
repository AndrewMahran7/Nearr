/** Canonical single-candidate save path shared by queue and quick check. */
import { upsertSavedPlaceIntoCache } from '@/hooks/useSavedPlaces';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { persistThenResolveQueueJob } from '@/lib/queueSaveResolution';
import type { PlaceCandidate } from '@/services/placesService';
import {
  saveSavedPlace,
  type SaveSavedPlaceInput,
  type SaveSavedPlaceResult,
} from '@/services/savedPlacesService';
import {
  markShareJobResolved,
  type ShareJob,
  type ShareJobCandidate,
} from '@/services/shareJobsService';
import type { SavedPlaceWithPlace, SourceType } from '@/types';

export type ShareJobCandidateSaveDependencies = {
  save: (input: SaveSavedPlaceInput) => Promise<SaveSavedPlaceResult>;
  cache: (saved: SavedPlaceWithPlace) => void;
  resolve: (jobId: string, savedPlaceId: string) => Promise<void>;
};

const productionDependencies: ShareJobCandidateSaveDependencies = {
  save: saveSavedPlace,
  cache: upsertSavedPlaceIntoCache,
  resolve: markShareJobResolved,
};

export function shareJobSourceType(platform: string | null | undefined): SourceType {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'tiktok';
    default:
      return 'link';
  }
}

export function isPersistableShareJobCandidate(
  candidate: ShareJobCandidate | null | undefined,
): candidate is ShareJobCandidate {
  return !!candidate?.googlePlaceId &&
    !!candidate.name &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude);
}

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
  };
}

export async function persistShareJobCandidate(
  args: {
    candidate: PlaceCandidate;
    jobId: string | null;
    platform: string | null | undefined;
    sourceUrl: string | null;
    aiNote?: string | null;
  },
  dependencies: Pick<ShareJobCandidateSaveDependencies, 'save' | 'cache'> = productionDependencies,
): Promise<{ savedPlaceId: string | null; duplicate: boolean }> {
  recordBreadcrumb('save_started', { jobId: args.jobId });
  const result = await dependencies.save({
    candidate: args.candidate,
    radiusValue: null,
    radiusUnit: null,
    sourceType: shareJobSourceType(args.platform),
    sourceUrl: args.sourceUrl,
    aiNote: args.aiNote ?? undefined,
  });
  if (result.status === 'saved') {
    dependencies.cache(result.saved);
    recordBreadcrumb('save_response', {
      jobId: args.jobId,
      savedPlaceId: result.savedPlaceId,
      result: 'saved',
    });
    return { savedPlaceId: result.savedPlaceId, duplicate: false };
  }
  recordBreadcrumb('already_saved_response', {
    jobId: args.jobId,
    savedPlaceId: result.savedPlaceId ?? null,
    result: 'duplicate',
  });
  return { savedPlaceId: result.savedPlaceId ?? null, duplicate: true };
}

/** Save once through the canonical mutation, then resolve the owned job. */
export async function saveResolvedQueueCandidate(
  job: ShareJob,
  candidate: ShareJobCandidate,
  dependencies: ShareJobCandidateSaveDependencies = productionDependencies,
): Promise<{ savedPlaceId: string; duplicate: boolean }> {
  return persistThenResolveQueueJob({
    jobId: job.id,
    persist: () => persistShareJobCandidate(
      {
        candidate: shareJobCandidateToPlaceCandidate(candidate),
        jobId: job.id,
        platform: job.source_platform,
        sourceUrl: job.canonical_url ?? job.source_url,
        aiNote: candidate.aiNote ?? null,
      },
      dependencies,
    ),
    resolve: dependencies.resolve,
  });
}
