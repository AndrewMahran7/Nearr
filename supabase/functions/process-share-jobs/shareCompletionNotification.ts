// Pure presentation boundary for long-running share/finder completion pushes.
//
// Callers provide only bounded, structured facts. This module owns the
// evidence hierarchy, user-facing copy, lock-screen sanitization, and the
// existing navigation payload shape. Raw captions, transcripts, notes, model
// output, coordinates, and confidence percentages are intentionally absent
// from the input contract.

import {
  presentShareFailure,
  type ShareFailureCategory,
} from '../../../lib/shareFailurePresentation.ts';

export type NotificationLocalityBasis =
  | 'provider_verified'
  | 'observable_corroborated'
  | 'weak_context'
  | 'model_prior';

export type NotificationLocality = {
  label: string;
  basis: NotificationLocalityBasis;
};

export type NotificationLead = {
  name: string;
  evidenceKind: 'observable' | 'model_prior';
};

export type ShareCompletionNotificationContext = {
  jobId: string;
  status: 'completed' | 'needs_help' | 'failed';
  decision?: string | null;
  failureCategory?: ShareFailureCategory | null;
  failureCode?: string | null;
  provider?: string | null;
  analysisAttempted?: boolean | null;
  technicalFailure?: boolean;
  alreadySaved?: boolean;
  placeName?: string | null;
  candidateCount?: number;
  strongestCandidateName?: string | null;
  notificationLocality?: NotificationLocality | null;
  strongestLead?: NotificationLead | null;
  observableLeadCount?: number;
  hasWeakClues?: boolean;
  multiPlace?: {
    totalCount: number;
    savedCount: number;
    unresolvedCandidateGroupCount?: number;
  } | null;
  savedPlaceId?: string | null;
  savedPlaceIds?: string[];
  createdSavedPlaceIds?: string[];
  googlePlaceId?: string | null;
  reviewMode?: string | null;
  reviewCount?: number;
};

export type ShareCompletionNotificationResultClass =
  | 'strong_exact'
  | 'already_saved'
  | 'single_likely_candidate'
  | 'multiple_candidates'
  | 'coarse_location'
  | 'named_lead'
  | 'multi_place_complete'
  | 'multi_place_partial'
  | 'weak_clues'
  | 'no_evidence'
  | 'media_access_required'
  | 'media_too_long'
  | 'analysis_insufficient'
  | 'technical_failure';

export type ShareCompletionNotification = {
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Presentation classification; failure classes are also carried as structured data. */
  resultClass: ShareCompletionNotificationResultClass;
};

const MAX_LABEL_LENGTH = 52;
const MAX_ID_COUNT = 50;

function boundedCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
function safeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  if (compact.length <= MAX_LABEL_LENGTH) return compact;
  const shortened = compact.slice(0, MAX_LABEL_LENGTH - 1).replace(/\s+\S*$/, '').trim();
  return `${shortened || compact.slice(0, MAX_LABEL_LENGTH - 1)}\u2026`;
}

function uniqueIds(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    .slice(0, MAX_ID_COUNT);
}

function usableLocality(locality: NotificationLocality | null | undefined): string | null {
  if (!locality) return null;
  if (locality.basis !== 'provider_verified' && locality.basis !== 'observable_corroborated') {
    return null;
  }
  return safeLabel(locality.label);
}

function usableLead(lead: NotificationLead | null | undefined): string | null {
  return lead?.evidenceKind === 'observable' ? safeLabel(lead.name) : null;
}

