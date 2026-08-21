import {
  normalizeResultCandidates,
  type ShareJobMentionSlot,
  type ShareJobResultCandidate,
  type SharePlaceSaveOutcome,
} from './shareJobResult';
import type { SelectionMode } from './placeSelection';

export type BatchResolution = 'resolved' | 'ambiguous' | 'unmatched' | 'unavailable';
export type BatchPersistence = 'pending' | 'saved' | 'already_saved';
export type BatchSearchPhase = 'closed' | 'idle' | 'searching' | 'results' | 'empty' | 'error';

export type MultiPlaceBatchRow = {
  logicalPlaceId: string;
  selectionMode: SelectionMode;
  extractedName: string;
  contextLabel: string | null;
  primaryVenueName: string | null;
  hostVenueName: string | null;
  relationshipType: string | null;
  aiNote: string | null;
  candidates: ShareJobResultCandidate[];
  selectedCandidateId: string | null;
  resolution: BatchResolution;
  selectedForSave: boolean;
  persistence: BatchPersistence;
  savedPlaceId: string | null;
  sourceTimestamps: number[];
  candidateSelectorExpanded: boolean;
  search: {
    phase: BatchSearchPhase;
    query: string;
    candidates: ShareJobResultCandidate[];
    error: string | null;
  };
  saveError: string | null;
};

export type MultiPlaceBatchFeedback = {
  attempted: number;
  saved: number;
  alreadySaved: number;
  failed: number;
} | null;

export type MultiPlaceBatch = {
  jobId: string;
  selectionMode: SelectionMode;
  order: string[];
  rows: Record<string, MultiPlaceBatchRow>;
  feedback: MultiPlaceBatchFeedback;
};

export type SavedPlaceIdsByGoogleId = Readonly<Record<string, string>>;

function validCandidate(candidate: ShareJobResultCandidate | undefined): boolean {
  return !!candidate?.googlePlaceId &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude);
}

function initialResolution(slot: ShareJobMentionSlot): BatchResolution {
  if (slot.outcome === 'provider_error') return 'unavailable';
  if (slot.outcome === 'no_match' || slot.outcome === 'rejected_insufficient_evidence') return 'unmatched';
  return slot.outcome === 'verified_single' && slot.candidates.length === 1
    ? 'resolved'
    : 'ambiguous';
}

function mergeCandidates(
  authoritative: readonly ShareJobResultCandidate[],
  retained: readonly ShareJobResultCandidate[] = [],
): ShareJobResultCandidate[] {
  return normalizeResultCandidates([...authoritative, ...retained]);
}

/**
 * Reconcile Realtime/server data into the keyed batch without replacing local
 * choices, row-scoped search results, disclosure state, or partial-save state.
 */
