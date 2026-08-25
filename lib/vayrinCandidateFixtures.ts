import type {
  ShareJobCandidatePayload,
  ShareJobEvidenceFrame,
  ShareJobMentionSlot,
  ShareJobResultCandidate,
} from './shareJobResult';
import type { ShareJob } from '../services/shareJobsService';

const PHOTO_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8v5ThPwMDAwMjI4MBAEdoBAUZS2xbAAAAAElFTkSuQmCC';
const FRAME_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8f5HhPwMDAwMjiAEMDAwAhiQFBf+oKYQAAAAASUVORK5CYII=';
const FIVE_PHOTO_FIXTURES = Array.from({ length: 5 }, (_, index) => `${PHOTO_FIXTURE}#place-photo-${index + 1}`);

function evidenceFrames(timestamps: readonly number[]): ShareJobEvidenceFrame[] {
  return timestamps.slice(0, 5).map((timestampSeconds, index) => ({
    id: `fixture-frame-${index + 1}-${timestampSeconds}`,
    storagePath: null,
    url: `${FRAME_FIXTURE}#evidence-${index + 1}`,
    timestampSeconds,
    width: 768,
    height: 432,
    relevance: index < 3 ? 'candidate_evidence' : 'vayrin_selected',
  }));
}

export type VayrinCandidateFixture = {
  id: string;
  label: string;
  description: string;
  candidates: ShareJobResultCandidate[];
  selectionMode: 'single_identity' | 'multi_independent';
  sourceFrameUrl?: string | null;
  evidenceFrames?: ShareJobEvidenceFrame[];
  alreadySavedGooglePlaceIds?: string[];
  mentionSlots?: ShareJobMentionSlot[];
  suggestedQuery?: string;
  manualResults?: ShareJobResultCandidate[];
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
const sunsetCliffs = place('fixture-sunset-cliffs', 'Sunset Cliffs Natural Park', 'San Diego, California', ['park', 'tourist_attraction'], { photoUrl: PHOTO_FIXTURE, sourceTimestamps: [1] });
const sunsetPoint = place('fixture-sunset-point', 'Sunset Point Park', 'San Diego, California', ['park', 'point_of_interest'], { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [5] });
const sunsetBeach = place('fixture-sunset-beach', 'Sunset Beach', 'Orange County, California', ['tourist_attraction', 'point_of_interest'], { sourceTimestamps: [9] });
const punchBowl = place('fixture-santa-paula-punch-bowls', 'Santa Paula Punch Bowls', 'Santa Paula, California', ['park', 'tourist_attraction'], { photoUrl: PHOTO_FIXTURE, sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [0] });
const punchTrailhead = place('fixture-santa-paula-canyon', 'Santa Paula Canyon Trailhead', 'Santa Paula, California', ['hiking_area', 'point_of_interest'], { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [0] });
const inNOutSantaPaula = place('fixture-in-n-out-santa-paula', 'In-N-Out Burger', 'Santa Paula, California', ['restaurant'], { photoUrl: PHOTO_FIXTURE, sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [18] });
const inNOutVentura = place('fixture-in-n-out-ventura', 'In-N-Out Burger', 'Ventura, California', ['restaurant'], { sourceFrameUrl: FRAME_FIXTURE, sourceTimestamps: [18] });

function evidenceFrame(id: string, timestampSeconds: number): ShareJobEvidenceFrame {
  return { id, storagePath: null, url: FRAME_FIXTURE, timestampSeconds, width: 1080, height: 1920, relevance: 'candidate_evidence' };
}

function mention(
  id: string,
  displayName: string,
  timestamp: number,
  candidates: ShareJobResultCandidate[],
  outcome: ShareJobMentionSlot['outcome'] = candidates.length === 1 ? 'verified_single' : candidates.length > 1 ? 'ambiguous_candidates' : 'no_match',
  contextLabel: string | null = 'Santa Paula, CA',
): ShareJobMentionSlot {
  return {
    mentionId: id, displayName, contextLabel, primaryVenueName: null, hostVenueName: null, relationshipType: null,
    outcome, candidates, sourceTimestamps: [timestamp], sourceFrameUrl: candidates[0]?.sourceFrameUrl ?? FRAME_FIXTURE,
  };
}

const punchbowlAndBurger = [
  mention('punchbowl', 'Punchbowl', 0, [punchBowl, punchTrailhead]),
  mention('in-n-out', 'In-N-Out', 18, [inNOutSantaPaula, inNOutVentura]),
];

function multiFixture(
  id: string,
  label: string,
  mentionSlots: ShareJobMentionSlot[],
  options: Partial<VayrinCandidateFixture> = {},
): VayrinCandidateFixture {
  return {
    id,
    label,
    description: `${mentionSlots.length} independent evidence-first place moments`,
    candidates: mentionSlots.flatMap((slot) => slot.candidates),
    selectionMode: 'multi_independent',
    mentionSlots,
    evidenceFrames: mentionSlots.map((slot, index) => evidenceFrame(`${id}-frame-${index + 1}`, slot.sourceTimestamps?.[0] ?? index * 8)),
    ...options,
  };
}
const sanDiegoAlternativeSlots: ShareJobMentionSlot[] = [{
  mentionId: 'fixture-san-diego-scene', displayName: 'San Diego waterfront', contextLabel: 'San Diego, California',
  primaryVenueName: null, hostVenueName: null, relationshipType: null,
  outcome: 'ambiguous_candidates', candidates: [seaworldBridge, missionBay],
  noteEvidence: [0, 4].map((timestampSeconds) => ({ source: 'frame' as const, value: 'Fixture visual evidence', timestampSeconds })),
  identityHypotheses: [
    { name: seaworldBridge.name, contextLabel: 'San Diego, California', confidence: 0.7, evidenceKind: 'observable', timestamps: [0] },
    { name: missionBay.name, contextLabel: 'San Diego, California', confidence: 0.62, evidenceKind: 'observable', timestamps: [4] },
  ],
}];

function rawFixture(id: string, label: string, query: string, manualResults: ShareJobResultCandidate[]): VayrinCandidateFixture {
  return {
    id,
    label,
    description: `Unresolved text searches to ${manualResults.length} canonical results`,
    candidates: [],
    selectionMode: 'single_identity',
    suggestedQuery: query,
    manualResults,
    mentionSlots: [{
      mentionId: 'fixture-raw-mention', displayName: query, contextLabel: null,
      primaryVenueName: null, hostVenueName: null, relationshipType: null,
      outcome: 'no_match', candidates: [],
      identityHypotheses: [{ name: query, contextLabel: null, confidence: 0.51, evidenceKind: 'observable', timestamps: [2] }],
    }],
  };
}

export const VAYRIN_CANDIDATE_FIXTURES: readonly VayrinCandidateFixture[] = [
  { id: 'vayrin-confirm-stari-most', label: 'Stari Most', description: 'Single exact candidate with source-frame fallback', candidates: [{ ...stariMost, reasons: ['strong_name_match'], matchScore: 0.84 }], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE, evidenceFrames: evidenceFrames([3]) },
  { id: 'vayrin-confirm-san-diego', label: 'San Diego ×2', description: 'Two explicit mutually exclusive identities for one logical place', candidates: [seaworldBridge, missionBay], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE, evidenceFrames: evidenceFrames([0, 4, 9, 14]), mentionSlots: sanDiegoAlternativeSlots },
  { id: 'vayrin-confirm-supai', label: 'Supai area', description: 'Broad locality candidate', candidates: [supai], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE, evidenceFrames: evidenceFrames([2]) },
  { id: 'vayrin-confirm-photo', label: 'Place photo', description: 'Exact candidate with an existing place photo', candidates: [{ ...missionBay, googlePlaceId: 'fixture-place-photo', photoUrl: PHOTO_FIXTURE }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([4]) },
  { id: 'vayrin-confirm-five-photos', label: 'Five place photos', description: 'Candidate gallery is capped at five cached place photos', candidates: [{ ...sunsetCliffs, googlePlaceId: 'fixture-five-photos', photoUrls: FIVE_PHOTO_FIXTURES, sourceTimestamps: [1, 4, 9], reasons: ['strong_name_match', 'state_match'], matchScore: 0.86 }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([1, 4, 9, 14]) },
  { id: 'vayrin-confirm-one-photo', label: 'One place photo', description: 'Single-photo gallery remains stable', candidates: [{ ...missionBay, googlePlaceId: 'fixture-one-photo', photoUrls: [PHOTO_FIXTURE] }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([4]) },
  { id: 'vayrin-confirm-frame', label: 'Frame fallback', description: 'No place photo; candidate-associated video frame available', candidates: [{ ...stariMost, googlePlaceId: 'fixture-frame-only', photoUrl: null, sourceFrameUrl: FRAME_FIXTURE }], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-neutral', label: 'Neutral fallback', description: 'Neither place photo nor source frame available', candidates: [{ ...stariMost, googlePlaceId: 'fixture-neutral', photoUrl: null, photoUrls: [], sourceFrameUrl: null }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([3]) },
  { id: 'vayrin-confirm-three', label: '3 alternatives', description: 'Three alternatives remain directly selectable', candidates: [stariMost, seaworldBridge, missionBay], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-sunset-three', label: 'Sunset Cliffs ×3', description: 'Three plausible destinations support evidence-first multi-select', candidates: [{ ...sunsetCliffs, sourceTimestamps: [1, 4, 9], reasons: ['strong_name_match', 'state_match'], matchScore: 0.84 }, { ...sunsetPoint, sourceTimestamps: [4], reasons: ['meaningful_name_match'], matchScore: 0.63 }, { ...sunsetBeach, sourceTimestamps: [9], reasons: ['meaningful_name_match'], matchScore: 0.48 }], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE, evidenceFrames: evidenceFrames([1, 4, 9, 14]) },
  { id: 'vayrin-confirm-five-internal', label: 'Five internal / three shown', description: 'Full evidence retained with a three-row presentation cap', candidates: [sunsetCliffs, sunsetPoint, sunsetBeach, stariMost, missionBay], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-long-name', label: 'Long name', description: 'Long place name wraps without clipping', candidates: [place('fixture-long-name', 'The Museum of Extremely Long Place Names and Remarkably Specific Destinations', 'Central Waterfront, San Diego, California', ['museum', 'point_of_interest'], { photoUrl: PHOTO_FIXTURE })], selectionMode: 'single_identity' },
  { id: 'vayrin-confirm-long-locality', label: 'Long locality', description: 'Long locality wraps without clipping', candidates: [place('fixture-long-locality', 'Stone Bridge Lookout', 'The Historic Riverside and Old Market District of Mostar, Federation of Bosnia and Herzegovina', ['tourist_attraction', 'point_of_interest'], { sourceFrameUrl: FRAME_FIXTURE })], selectionMode: 'single_identity', sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-duplicate', label: 'Already saved', description: 'Duplicate-safe source enrichment state', candidates: [{ ...stariMost, googlePlaceId: 'fixture-duplicate' }], selectionMode: 'single_identity', alreadySavedGooglePlaceIds: ['fixture-duplicate'], sourceFrameUrl: FRAME_FIXTURE },
  { id: 'vayrin-confirm-low-confidence', label: 'Low match', description: 'Supported low qualitative strength without a fabricated percentage', candidates: [{ ...sunsetBeach, googlePlaceId: 'fixture-low-confidence', matchScore: 0.41, reasons: ['meaningful_name_match'] }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([9]) },
  { id: 'vayrin-confirm-qualitative-only', label: 'Qualitative only', description: 'Producer-provided qualitative strength with no numeric score', candidates: [{ ...missionBay, googlePlaceId: 'fixture-qualitative-only', matchScore: null, matchStrength: 'medium', reasons: ['state_match'] }], selectionMode: 'single_identity', evidenceFrames: evidenceFrames([4]) },
  { id: 'vayrin-confirm-missing-frames', label: 'Missing retained frames', description: 'Analysis completed before durable frame retention was available', candidates: [{ ...stariMost, googlePlaceId: 'fixture-missing-frames' }], selectionMode: 'single_identity', evidenceFrames: [] },
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
      noteEvidence: (candidate.sourceTimestamps ?? [index * 5]).map((timestampSeconds) => ({
        source: 'frame' as const,
        value: 'Fixture visual evidence',
        timestampSeconds,
      })),
    })),
  },
  multiFixture('vayrin-multi-punchbowl-in-n-out', 'Punchbowl + In-N-Out', punchbowlAndBurger),
  multiFixture('vayrin-multi-two-resolved', 'Two resolved mentions', [mention('resolved-a', 'Punchbowl', 0, [punchBowl]), mention('resolved-b', 'In-N-Out', 18, [inNOutSantaPaula])]),
  multiFixture('vayrin-multi-three-resolved', 'Three resolved mentions', [mention('three-a', 'Punchbowl', 0, [punchBowl]), mention('three-b', 'In-N-Out', 18, [inNOutSantaPaula]), mention('three-c', 'Mission Bay', 33, [missionBay], 'verified_single', 'San Diego, CA')]),
  multiFixture('vayrin-multi-existing-and-new', 'Already saved + new', [mention('existing', 'Punchbowl', 0, [punchBowl]), mention('new', 'In-N-Out', 18, [inNOutSantaPaula])], { alreadySavedGooglePlaceIds: [punchBowl.googlePlaceId] }),
  multiFixture('vayrin-multi-unresolved-two-resolved', 'One unresolved + two resolved', [mention('none', 'Beach', 0, [], 'no_match'), mention('resolved-one', 'Punchbowl', 9, [punchBowl]), mention('resolved-two', 'In-N-Out', 18, [inNOutSantaPaula])]),
  multiFixture('vayrin-multi-manual-search', 'Manual search for one mention', [mention('manual', 'Punch Bowl', 0, [], 'no_match'), mention('manual-sibling', 'In-N-Out', 18, [inNOutSantaPaula])], { manualResults: [punchBowl, punchTrailhead] }),
  multiFixture('vayrin-multi-duplicate-canonical', 'Repeated canonical candidate', [mention('duplicate-a', 'Punchbowl', 0, [punchBowl]), mention('duplicate-b', 'Punch Bowl trail', 7, [punchBowl])]),
  multiFixture('vayrin-multi-three-per-mention', 'Three candidates per mention', [mention('three-punch', 'Punchbowl', 0, [punchBowl, punchTrailhead, sunsetCliffs]), mention('three-burger', 'In-N-Out', 18, [inNOutSantaPaula, inNOutVentura, missionBay])]),
  multiFixture('vayrin-multi-five-internal', 'Five internal / three shown', [mention('five-punch', 'Punchbowl', 0, [punchBowl, punchTrailhead, sunsetCliffs, sunsetPoint, sunsetBeach]), mention('five-burger', 'In-N-Out', 18, [inNOutSantaPaula])]),
  multiFixture('vayrin-multi-missing-image', 'Missing candidate image', [mention('missing-image', 'Scenic overlook', 0, [{ ...sunsetBeach, photoUrl: null, photoUrls: [], sourceFrameUrl: null }]), mention('image-sibling', 'In-N-Out', 18, [inNOutSantaPaula])]),
  multiFixture('vayrin-multi-long-name', 'Long place name', [mention('long-name', 'Museum', 0, [place('multi-long-name', 'The Museum of Extremely Long Place Names and Remarkably Specific Destinations', 'Santa Paula, California', ['museum'], { photoUrl: PHOTO_FIXTURE })]), mention('long-sibling', 'In-N-Out', 18, [inNOutSantaPaula])]),
  multiFixture('vayrin-multi-evidence-frames', 'Evidence frames per mention', punchbowlAndBurger),
  multiFixture('vayrin-multi-five-mentions', 'Five independent mentions', [mention('five-a', 'Punchbowl', 0, [punchBowl]), mention('five-b', 'In-N-Out', 10, [inNOutSantaPaula]), mention('five-c', 'Mission Bay', 20, [missionBay], 'verified_single', 'San Diego, CA'), mention('five-d', 'Stari Most', 30, [stariMost], 'verified_single', 'Mostar'), mention('five-e', 'Sunset Cliffs', 40, [sunsetCliffs], 'verified_single', 'San Diego, CA')]),
  multiFixture('vayrin-multi-chain-context', 'Chain mention after context ranking', [mention('chain-punch', 'Punchbowl', 0, [punchBowl]), mention('chain-branch', 'In-N-Out', 18, [inNOutSantaPaula, inNOutVentura])]),
  rawFixture('vayrin-confirm-raw-waterfall', 'Raw waterfall phrase', 'Worlds Most Dangerous Waterfall Hole', [sunsetCliffs, sunsetPoint]),
  rawFixture('vayrin-confirm-raw-zero', 'Raw name → 0', 'Unfindable Test Landmark Phrase', []),
  rawFixture('vayrin-confirm-raw-two', 'Raw name → 2', 'Sunset overlook', [sunsetCliffs, sunsetPoint]),
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
    noteEvidence: fixture.candidates.flatMap((candidate) => candidate.sourceTimestamps ?? []).slice(0, 12).map((timestampSeconds) => ({
      source: 'frame' as const,
      value: 'Fixture visual evidence',
      timestampSeconds,
    })),
  }] : []);
  const payload: ShareJobCandidatePayload = {
    version: 2,
    selectionMode: fixture.selectionMode,
    candidates: fixture.candidates,
    mentionSlots,
    evidenceFrames: fixture.evidenceFrames ?? [],
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
      fixtureManualResults: fixture.manualResults ?? null,
    },
    suggested_query: fixture.suggestedQuery ?? fixture.candidates[0]?.name ?? 'Stari Most',
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
