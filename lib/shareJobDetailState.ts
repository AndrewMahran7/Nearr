/**
 * lib/shareJobDetailState.ts
 *
 * PURE (no React Native, no I/O) mapping from a persisted `share_jobs` row to
 * the state the per-job detail screen renders. This is the COMPATIBILITY
 * BOUNDARY between the deployed backend and the client: every payload-shape
 * question is answered here, once, so the screen itself performs no
 * transformation that could throw and no branch can silently discard data the
 * resolver already persisted.
 *
 * Why this exists:
 *   1. The metadata resolver now parks candidates on the job BEFORE media
 *      fallback runs (`parkPatch.candidate_payload`). If the media task later
 *      fails, `status`/`decision` can say "failed"/"manual_fallback" while the
 *      row still holds perfectly good candidates. Keying the view off status or
 *      decision alone threw those candidates away and dropped the user into an
 *      empty manual search.
 *   2. Payload shape has drifted across releases (bare array, `{candidates}`,
 *      `{options}`, `{candidate}`, snake_case keys, v2 `{version, candidates,
 *      mentionSlots}`). Normalisation is centralised in shareJobsUi /
 *      shareJobResult; this module decides what to DO with the result.
 *
 * PERSISTED CANDIDATE DATA IS AUTHORITATIVE. `status` and `decision` choose
 * between review styles; they never decide whether candidates exist.
 *
 * Unit-tested from Node (scripts/testShareJobDetailState.ts).
 */

import { classifyShareJobDetail } from './shareJobRouting';
import {
  normalizeShareJobCandidates,
  quickCheckReviewCopy,
  type NormalizedCandidate,
} from './shareJobsUi';
import {
  evidenceFramesFromPayload,
  normalizeMentionSlots,
  partialResultFromPayload,
  savedPlaceIdsFromPayload,
  type ShareJobEvidenceFrame,
  type ShareJobMentionSlot,
  type ShareJobPartialResult,
} from './shareJobResult';
import {
  selectionModeForPlaceResult,
  type SelectionMode,
} from './placeSelection';
import {
  presentShareFailure,
  type ShareFailureCategory,
} from './shareFailurePresentation';

/**
 * What the detail screen should render.
 *   missing    — no readable job (deleted, another user, load failed)
 *   processing — still being worked; lightweight status, no controls
 *   completed  — terminal success; offer the existing saved place
 *   dismissed  — cancelled / unknown terminal; control-free notice
 *   multi      — several logical places from one post, reviewed together
 *   picker     — one logical place, several candidate matches
 *   confirm    — one candidate that needs a quick human check
 *   manual     — nothing usable persisted; the user searches
 */
export type ShareJobDetailKind =
  | 'missing'
  | 'processing'
  | 'completed'
  | 'dismissed'
  | 'multi'
  | 'picker'
  | 'confirm'
  | 'manual';

export type ShareJobDetailCopy = { title: string; body: string };

/**
 * Why a state was chosen. Low-cardinality developer diagnostics ONLY — never
 * rendered, never contains user content or provider payloads.
 */
export type ShareJobDetailReason =
  | 'no_job'
  | 'invalid_status'
  | 'purchase_required'
  | 'processing'
  | 'completed'
  | 'dismissed'
  | 'multi_decision'
  | 'multi_slots'
  | 'candidates_multiple'
  | 'candidates_single'
  | ShareFailureCategory
  | 'area_match'
  | 'search_lead'
  | 'partial_result'
  | 'no_candidates';

/** Loose structural input so this works with `ShareJob` and with a raw row. */
export type ShareJobDetailInput = {
  id?: string | null;
  status?: string | null;
  decision?: string | null;
  saved_place_id?: string | null;
  candidate_payload?: unknown;
  extraction_payload?: unknown;
  suggested_query?: string | null;
  needs_help_reason?: string | null;
  failure_reason?: string | null;
  failure_category?: string | null;
  failure_code?: string | null;
  analysis_attempted?: boolean | null;
  source_platform?: string | null;
};