export function reconcileMultiPlaceBatch(args: {
  jobId: string;
  slots: readonly ShareJobMentionSlot[];
  savedByGoogleId?: SavedPlaceIdsByGoogleId;
  previous?: MultiPlaceBatch | null;
}): MultiPlaceBatch {
  const previous = args.previous?.jobId === args.jobId ? args.previous : null;
  const savedByGoogleId = args.savedByGoogleId ?? {};
  const rows: Record<string, MultiPlaceBatchRow> = {};
  const order: string[] = [];

  for (const slot of args.slots) {
    const logicalPlaceId = slot.mentionId;
    if (!logicalPlaceId || rows[logicalPlaceId]) continue;
    order.push(logicalPlaceId);
    const prior = previous?.rows[logicalPlaceId];
    const candidates = mergeCandidates(slot.candidates, [
      ...(prior?.candidates ?? []),
      ...(prior?.search.candidates ?? []),
    ]);
    const serverSavedPlaceId = slot.savedPlaceId ?? null;
    const serverPersistence: BatchPersistence = slot.saveState === 'auto_saved'
      ? 'saved'
      : slot.saveState === 'already_saved'
        ? 'already_saved'
        : 'pending';
    const initialCandidateId = slot.outcome === 'verified_single' && slot.candidates.length === 1
      ? slot.candidates[0]!.googlePlaceId
      : null;
    const retainedCandidateId = prior?.selectedCandidateId &&
      candidates.some((candidate) => candidate.googlePlaceId === prior.selectedCandidateId)
      ? prior.selectedCandidateId
      : null;
    const selectedCandidateId = retainedCandidateId ?? initialCandidateId;
    // A place the user already has on their map is still a valid save target:
    // running the save is how this post's source_url / ai_note reach the
    // EXISTING row. Only a save this job already performed (server saveState,
    // or an outcome applied earlier in this session) is terminal.
    const localSavedPlaceId = selectedCandidateId ? savedByGoogleId[selectedCandidateId] ?? null : null;
    const savedPlaceId = prior?.savedPlaceId ?? serverSavedPlaceId ?? localSavedPlaceId;
    const persistence: BatchPersistence = prior && prior.persistence !== 'pending'
      ? prior.persistence
      : serverPersistence;
    const candidate = candidates.find((item) => item.googlePlaceId === selectedCandidateId);
    const resolution = prior?.resolution === 'resolved' && candidate
      ? 'resolved'
      : initialResolution(slot);
    const canDefaultSelect = resolution === 'resolved' &&
      validCandidate(candidate) &&
      persistence === 'pending' &&
      !savedPlaceId;

    rows[logicalPlaceId] = {
      logicalPlaceId,
      selectionMode: 'single_identity',
      extractedName: slot.displayName,
      contextLabel: slot.contextLabel ?? null,
      primaryVenueName: slot.primaryVenueName,
      hostVenueName: slot.hostVenueName,
      relationshipType: slot.relationshipType,
      aiNote: slot.aiNote ?? null,
      candidates,
      selectedCandidateId,
      resolution,
      selectedForSave: persistence === 'pending'
        ? prior?.selectedForSave ?? canDefaultSelect
        : false,
      persistence,
      savedPlaceId,
      sourceTimestamps: slot.sourceTimestamps ?? [],
      candidateSelectorExpanded: prior?.candidateSelectorExpanded ?? false,
      search: prior?.search ?? {
        phase: 'closed',
        query: (slot.primaryVenueName ?? slot.displayName).trim(),
        candidates: [],
        error: null,
      },
      saveError: prior?.saveError ?? null,
    };
  }

  return {
    jobId: args.jobId,
    selectionMode: 'multi_independent',
    order,
    rows,
    feedback: previous?.feedback ?? null,
  };
}

export function rowCandidate(row: MultiPlaceBatchRow): ShareJobResultCandidate | null {
  if (!row.selectedCandidateId) return null;
  return row.candidates.find((candidate) => candidate.googlePlaceId === row.selectedCandidateId) ?? null;
}

export function setCandidateSelector(
  batch: MultiPlaceBatch,
  logicalPlaceId: string,
  expanded: boolean,
): MultiPlaceBatch {
  const rows = { ...batch.rows };
  for (const id of batch.order) {
    const row = rows[id]!;
    rows[id] = {
      ...row,
      candidateSelectorExpanded: id === logicalPlaceId ? expanded : false,
      search: id === logicalPlaceId || row.search.phase === 'closed'
        ? row.search
        : { ...row.search, phase: 'closed' },
    };
  }
  return { ...batch, rows };
}

export function chooseBatchCandidate(
  batch: MultiPlaceBatch,
  logicalPlaceId: string,
  candidate: ShareJobResultCandidate,
  savedPlaceId: string | null = null,
): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  // `savedPlaceId` here means "the user already has this place" — it is kept
  // for display, but it must NOT block the save: the save is what attaches
  // this post to that existing row.
  return {
    ...batch,
    feedback: null,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: {
        ...row,
        candidates: mergeCandidates([candidate], row.candidates),
        selectedCandidateId: candidate.googlePlaceId,
        resolution: 'resolved',
        selectedForSave: validCandidate(candidate),
        persistence: 'pending',
        savedPlaceId,
        candidateSelectorExpanded: false,
        search: { ...row.search, phase: 'closed', error: null },
        saveError: null,
      },
    },
  };
}

export function toggleBatchRow(batch: MultiPlaceBatch, logicalPlaceId: string): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (
    !row ||
    row.persistence !== 'pending' ||
    row.resolution !== 'resolved' ||
    !validCandidate(rowCandidate(row) ?? undefined) ||
    duplicateSelectionOwner(batch, logicalPlaceId)
  ) {
    return batch;
  }
  return {
    ...batch,
    feedback: null,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: { ...row, selectedForSave: !row.selectedForSave, saveError: null },
    },
  };
}

