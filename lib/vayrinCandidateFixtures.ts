import type { ShareJobCandidatePayload, ShareJobMentionSlot, ShareJobResultCandidate } from './shareJobResult';
import type { ShareJob } from '../services/shareJobsService';

const PHOTO_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8v5ThPwMDAwMjI4MBAEdoBAUZS2xbAAAAAElFTkSuQmCC';
const FRAME_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8f5HhPwMDAwMjiAEMDAwAhiQFBf+oKYQAAAAASUVORK5CYII=';

export type VayrinCandidateFixture = {
  id: string;
  label: string;
  description: string;
  candidates: ShareJobResultCandidate[];
  selectionMode: 'single_identity' | 'multi_independent';
  sourceFrameUrl?: string | null;
  alreadySavedGooglePlaceIds?: string[];
  mentionSlots?: ShareJobMentionSlot[];
};

function place(
  id: string,
  name: string,
  address: string,
  types: string[],
  options: Partial<ShareJobResultCandidate> = {},
): ShareJobResultCandidate {
  return {
    googlePlaceId: id,
    name,
    formattedAddress: address,
    latitude: options.latitude ?? 0,
    longitude: options.longitude ?? 0,
    types,
    matchScore: options.matchScore ?? 0.78,
    ...options,
  };
}

const stariMost = place(
  'fixture-stari-most',
  'Stari Most',
  'Mostar 88000, Bosnia & Herzegovina',
  ['tourist_attraction', 'point_of_interest'],
  { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [3] },
);
const missionBay = place(
  'fixture-mission-bay',
  'Mission Bay',
  'San Diego, California',
  ['park', 'point_of_interest'],
  { photoUrl: PHOTO_FIXTURE, sourceTimestamps: [4] },
);
const seaworldBridge = place(
  'fixture-seaworld-drive-bridge',
  'SeaWorld Drive Bridge over Tecolote Creek',
  'SeaWorld Drive, San Diego, California',
  ['point_of_interest'],
  { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [0] },
);
const supai = place(
  'fixture-supai',
  'Supai',
  'Arizona, United States',
  ['locality', 'political'],
  { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [2] },
);

