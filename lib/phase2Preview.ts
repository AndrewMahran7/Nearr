import type {
  ShareJobCandidatePayload,
  ShareJobMentionSlot,
  ShareJobResultCandidate,
} from './shareJobResult';
import type { ShareJob } from '../services/shareJobsService';

export const PHASE2_FIVE_PIZZA_PREVIEW_ID = 'phase2-preview-mixed-5';

function candidate(
  googlePlaceId: string,
  name: string,
  formattedAddress: string,
  latitude: number | null,
  longitude: number | null,
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

export const PHASE2_PREVIEW_FIXTURES = [
  { id: 'phase2-preview-0', label: '0 places' },
  { id: 'phase2-preview-1', label: '1 place' },
  { id: 'phase2-preview-2', label: '2 places' },
  { id: PHASE2_FIVE_PIZZA_PREVIEW_ID, label: '5 mixed' },
  { id: 'phase2-preview-8', label: '8 places' },
  { id: 'phase2-preview-missing', label: 'Missing coordinates' },
  { id: 'phase2-preview-overlap', label: 'Overlapping coordinates' },
  { id: 'phase2-preview-distant', label: 'Distant places' },
  { id: 'phase2-preview-partial', label: 'Partial-save recovery' },
] as const;

function verifiedSlots(count: number, coordinates?: Array<[number | null, number | null]>): ShareJobMentionSlot[] {
  return Array.from({ length: count }, (_, index) => {
    const [latitude, longitude] = coordinates?.[index] ?? [33.42 + index * 0.035, -117.61 - index * 0.025];
    const place = candidate(
      `preview-place-${index + 1}`,
      `Preview Place ${index + 1}`,
      `${100 + index} Preview Avenue`,
      latitude,
      longitude,
    );
    return {
      mentionId: `m${index + 1}`,
      displayName: place.name,
      primaryVenueName: null,
      hostVenueName: null,
      relationshipType: null,
      outcome: 'verified_single',
      candidates: [place],
    };
  });
}

function mixedSlots(alreadySaved?: ShareJobResultCandidate | null): ShareJobMentionSlot[] {
  const parlor = candidate('preview-parlor', 'Parlor, Woodfire Kitchen & Cocktails', '216 N El Camino Real, San Clemente, CA', 33.428, -117.613);
  const bcLaguna = candidate('preview-bc-laguna', 'B+C Pizza', '27020 Alicia Pkwy, Laguna Niguel, CA', 33.571, -117.708);
  const bcCostaMesa = candidate('preview-bc-costa-mesa', 'B+C Pizza', '123 Demo St, Costa Mesa, CA', 33.641, -117.918);
  const lunitas = alreadySaved ?? candidate('preview-lunitas', 'Lunitas Pizza', '31761 Camino Capistrano, San Juan Capistrano, CA', 33.501, -117.663);
  const brewery = candidate('preview-brewery-x', 'Brewery X', '3191 E La Palma Ave, Anaheim, CA', 33.86, -117.852);
  return [
    { mentionId: 'm1', displayName: 'Parlor Woodfire', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'verified_single', candidates: [parlor] },
    { mentionId: 'm2', displayName: 'B+C Pizza', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'ambiguous_candidates', candidates: [bcLaguna, bcCostaMesa] },
    { mentionId: 'm3', displayName: 'Lunitas Pizza', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'verified_single', candidates: [lunitas] },
    { mentionId: 'm4', displayName: 'Pietrini Pizza Napoletana', primaryVenueName: null, hostVenueName: null, relationshipType: null, outcome: 'no_match', candidates: [] },
    { mentionId: 'm5', displayName: 'X Eats at Brewery X', primaryVenueName: 'X Eats', hostVenueName: 'Brewery X', relationshipType: 'located_at', outcome: 'ambiguous_candidates', candidates: [brewery] },
  ];
}

export function isPhase2PreviewId(id: unknown): id is string {
  return typeof id === 'string' && PHASE2_PREVIEW_FIXTURES.some((fixture) => fixture.id === id);
}

export function buildPhase2PreviewJob(
  id: string,
  alreadySaved?: ShareJobResultCandidate | null,
): ShareJob {
  let mentionSlots: ShareJobMentionSlot[];
  switch (id) {
    case 'phase2-preview-0':
      mentionSlots = [];
      break;
    case 'phase2-preview-1':
      mentionSlots = verifiedSlots(1);
      break;
    case 'phase2-preview-2':
      mentionSlots = verifiedSlots(2);
      break;
    case 'phase2-preview-8':
      mentionSlots = verifiedSlots(8);
      break;
    case 'phase2-preview-missing':
      mentionSlots = verifiedSlots(3, [[33.42, -117.61], [null, null], [33.5, -117.7]]);
      break;
    case 'phase2-preview-overlap':
      mentionSlots = verifiedSlots(3, [[33.42, -117.61], [33.42, -117.61], [33.42, -117.61]]);
      break;
    case 'phase2-preview-distant':
      mentionSlots = verifiedSlots(3, [[34.05, -118.24], [40.71, -74.01], [51.51, -0.13]]);
      break;
    case 'phase2-preview-partial':
      mentionSlots = [...verifiedSlots(3), {
        mentionId: 'm4', displayName: 'Needs retry', primaryVenueName: null, hostVenueName: null,
        relationshipType: null, outcome: 'provider_error', candidates: [],
      }];
      break;
    default:
      mentionSlots = mixedSlots(alreadySaved);
  }
  const candidates = mentionSlots.flatMap((slot) => slot.candidates);
  const payload: ShareJobCandidatePayload = { version: 2, candidates, mentionSlots };
  return {
    id,
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
    suggested_query: 'Preview place',
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

export function buildFivePizzaPreviewJob(alreadySaved?: ShareJobResultCandidate | null): ShareJob {
  return buildPhase2PreviewJob(PHASE2_FIVE_PIZZA_PREVIEW_ID, alreadySaved);
}