export function openBatchSearch(batch: MultiPlaceBatch, logicalPlaceId: string): MultiPlaceBatch {
  const rows = { ...batch.rows };
  for (const id of batch.order) {
    const row = rows[id]!;
    rows[id] = id === logicalPlaceId
      ? {
          ...row,
          candidateSelectorExpanded: false,
          search: {
            ...row.search,
            phase: row.search.phase === 'closed' ? 'idle' : row.search.phase,
            query: row.search.query || (row.primaryVenueName ?? row.extractedName),
            error: null,
          },
        }
      : {
          ...row,
          candidateSelectorExpanded: false,
          search: row.search.phase === 'closed' ? row.search : { ...row.search, phase: 'closed' },
        };
  }
  return { ...batch, rows };
}

export function closeBatchSearch(batch: MultiPlaceBatch, logicalPlaceId: string): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  return {
    ...batch,
    rows: { ...batch.rows, [logicalPlaceId]: { ...row, search: { ...row.search, phase: 'closed' } } },
  };
}

export function setBatchSearchQuery(
  batch: MultiPlaceBatch,
  logicalPlaceId: string,
  query: string,
): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  return {
    ...batch,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: {
        ...row,
        search: { phase: 'idle', query, candidates: [], error: null },
      },
    },
  };
}

export function startBatchSearch(batch: MultiPlaceBatch, logicalPlaceId: string): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  return {
    ...batch,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: { ...row, search: { ...row.search, phase: 'searching', error: null } },
    },
  };
}

export function finishBatchSearch(
  batch: MultiPlaceBatch,
  logicalPlaceId: string,
  candidates: readonly ShareJobResultCandidate[],
): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  const normalized = normalizeResultCandidates(candidates);
  return {
    ...batch,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: {
        ...row,
        search: {
          ...row.search,
          phase: normalized.length ? 'results' : 'empty',
          candidates: normalized,
          error: null,
        },
      },
    },
  };
}

export function failBatchSearch(
  batch: MultiPlaceBatch,
  logicalPlaceId: string,
  message = 'Search is ready to retry.',
): MultiPlaceBatch {
  const row = batch.rows[logicalPlaceId];
  if (!row) return batch;
  return {
    ...batch,
    rows: {
      ...batch.rows,
      [logicalPlaceId]: {
        ...row,
        search: { ...row.search, phase: 'error', error: message },
      },
    },
  };
}

export type BatchSaveTarget = {
  logicalPlaceId: string;
  candidate: ShareJobResultCandidate;
  aiNote: string | null;
};

export function selectedBatchTargets(batch: MultiPlaceBatch): BatchSaveTarget[] {
  const targets: BatchSaveTarget[] = [];
  const providerIds = new Set<string>();
  for (const id of batch.order) {
    const row = batch.rows[id]!;
    const candidate = rowCandidate(row);
    if (!row.selectedForSave || row.persistence !== 'pending' || row.resolution !== 'resolved' || !candidate || !validCandidate(candidate)) continue;
    if (providerIds.has(candidate.googlePlaceId)) continue;
    providerIds.add(candidate.googlePlaceId);
    targets.push({ logicalPlaceId: id, candidate, aiNote: row.aiNote });
  }
  return targets;
}

function independentlyEligible(row: MultiPlaceBatchRow): boolean {
  return row.persistence === 'pending' &&
    row.resolution === 'resolved' &&
    validCandidate(rowCandidate(row) ?? undefined);
}

function eligibleForSaveAll(row: MultiPlaceBatchRow): boolean {
  // Existing places can still be explicitly selected to attach this source,
  // but "Save all" never opts the user into that enrichment automatically.
  return independentlyEligible(row) && !row.savedPlaceId;
}

/** Select every eligible logical place once, deduped by provider identity. */
export function selectAllEligibleBatchRows(batch: MultiPlaceBatch): MultiPlaceBatch {
  const providerIds = new Set<string>();
  const rows = { ...batch.rows };
  for (const id of batch.order) {
    const row = rows[id]!;
    const candidate = rowCandidate(row);
    if (!eligibleForSaveAll(row) || !candidate || providerIds.has(candidate.googlePlaceId)) {
      rows[id] = independentlyEligible(row) ? { ...row, selectedForSave: false } : row;
      continue;
    }
    providerIds.add(candidate.googlePlaceId);
    rows[id] = { ...row, selectedForSave: true, saveError: null };
  }
  return { ...batch, rows, feedback: null };
}