export type ShareJobDetailState = {
  kind: ShareJobDetailKind;
  selectionMode: SelectionMode;
  /** Every candidate the row can still offer, in persisted order. */
  candidates: NormalizedCandidate[];
  /** Multi-place review slots; empty for single-place jobs. */
  mentionSlots: ShareJobMentionSlot[];
  /** Bounded private frames that were actually analyzed for this result. */
  evidenceFrames: ShareJobEvidenceFrame[];
  partialResult: ShareJobPartialResult | null;
  /** Places this job already saved automatically. */
  savedPlaceIds: string[];
  savedPlaceId: string | null;
  savedPlaceName: string | null;
  alreadySaved: boolean;
  suggestedQuery: string | null;
  /** True only for a recoverable failure that has not already saved a place. */
  canRetry: boolean;
  /** Manual search is useful for access/policy/insufficient states, not runtime failures. */
  canSearchManually: boolean;
  failureCategory: ShareFailureCategory | null;
  copy: ShareJobDetailCopy;
  reason: ShareJobDetailReason;
};

/** Consumer-facing copy. No internal vocabulary ever reaches these strings. */
export const SHARE_JOB_DETAIL_COPY = {
  confirm: {
    title: 'We think we found it',
    body: 'Give us a quick check before we save it.',
  },
  manual: {
    title: "We couldn't pin this one down",
    body: 'Open Nearr to search manually.',
  },
  areaMatch: {
    title: 'We narrowed down the area',
    body: 'Use this area to check the place before saving it.',
  },
  searchLead: {
    title: 'We found a useful lead',
    body: 'Search this lead and confirm the place you meant.',
  },
  partialResult: {
    title: 'We found a few useful clues',
    body: 'Use these clues to continue the search in Nearr.',
  },
  multi: {
    body: 'Pick the ones you meant and we’ll save them together.',
  },
  picker: {
    body: 'Pick the one you meant and we’ll save it.',
  },
  processing: {
    title: 'Still checking this post',
    body: 'We’ll let you know the moment it’s ready.',
  },
  completed: {
    title: 'Saved to your map',
    body: 'This place is ready on your map.',
  },
  alreadySaved: {
    title: 'You already saved this place',
    body: "It's ready on your map.",
  },
  dismissed: {
    title: 'This item is no longer in your queue',
    body: 'Nothing else is needed here.',
  },
  missing: {
    title: 'This save is no longer available',
    body: 'It may have been removed from your queue.',
  },
} as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Every candidate the row can still offer. Prefers the top-level candidate
 * array (what the metadata resolver parks) and falls back to the candidates
 * carried inside multi-place review slots, so a job is never treated as
 * candidate-less while usable data is persisted anywhere in the payload.
 */
function collectCandidates(
  payload: unknown,
  slots: ShareJobMentionSlot[],
): NormalizedCandidate[] {
  const direct = normalizeShareJobCandidates(payload);
  if (direct.length > 0) return direct;
  const fromSlots = slots.flatMap((slot) => slot.candidates);
  return normalizeShareJobCandidates(fromSlots);
}

function pluralPlaces(count: number): string {
  return `${count} possible ${count === 1 ? 'place' : 'places'}`;
}

/**
 * Map a persisted job to its detail-screen state. NEVER throws: any malformed
 * or unknown payload degrades to a safe, renderable state.
 */