function resultCopy(
  context: ShareCompletionNotificationContext,
): Pick<ShareCompletionNotification, 'title' | 'body' | 'resultClass'> {
  const candidateCount = boundedCount(context.candidateCount);
  const candidateName = safeLabel(context.strongestCandidateName);
  const placeName = safeLabel(context.placeName);
  const locality = usableLocality(context.notificationLocality);
  const leadName = usableLead(context.strongestLead);
  const observableLeadCount = boundedCount(context.observableLeadCount);
  const multiTotal = boundedCount(context.multiPlace?.totalCount);
  const multiSaved = Math.min(boundedCount(context.multiPlace?.savedCount), multiTotal);
  const unresolvedGroups = boundedCount(context.multiPlace?.unresolvedCandidateGroupCount);

  const hasStructuredFailure =
    !!context.failureCategory ||
    !!context.failureCode ||
    context.analysisAttempted === true ||
    context.technicalFailure === true;
  const hasUsefulResult = candidateCount > 0 || multiTotal > 0 || !!locality || !!leadName || observableLeadCount > 0;
  if (hasStructuredFailure && !hasUsefulResult) {
    const failure = presentShareFailure({
      failureCategory: context.technicalFailure ? 'technical_failure' : context.failureCategory,
      failureCode: context.failureCode,
      provider: context.provider,
      analysisAttempted: context.analysisAttempted,
      status: context.status,
    });
    return {
      title: failure.title,
      body: failure.body,
      resultClass: failure.category,
    };
  }

  // Multi-place is explicit structured state. Candidate ambiguity for one
  // scene never reaches this branch merely because it has several candidates.
  if (multiTotal > 1) {
    if (multiSaved >= multiTotal) {
      if (context.alreadySaved) {
        return {
          title: 'Places already saved',
          body: `All ${multiTotal} places are already on your map.`,
          resultClass: 'already_saved',
        };
      }
      return {
        title: `We found all ${multiTotal} places`,
        body: 'They\u2019re ready on your map.',
        resultClass: 'multi_place_complete',
      };
    }
    if (multiSaved > 0) {
      return {
        title: `We found ${multiSaved} of ${multiTotal} places`,
        body: unresolvedGroups > 0
          ? 'We also found possible matches for the rest.'
          : 'Take a look at what we found.',
        resultClass: 'multi_place_partial',
      };
    }
    if (unresolvedGroups > 0) {
      return {
        title: `We found possible matches for ${multiTotal} places`,
        body: 'Take a look and choose what matches.',
        resultClass: 'multi_place_partial',
      };
    }
    if (observableLeadCount > 0) {
      return {
        title: 'We found a few leads in this video',
        body: 'Take a look at what we found.',
        resultClass: 'weak_clues',
      };
    }
  }

  if (context.status === 'completed' && context.alreadySaved) {
    return {
      title: 'Already saved',
      body: placeName ? `${placeName} is already in Nearr.` : 'This place is already in Nearr.',
      resultClass: 'already_saved',
    };
  }

  if (context.status === 'completed' && (context.savedPlaceId || context.savedPlaceIds?.length)) {
    return {
      title: 'Found it',
      body: placeName ? `${placeName} is saved to your map.` : 'It\u2019s saved to your map.',
      resultClass: 'strong_exact',
    };
  }

  if (candidateCount === 1) {
    return {
      title: 'Possible place found',
      body: candidateName
        ? `Open Nearr to check ${candidateName}.`
        : 'Open Nearr to see if it matches.',
      resultClass: 'single_likely_candidate',
    };
  }

  if (candidateCount > 1) {
    if (candidateCount === 2) {
      return {
        title: 'We found 2 possible spots',
        body: 'Which one looks right?',
        resultClass: 'multiple_candidates',
      };
    }
    if (candidateCount <= 5) {
      return {
        title: `We found ${candidateCount} possible spots`,
        body: 'Take a look and choose the best match.',
        resultClass: 'multiple_candidates',
      };
    }
    return {
      title: 'We found several possible spots',
      body: 'Take a look and choose the best match.',
      resultClass: 'multiple_candidates',
    };
  }

  if (locality) {
    return {
      title: 'We narrowed it down',
      body: `We think this is near ${locality}, but couldn\u2019t pin down the exact spot.`,
      resultClass: 'coarse_location',
    };
  }

  if (leadName) {
    return {
      title: 'Place clue found',
      body: 'Open Nearr to search for the exact place.',
      resultClass: 'named_lead',
    };
  }

  if (context.hasWeakClues || observableLeadCount > 0) {
    return {
      title: 'We found a few clues',
      body: 'They weren\u2019t enough to pin down the exact spot.',
      resultClass: 'weak_clues',
    };
  }

  return {
    title: 'We couldn\u2019t pin this one down',
    body: 'Open Nearr to search manually.',
    resultClass: 'no_evidence',
  };
}

function notificationData(
  context: ShareCompletionNotificationContext,
  resultClass: ShareCompletionNotificationResultClass,
): Record<string, unknown> {
  const savedPlaceIds = uniqueIds(context.savedPlaceIds);
  const createdSavedPlaceIds = uniqueIds(context.createdSavedPlaceIds);
  const completed =
    resultClass === 'strong_exact' ||
    resultClass === 'already_saved' ||
    resultClass === 'multi_place_complete';
  const outcome = resultClass === 'already_saved'
    ? 'already_saved'
    : resultClass === 'multi_place_partial'
    ? 'mixed'
    : completed
    ? 'completed'
    : null;
  const failureCategory = resultClass === 'media_access_required' ||
      resultClass === 'media_too_long' ||
      resultClass === 'analysis_insufficient' ||
      resultClass === 'technical_failure'
    ? resultClass
    : null;
  const provider = safeLabel(context.provider)?.toLowerCase() ?? null;

  return {
    type: completed ? 'share_job_completed' : 'share_job_needs_help',
    ...(outcome ? { outcome } : {}),
    jobId: context.jobId,
    ...(failureCategory ? { failureCategory } : {}),
    ...(failureCategory && context.failureCode ? { failureCode: context.failureCode } : {}),
    ...(failureCategory && provider ? { provider } : {}),
    ...(failureCategory && typeof context.analysisAttempted === 'boolean'
      ? { analysisAttempted: context.analysisAttempted }
      : {}),
    ...(context.savedPlaceId ? { savedPlaceId: context.savedPlaceId } : {}),
    ...(savedPlaceIds.length ? { savedPlaceIds } : {}),
    ...(createdSavedPlaceIds.length ? { createdSavedPlaceIds } : {}),
    ...(context.googlePlaceId ? { googlePlaceId: context.googlePlaceId } : {}),
    ...(context.reviewMode ? { reviewMode: context.reviewMode } : {}),
    ...(boundedCount(context.candidateCount) > 0
      ? { candidateCount: boundedCount(context.candidateCount) }
      : {}),
    ...(boundedCount(context.reviewCount) > 0
      ? { reviewCount: boundedCount(context.reviewCount) }
      : {}),
  };
}

/**
 * Strongest-truthful-result hierarchy: structured multi-place, verified/saved
 * exact place, one likely candidate, candidate set, trusted coarse locality,
 * observable named lead, weak clues, then zero evidence. A real technical
 * failure remains categorically distinct and cannot masquerade as progress.
 */
export function composeShareCompletionNotification(
  context: ShareCompletionNotificationContext,
): ShareCompletionNotification {
  const copy = resultCopy(context);
  return {
    ...copy,
    data: notificationData(context, copy.resultClass),
  };
}