/** Backward-compatible Vayrin presentation name; Multi-Select owns its semantics. */
export const selectAllResolvedBatchRows = selectAllEligibleBatchRows;

/** Clear only eligible pending selections; saved and disabled rows are untouched. */
export function clearAllEligibleBatchRows(batch: MultiPlaceBatch): MultiPlaceBatch {
  const rows = { ...batch.rows };
  for (const id of batch.order) {
    const row = rows[id]!;
    if (independentlyEligible(row)) rows[id] = { ...row, selectedForSave: false };
  }
  return { ...batch, rows, feedback: null };
}

export function allEligibleBatchTargets(batch: MultiPlaceBatch): BatchSaveTarget[] {
  return selectedBatchTargets(selectAllEligibleBatchRows(batch));
}

export function allEligibleBatchRowsSelected(batch: MultiPlaceBatch): boolean {
  const eligible = allEligibleBatchTargets(batch);
  if (eligible.length === 0) return false;
  const selected = new Set(selectedBatchTargets(batch).map((target) => target.logicalPlaceId));
  return eligible.every((target) => selected.has(target.logicalPlaceId));
}

export function duplicateSelectionOwner(batch: MultiPlaceBatch, logicalPlaceId: string): string | null {
  const target = batch.rows[logicalPlaceId];
  const candidate = target ? rowCandidate(target) : null;
  if (!target || !candidate) return null;
  for (const id of batch.order) {
    if (id === logicalPlaceId) return null;
    const row = batch.rows[id]!;
    if (row.selectedForSave && rowCandidate(row)?.googlePlaceId === candidate.googlePlaceId) return id;
  }
  return null;
}

export function applyBatchSaveOutcomes(
  batch: MultiPlaceBatch,
  outcomes: readonly SharePlaceSaveOutcome[],
): MultiPlaceBatch {
  const rows = { ...batch.rows };
  let saved = 0;
  let alreadySaved = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    const row = rows[outcome.logicalPlaceId];
    if (!row) continue;
    if (outcome.status === 'failed') {
      failed += 1;
      rows[outcome.logicalPlaceId] = { ...row, saveError: 'Could not save. Try this place again.' };
      continue;
    }
    if (outcome.status === 'saved') saved += 1;
    else alreadySaved += 1;
    rows[outcome.logicalPlaceId] = {
      ...row,
      selectedForSave: false,
      persistence: outcome.status === 'saved' ? 'saved' : 'already_saved',
      savedPlaceId: outcome.savedPlaceId,
      saveError: null,
    };
  }
  return {
    ...batch,
    rows,
    feedback: { attempted: outcomes.length, saved, alreadySaved, failed },
  };
}

export function recoverableBatchRowCount(batch: MultiPlaceBatch): number {
  return batch.order.filter((id) => {
    const row = batch.rows[id]!;
    return row.persistence === 'pending' &&
      (row.resolution === 'unmatched' || row.resolution === 'ambiguous' || row.resolution === 'unavailable' || !!row.saveError);
  }).length;
}

export function successfulBatchSavedPlaceIds(batch: MultiPlaceBatch): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of batch.order) {
    const savedPlaceId = batch.rows[id]!.savedPlaceId;
    if (!savedPlaceId || seen.has(savedPlaceId)) continue;
    seen.add(savedPlaceId);
    ids.push(savedPlaceId);
  }
  return ids;
}

export function batchCompletionSavedPlaceIds(batch: MultiPlaceBatch): {
  createdSavedPlaceIds: string[];
  duplicateSavedPlaceIds: string[];
} {
  const createdSavedPlaceIds: string[] = [];
  const duplicateSavedPlaceIds: string[] = [];
  const seen = new Set<string>();
  for (const id of batch.order) {
    const row = batch.rows[id]!;
    if (!row.savedPlaceId || seen.has(row.savedPlaceId)) continue;
    seen.add(row.savedPlaceId);
    if (row.persistence === 'saved') createdSavedPlaceIds.push(row.savedPlaceId);
    else if (row.persistence === 'already_saved') duplicateSavedPlaceIds.push(row.savedPlaceId);
  }
  return { createdSavedPlaceIds, duplicateSavedPlaceIds };
}
