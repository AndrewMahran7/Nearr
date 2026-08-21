/** Shared persisted contract for share-job confirmation results. */

import {
  selectionModeForPlaceResult,
  type SelectionMode,
} from './placeSelection.ts';

export type ShareJobResultCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  primaryType?: string | null;
  primaryTypeDisplayName?: string | null;
  googleMapsTypeLabel?: string | null;
  shortFormattedAddress?: string | null;
  businessStatus?: string | null;
  matchScore: number | null;
  /** Source-grounded cue already generated for this logical result. */
  aiNote?: string | null;
};

export type ShareJobMentionOutcome =
  | 'verified_single'
  | 'ambiguous_candidates'
  | 'no_match'
  | 'rejected_insufficient_evidence'
  | 'provider_error';

export type ShareJobMentionSlot = {
  mentionId: string;
  displayName: string;
  contextLabel?: string | null;
  primaryVenueName: string | null;
  hostVenueName: string | null;
  relationshipType: string | null;
  outcome: ShareJobMentionOutcome;
  candidates: ShareJobResultCandidate[];
  aiNote?: string | null;
  saveState?: 'pending' | 'auto_saved' | 'already_saved';
  savedPlaceId?: string | null;
  /** Source-scene timestamps, seconds from the beginning of the post. */
  sourceTimestamps?: number[];
  /** Ranked Vayrin identities for this one logical scene. This survives even
   * when Places returns no candidate, enabling a future "few leads" UI without
   * pretending a Google Place was verified. */
  identityHypotheses?: Array<{
    name: string;
    contextLabel: string | null;
    confidence: number | null;
    evidenceKind: 'observable' | 'model_prior';
    timestamps: number[];
  }>;
};

export type ShareJobCandidatePayload = {
  version: 2;
  selectionMode?: SelectionMode;
  candidates: ShareJobResultCandidate[];
  mentionSlots: ShareJobMentionSlot[];
  savedPlaceIds?: string[];
};

function normalizedTimestamps(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0,
  ))].sort((a, b) => a - b).slice(0, 24);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeResultCandidate(input: unknown): ShareJobResultCandidate | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  const googlePlaceId = text(row.googlePlaceId);
  const name = text(row.name);
  if (!googlePlaceId || !name) return null;
  return {
    googlePlaceId,
    name,
    formattedAddress: text(row.formattedAddress),
    latitude: typeof row.latitude === 'number' && Number.isFinite(row.latitude) ? row.latitude : null,
    longitude: typeof row.longitude === 'number' && Number.isFinite(row.longitude) ? row.longitude : null,
    types: Array.isArray(row.types)
      ? row.types.filter((value): value is string => typeof value === 'string').slice(0, 8)
      : [],
    primaryType: text(row.primaryType),
    primaryTypeDisplayName: text(row.primaryTypeDisplayName),
    googleMapsTypeLabel: text(row.googleMapsTypeLabel),
    shortFormattedAddress: text(row.shortFormattedAddress),
    businessStatus: text(row.businessStatus),
    matchScore: typeof row.matchScore === 'number' && Number.isFinite(row.matchScore)
      ? row.matchScore
      : typeof row.confidenceScore === 'number' && Number.isFinite(row.confidenceScore)
        ? row.confidenceScore
        : null,
    aiNote: text(row.aiNote),
  };
}

export function normalizeResultCandidates(input: unknown): ShareJobResultCandidate[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const candidates: ShareJobResultCandidate[] = [];
  for (const raw of input) {
    const candidate = normalizeResultCandidate(raw);
    if (!candidate || seen.has(candidate.googlePlaceId)) continue;
    seen.add(candidate.googlePlaceId);
    candidates.push(candidate);
  }
  return candidates;
}

const OUTCOMES = new Set<ShareJobMentionOutcome>([
  'verified_single',
  'ambiguous_candidates',
  'no_match',
  'rejected_insufficient_evidence',
  'provider_error',
]);

export function normalizeMentionSlots(input: unknown): ShareJobMentionSlot[] {
  if (!Array.isArray(input)) return [];
  const slots: ShareJobMentionSlot[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 10)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const mentionId = text(row.mentionId);
    const displayName = text(row.displayName);
    const outcome = text(row.outcome) as ShareJobMentionOutcome | null;
    if (!mentionId || !displayName || !outcome || !OUTCOMES.has(outcome) || seen.has(mentionId)) continue;
    seen.add(mentionId);
    const identityHypotheses = Array.isArray(row.identityHypotheses)
      ? row.identityHypotheses.slice(0, 6).flatMap((rawIdentity) => {
          if (!rawIdentity || typeof rawIdentity !== 'object') return [];
          const identity = rawIdentity as Record<string, unknown>;
          const name = text(identity.name);
          if (!name) return [];
          return [{
            name,
            contextLabel: text(identity.contextLabel),
            confidence: typeof identity.confidence === 'number' && Number.isFinite(identity.confidence)
              ? Math.max(0, Math.min(1, identity.confidence))
              : null,
            evidenceKind: identity.evidenceKind === 'model_prior' ? 'model_prior' as const : 'observable' as const,
            timestamps: Array.isArray(identity.timestamps)
              ? identity.timestamps.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0).slice(0, 12)
              : [],
          }];
        })
      : [];
    slots.push({
      mentionId,
      displayName,
      contextLabel: text(row.contextLabel),
      primaryVenueName: text(row.primaryVenueName),
      hostVenueName: text(row.hostVenueName),
      relationshipType: text(row.relationshipType),
      outcome,
      candidates: normalizeResultCandidates(row.candidates).slice(0, 5),
      aiNote: text(row.aiNote),
      saveState: row.saveState === 'auto_saved' || row.saveState === 'already_saved'
        ? row.saveState
        : 'pending',
      savedPlaceId: text(row.savedPlaceId),
      sourceTimestamps: normalizedTimestamps(row.sourceTimestamps),
      identityHypotheses,
    });
  }
  return slots;
}

