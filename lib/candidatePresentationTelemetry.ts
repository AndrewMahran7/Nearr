import { trackEvent } from '@/lib/analytics';
import type {
  CandidatePresentationContext,
  CandidateHydrationReason,
} from '@/lib/candidatePresentation';

export type CandidatePresentationEvent =
  | 'candidate_presented'
  | 'candidate_became_active'
  | 'candidate_google_details_requested'
  | 'candidate_google_details_avoided'
  | 'candidate_google_photo_requested'
  | 'candidate_photo_existing_data_used'
  | 'candidate_photo_source_media_used'
  | 'candidate_photo_google_used'
  | 'candidate_google_request_deduped';

export function trackCandidatePresentation(
  event: CandidatePresentationEvent,
  input: CandidatePresentationContext & {
    googlePlaceId?: string | null;
    active?: boolean;
    reason?: CandidateHydrationReason | 'cache_hit' | 'image_load';
    photoIndex?: number | null;
    imageSource?: 'existing_data' | 'source_media' | 'google' | 'neutral';
  },
): void {
  const properties = {
    trigger: input.trigger,
    job_id: input.jobId ?? null,
    candidate_index: input.candidateIndex ?? null,
    candidate_count: input.candidateCount ?? null,
    google_place_id: input.googlePlaceId ?? null,
    operation: event.includes('photo') ? 'photo' : event.includes('details') ? 'details' : 'presentation',
    field_group: event.includes('details') ? 'photos_only' : null,
    active: input.active ?? null,
    reason: input.reason ?? null,
    photo_index: input.photoIndex ?? null,
    image_source: input.imageSource ?? null,
  };
  if (__DEV__) console.log('[candidate-presentation]', event, properties);
  void trackEvent(event, properties);
}