export function buildShareJobDetailState(
  job: ShareJobDetailInput | null | undefined,
): ShareJobDetailState {
  const empty: ShareJobDetailState = {
    kind: 'missing',
    selectionMode: 'single_identity',
    candidates: [],
    mentionSlots: [],
    evidenceFrames: [],
    partialResult: null,
    savedPlaceIds: [],
    savedPlaceId: null,
    savedPlaceName: null,
    alreadySaved: false,
    suggestedQuery: null,
    canRetry: false,
    canSearchManually: false,
    failureCategory: null,
    copy: SHARE_JOB_DETAIL_COPY.missing,
    reason: 'no_job',
  };

  if (!job) return empty;
  if (typeof job.status !== 'string' || !job.status) {
    return { ...empty, reason: 'invalid_status' };
  }

  // Normalisation is total — each helper drops anything unusable rather than
  // throwing — so a malformed payload lands on `manual`, never on an error.
  const candidatePayload = record(job.candidate_payload);
  const mentionSlots = normalizeMentionSlots(candidatePayload?.mentionSlots);
  const evidenceFrames = evidenceFramesFromPayload(candidatePayload);
  const partialResult = partialResultFromPayload(candidatePayload);
  const candidates = collectCandidates(job.candidate_payload, mentionSlots);
  const savedPlaceIds = savedPlaceIdsFromPayload(job.candidate_payload);
  const extraction = record(job.extraction_payload);
  const savedPlaceId = text(job.saved_place_id);
  const suggestedQuery = text(job.suggested_query) ?? candidates[0]?.name ?? partialResult?.searchQuery ?? null;
  const selectionMode = selectionModeForPlaceResult({
    explicitMode: candidatePayload?.selectionMode,
    decision: job.decision,
    mentionSlots,
    diagnostics: record(job.extraction_payload)?.diagnostics,
  });

  const base = {
    selectionMode,
    candidates,
    mentionSlots,
    evidenceFrames,
    partialResult,
    savedPlaceIds,
    savedPlaceId,
    savedPlaceName: text(extraction?.savedPlaceName),
    alreadySaved: extraction?.alreadySaved === true,
    suggestedQuery,
    canRetry: false,
    canSearchManually: false,
    failureCategory: null,
  };

  switch (classifyShareJobDetail({ status: job.status })) {
    case 'purchase_required':
      return {
        ...base,
        kind: 'dismissed',
        copy: {
          title: 'This post is waiting',
          body: 'Choose a token pack to continue.',
        },
        reason: 'purchase_required',
      };
    case 'processing':
      return {
        ...base,
        kind: 'processing',
        copy: SHARE_JOB_DETAIL_COPY.processing,
        reason: 'processing',
      };

    case 'completed':
      return {
        ...base,
        kind: 'completed',
        copy: base.alreadySaved
          ? SHARE_JOB_DETAIL_COPY.alreadySaved
          : SHARE_JOB_DETAIL_COPY.completed,
        reason: 'completed',
      };

    case 'dismissed':
      return {
        ...base,
        kind: 'dismissed',
        copy: SHARE_JOB_DETAIL_COPY.dismissed,
        reason: 'dismissed',
      };

    case 'missing':
      return empty;

    case 'actionable':
    default:
      break;
  }

  // `failed` stays recoverable, but ONLY when nothing was saved from it — a
  // retry must never be able to double-save.
  const failure = presentShareFailure({
    failureCategory: job.failure_category,
    failureCode: text(job.failure_code) ?? text(job.failure_reason),
    provider: job.source_platform,
    analysisAttempted: job.analysis_attempted,
    status: job.status,
  });
  const canRetry = job.status === 'failed' && !savedPlaceId && failure.retryable;

  // Several logical places from one post are reviewed together. The decision
  // column is the primary signal; the persisted slots are the fallback so a row
  // written before that column existed still opens the grouped review.
  if (selectionMode === 'multi_independent') {
    const count = mentionSlots.length || candidates.length;
    return {
      ...base,
      canRetry,
      canSearchManually: true,
      failureCategory: null,
      kind: 'multi',
      copy: {
        title: `We found ${count} ${count === 1 ? 'place' : 'places'}`,
        body: SHARE_JOB_DETAIL_COPY.multi.body,
      },
      reason: job.decision === 'multi_candidate_confirmation' ? 'multi_decision' : 'multi_slots',
    };
  }

  // From here the ONLY thing that decides the review style is how many
  // candidates the row actually holds. `status: failed` and
  // `decision: manual_fallback` deliberately do NOT force manual search —
  // media fallback can fail long after good metadata candidates were parked.
  if (candidates.length > 1) {
    return {
      ...base,
      canRetry,
      canSearchManually: true,
      failureCategory: null,
      kind: 'picker',
      copy: {
        title: `We found ${pluralPlaces(candidates.length)}`,
        body: SHARE_JOB_DETAIL_COPY.picker.body,
      },
      reason: 'candidates_multiple',
    };
  }

  if (candidates.length === 1) {
    return {
      ...base,
      canRetry,
      canSearchManually: true,
      failureCategory: null,
      kind: 'confirm',
      // A known backend contradiction (closed, address conflict, …) gets its
      // own honest wording instead of an unqualified "we found it".
      copy: quickCheckReviewCopy(job.needs_help_reason, SHARE_JOB_DETAIL_COPY.confirm),
      reason: 'candidates_single',
    };
  }

  if (partialResult) {
    const copy = partialResult.resultClass === 'area_match'
      ? SHARE_JOB_DETAIL_COPY.areaMatch
      : partialResult.resultClass === 'search_lead'
        ? SHARE_JOB_DETAIL_COPY.searchLead
        : SHARE_JOB_DETAIL_COPY.partialResult;
    return {
      ...base,
      canRetry: false,
      canSearchManually: true,
      failureCategory: null,
      kind: 'manual',
      copy,
      reason: partialResult.resultClass,
    };
  }

  return {
    ...base,
    canRetry,
    canSearchManually: failure.actions.includes('manual_search'),
    failureCategory: failure.category,
    kind: 'manual',
    copy: { title: failure.title, body: failure.body },
    reason: failure.category,
  };
}