export function buildShareJobCandidatePayload(candidates: unknown, mentionResults: unknown): ShareJobCandidatePayload {
  const mentionSlots = normalizeMentionSlots(mentionResults);
  return {
    version: 2,
    selectionMode: selectionModeForPlaceResult({ mentionSlots }),
    candidates: normalizeResultCandidates(candidates).slice(0, 10),
    mentionSlots,
  };
}

export function mentionCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  return normalizeMentionSlots((payload as Record<string, unknown>).mentionSlots).length;
}

export function savedPlaceIdsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const values = (payload as Record<string, unknown>).savedPlaceIds;
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === 50) break;
  }
  return ids;
}

export function preselectedCandidateIds(
  slots: ShareJobMentionSlot[],
  alreadySavedPlaceIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const selected = new Set<string>();
  for (const slot of slots) {
    if (slot.outcome !== 'verified_single' || slot.candidates.length !== 1) continue;
    const candidate = slot.candidates[0]!;
    if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) continue;
    const id = candidate.googlePlaceId;
    if (!alreadySavedPlaceIds.has(id)) selected.add(id);
  }
  return selected;
}

export function selectCandidateWithinMention(
  selected: ReadonlySet<string>,
  slot: ShareJobMentionSlot,
  candidateId: string,
): Set<string> {
  const next = new Set(selected);
  for (const candidate of slot.candidates) next.delete(candidate.googlePlaceId);
  if (!selected.has(candidateId)) next.add(candidateId);
  return next;
}

export function selectedUnsavedCandidates(
  slots: ShareJobMentionSlot[],
  selected: ReadonlySet<string>,
  alreadySavedPlaceIds: ReadonlySet<string>,
): ShareJobResultCandidate[] {
  const byId = new Map<string, ShareJobResultCandidate>();
  for (const slot of slots) {
    for (const candidate of slot.candidates) {
      if (selected.has(candidate.googlePlaceId) && !alreadySavedPlaceIds.has(candidate.googlePlaceId)) {
        byId.set(candidate.googlePlaceId, candidate);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Merge an inline search result into one logical mention without replacing the
 * surrounding batch. This is the persistence boundary for multi-place review:
 * resolving m2 must not discard m1, m3, or any later logical slot.
 */
export function mergeMentionSearchResults(
  slots: readonly ShareJobMentionSlot[],
  mentionId: string,
  candidates: readonly ShareJobResultCandidate[],
): ShareJobMentionSlot[] {
  return slots.map((slot) => {
    if (slot.mentionId !== mentionId) return slot;
    return {
      ...slot,
      outcome: candidates.length > 0 ? 'ambiguous_candidates' : 'no_match',
      candidates: normalizeResultCandidates(candidates),
    };
  });
}

export function multiPlaceTitle(slotCount: number): string {
  return `I found ${slotCount} ${slotCount === 1 ? 'place' : 'places'}`;
}

export function saveSelectedLabel(count: number): string {
  return `Save selected (${Math.max(0, Math.floor(count))})`;
}

function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function sourceTimestampLabel(timestamps: readonly number[]): string | null {
  const normalized = normalizedTimestamps(timestamps);
  if (normalized.length === 0) return null;
  const first = normalized[0]!;
  const last = normalized[normalized.length - 1]!;
  return first === last ? `At ${clockTime(first)}` : `${clockTime(first)}–${clockTime(last)}`;
}

export function removeSuccessfulSelections(
  selected: ReadonlySet<string>,
  successfulIds: Iterable<string>,
): Set<string> {
  const next = new Set(selected);
  for (const id of successfulIds) next.delete(id);
  return next;
}

export type SharePlaceSaveOutcome = {
  logicalPlaceId: string;
  candidateId: string;
  status: 'saved' | 'duplicate' | 'failed';
  savedPlaceId: string | null;
};

export type ShareSaveCompletionPlan = {
  createdSavedPlaceIds: string[];
  duplicateSavedPlaceIds: string[];
  successfulCandidateIds: string[];
  failedCandidateIds: string[];
  destination: 'none' | 'single' | 'group';
};

function uniqueNonEmpty(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function planShareSaveCompletion(
  outcomes: readonly SharePlaceSaveOutcome[],
): ShareSaveCompletionPlan {
  const createdSavedPlaceIds = uniqueNonEmpty(
    outcomes.filter((outcome) => outcome.status === 'saved').map((outcome) => outcome.savedPlaceId),
  );
  const duplicateSavedPlaceIds = uniqueNonEmpty(
    outcomes.filter((outcome) => outcome.status === 'duplicate').map((outcome) => outcome.savedPlaceId),
  );
  const successfulCandidateIds = uniqueNonEmpty(
    outcomes
      .filter((outcome) => outcome.status !== 'failed')
      .map((outcome) => outcome.candidateId),
  );
  const failedCandidateIds = uniqueNonEmpty(
    outcomes.filter((outcome) => outcome.status === 'failed').map((outcome) => outcome.candidateId),
  );
  return {
    createdSavedPlaceIds,
    duplicateSavedPlaceIds,
    successfulCandidateIds,
    failedCandidateIds,
    destination:
      createdSavedPlaceIds.length > 1
        ? 'group'
        : createdSavedPlaceIds.length === 1
          ? 'single'
          : 'none',
  };
}