export const VAYRIN_CANDIDATE_FIXTURES: readonly VayrinCandidateFixture[] = [
  { id: 'vayrin-confirm-stari-most', label: 'Stari Most', description: 'Single exact candidate with source-frame fallback', candidates: [stariMost], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-san-diego', label: 'San Diego ×2', description: 'Two alternatives for one logical place', candidates: [seaworldBridge, missionBay], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-supai', label: 'Supai area', description: 'Broad locality candidate', candidates: [supai], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-photo', label: 'Place photo', description: 'Exact candidate with an existing place photo', candidates: [{ ...missionBay, googlePlaceId: 'fixture-place-photo', photoUrl: PHOTO_FIXTURE }], selectionMode: 'single_identity' },
  { id: 'vayrin-confirm-frame', label: 'Frame fallback', description: 'No place photo; candidate-associated video frame available', candidates: [{ ...stariMost, googlePlaceId: 'fixture-frame-only', photoUrl: null, sourceFrameUrl: FRAME_FIXTURE }], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-neutral', label: 'Neutral fallback', description: 'Neither place photo nor source frame available', candidates: [{ ...stariMost, googlePlaceId: 'fixture-neutral', photoUrl: null, sourceFrameUrl: null }], selectionMode: 'single_identity' },
  { id: 'vayrin-confirm-three', label: '3 alternatives', description: 'Three alternatives remain directly selectable', candidates: [stariMost, seaworldBridge, missionBay], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-long-name', label: 'Long name', description: 'Long place name wraps without clipping', candidates: [place('fixture-long-name', 'The Museum of Extremely Long Place Names and Remarkably Specific Destinations', 'Central Waterfront, San Diego, California', ['museum', 'point_of_interest'], { photoUrl: PHOTO_FIXTURE })], selectionMode: 'single_identity' },
  { id: 'vayrin-confirm-long-locality', label: 'Long locality', description: 'Long locality wraps without clipping', candidates: [place('fixture-long-locality', 'Stone Bridge Lookout', 'The Historic Riverside and Old Market District of Mostar, Federation of Bosnia and Herzegovina', ['tourist_attraction', 'point_of_interest'], { sourceFrameUrl: FRAME_FIXTURE })], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-duplicate', label: 'Already saved', description: 'Duplicate-safe source enrichment state', candidates: [{ ...stariMost, googlePlaceId: 'fixture-duplicate' }], selectionMode: 'single_identity', alreadySavedGooglePlaceIds: ['fixture-duplicate'], sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-none', label: 'No candidate', description: 'Honest no-candidate recovery', candidates: [], selectionMode: 'single_identity' },
  {
    id: 'vayrin-confirm-multi-place',
    label: 'Multi-place',
    description: 'Independent places remain multi-select',
    candidates: [stariMost, missionBay],
    selectionMode: 'multi_independent',
    sourceFrameUrl: FRAME_FIXTURE,
    mentionSlots: [stariMost, missionBay].map((candidate, index) => ({
      mentionId: `fixture-scene-${index + 1}`,
      displayName: candidate.name,
      contextLabel: candidate.formattedAddress,
      primaryVenueName: null,
      hostVenueName: null,
      relationshipType: null,
      outcome: 'verified_single',
      candidates: [candidate],
      sourceTimestamps: candidate.sourceTimestamps ?? [index * 5],
    })),
  },
] as const;

export function isVayrinCandidateFixtureId(value: unknown): value is string {
  return typeof value === 'string' && VAYRIN_CANDIDATE_FIXTURES.some((fixture) => fixture.id === value);
}

export function getVayrinCandidateFixture(id: string): VayrinCandidateFixture | null {
  return VAYRIN_CANDIDATE_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

export function buildVayrinCandidateFixtureJob(id: string): ShareJob {
  const fixture = getVayrinCandidateFixture(id);
  if (!fixture) throw new Error(`Unknown Vayrin candidate fixture: ${id}`);
  const mentionSlots = fixture.mentionSlots ?? (fixture.candidates.length > 0 ? [{
    mentionId: 'fixture-logical-place',
    displayName: fixture.candidates[0]!.name,
    contextLabel: fixture.candidates[0]!.formattedAddress,
    primaryVenueName: null,
    hostVenueName: null,
    relationshipType: null,
    outcome: fixture.candidates.length > 1 ? 'ambiguous_candidates' as const : 'verified_single' as const,
    candidates: fixture.candidates,
    sourceTimestamps: fixture.candidates.flatMap((candidate) => candidate.sourceTimestamps ?? []).slice(0, 12),
  }] : []);
  const payload: ShareJobCandidatePayload = {
    version: 2,
    selectionMode: fixture.selectionMode,
    candidates: fixture.candidates,
    mentionSlots,
  };
  return {
    id,
    user_id: 'development-preview',
    source_url: 'https://www.instagram.com/reel/development-preview/',
    canonical_url: 'https://www.instagram.com/reel/development-preview/',
    source_platform: 'instagram',
    status: 'needs_help',
    progress_stage: 'completed',
    decision: fixture.selectionMode === 'multi_independent'
      ? 'multi_candidate_confirmation'
      : fixture.candidates.length > 1
        ? 'candidate_picker'
        : fixture.candidates.length === 1
          ? 'candidate_confirmation'
          : 'manual_fallback',
    saved_place_id: null,
    candidate_payload: payload,
    extraction_payload: {
      preview: true,
      sourceFrameUrl: fixture.sourceFrameUrl ?? null,
      fixtureAlreadySavedGooglePlaceIds: fixture.alreadySavedGooglePlaceIds ?? [],
    },
    suggested_query: fixture.candidates[0]?.name ?? 'Stari Most',
    needs_help_reason: fixture.candidates.length === 0 ? 'insufficient_evidence' : 'candidate_confirmation',
    failure_reason: null,
    failure_category: null,
    failure_code: null,
    analysis_attempted: true,
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
