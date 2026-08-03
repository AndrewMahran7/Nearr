import type { ShareJobCandidatePayload, ShareJobResultCandidate } from './shareJobResult';
import type { ShareJob } from '../services/shareJobsService';

export const PHASE2_FIVE_PIZZA_PREVIEW_ID = 'phase2-five-pizza-preview';

function candidate(
  googlePlaceId: string,
  name: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
): ShareJobResultCandidate {
  return {
    googlePlaceId,
    name,
    formattedAddress,
    latitude,
    longitude,
    types: ['restaurant'],
    matchScore: 0.8,
  };
}

export function buildFivePizzaPreviewJob(alreadySaved?: ShareJobResultCandidate | null): ShareJob {
  const parlor = candidate('preview-parlor', 'Parlor, Woodfire Kitchen & Cocktails', '216 N El Camino Real, San Clemente, CA', 33.428, -117.613);
  const bcLaguna = candidate('preview-bc-laguna', 'B+C Pizza', '27020 Alicia Pkwy, Laguna Niguel, CA', 33.571, -117.708);
  const bcCostaMesa = candidate('preview-bc-costa-mesa', 'B+C Pizza', '123 Demo St, Costa Mesa, CA', 33.641, -117.918);
  const lunitas = alreadySaved ?? candidate('preview-lunitas', 'Lunitas Pizza', '31761 Camino Capistrano, San Juan Capistrano, CA', 33.501, -117.663);
  const brewery = candidate('preview-brewery-x', 'Brewery X', '3191 E La Palma Ave, Anaheim, CA', 33.86, -117.852);
  const candidates = [parlor, bcLaguna, bcCostaMesa, lunitas, brewery];
  const payload: ShareJobCandidatePayload = {
    version: 2,
    candidates,
    mentionSlots: [
      { mentionId: 'm1', displayName: 'Parlor Woodfire', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'verified_single', candidates: [parlor] },
      { mentionId: 'm2', displayName: 'B+C Pizza', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'ambiguous_candidates', candidates: [bcLaguna, bcCostaMesa] },
      { mentionId: 'm3', displayName: 'Lunitas Pizza', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'verified_single', candidates: [lunitas] },
      { mentionId: 'm4', displayName: 'Pietrini Pizza Napoletana', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'no_match', candidates: [] },
      { mentionId: 'm5', displayName: 'X Eats at Brewery X', primaryVenueName: 'X Eats', hostVenueName: 'Brewery X', relationshipType: 'located_at', outcome: 'ambiguous_candidates', candidates: [brewery] },
    ],
  };

  return {
    id: PHASE2_FIVE_PIZZA_PREVIEW_ID,
    user_id: 'development-preview',
    source_url: 'https://www.instagram.com/reel/development-preview/',
    canonical_url: 'https://www.instagram.com/reel/development-preview/',
    source_platform: 'instagram',
    status: 'needs_help',
    progress_stage: 'completed',
    decision: 'multi_candidate_confirmation',
    saved_place_id: null,
    candidate_payload: payload,
    extraction_payload: { preview: true },
    suggested_query: 'Pietrini Pizza Napoletana',
    needs_help_reason: 'multiple_candidates',
    failure_reason: null,
    notification_status: null,
    notification_attempts: 0,
    notification_last_attempt_at: null,
    notification_ticket_ids: null,
    notification_error_code: null,
    notification_submitted_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    completed_at: null,
  };
}