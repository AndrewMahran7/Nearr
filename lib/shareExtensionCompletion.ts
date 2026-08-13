/**
 * Pure completion-state and single-shot action helpers for the iOS share
 * extension. Keeping these outside React makes the user-visible behavior
 * executable in focused tests without booting the host app or Phase 2.
 */

import { SHARE_COMPLETION_COPY, acceptedBody } from './shareCompletionUi';

export type ShareExtensionCompletionState =
  | { kind: 'submitting' }
  | { kind: 'accepted'; duplicate: boolean }
  | { kind: 'submission_failure' };

export type ShareExtensionCompletionView = {
  title: string;
  body: string;
  primary: string;
  secondary: string | null;
  showsConfirmationMark: boolean;
};

/** The exact content rendered for the three completion-related states. */
export function completionView(
  state: ShareExtensionCompletionState,
): ShareExtensionCompletionView {
  if (state.kind === 'accepted') {
    return {
      title: SHARE_COMPLETION_COPY.acceptedTitle,
      body: acceptedBody(state.duplicate),
      primary: SHARE_COMPLETION_COPY.primary,
      secondary: SHARE_COMPLETION_COPY.secondary,
      showsConfirmationMark: true,
    };
  }
  if (state.kind === 'submission_failure') {
    return {
      title: SHARE_COMPLETION_COPY.failureTitle,
      body: SHARE_COMPLETION_COPY.failureBody,
      primary: SHARE_COMPLETION_COPY.retry,
      secondary: SHARE_COMPLETION_COPY.cancel,
      showsConfirmationMark: false,
    };
  }
  return {
    title: SHARE_COMPLETION_COPY.submittingTitle,
    body: SHARE_COMPLETION_COPY.submittingBody,
    primary: SHARE_COMPLETION_COPY.cancel,
    secondary: null,
    showsConfirmationMark: false,
  };
}

export type CompletionActions = {
  done: () => boolean;
  openNearr: (path: string) => boolean;
  isConsumed: () => boolean;
};

/**
 * Done and Open Nearr are mutually exclusive, single-shot terminal actions.
 * The latch is consumed before native work begins, so rapid repeated taps and
 * synchronous native exceptions cannot emit a second completion/open event.
 */
export function createCompletionActions(args: {
  close: () => void;
  openHostApp: (path: string) => void;
}): CompletionActions {
  let consumed = false;
  const consume = (action: () => void): boolean => {
    if (consumed) return false;
    consumed = true;
    action();
    return true;
  };
  return {
    done: () => consume(args.close),
    openNearr: (path) => consume(() => args.openHostApp(path)),
    isConsumed: () => consumed,
  };
}

export type SubmissionGate<T> = {
  run: () => Promise<T>;
  isSubmitting: () => boolean;
};

/**
 * Collapse concurrent submit/retry taps onto one request. A completed failure
 * may be retried, while the caller's stable clientRequestId keeps any accepted
 * server-side retry idempotent.
 */
export function createSubmissionGate<T>(submit: () => Promise<T>): SubmissionGate<T> {
  let inFlight: Promise<T> | null = null;
  return {
    run: () => {
      if (inFlight) return inFlight;
      const request = Promise.resolve().then(submit);
      const wrapped = request.finally(() => {
        if (inFlight === wrapped) inFlight = null;
      });
      inFlight = wrapped;
      return wrapped;
    },
    isSubmitting: () => inFlight !== null,
  };
}
