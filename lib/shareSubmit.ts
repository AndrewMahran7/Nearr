/**
 * lib/shareSubmit.ts
 *
 * PURE guarded-submit primitive. Given a submission id, it guarantees:
 *   - concurrent calls with the same id share ONE in-flight promise;
 *   - an id whose submit was ACCEPTED (server ok) is never resubmitted — it
 *     returns the cached result marked `duplicate`;
 *   - a FAILED submit (ok:false or thrown) is NOT cached, so genuine retries
 *     still work.
 *
 * Used by both the host handoff and the iOS Share Extension so a single share
 * action creates at most one job regardless of double-fires, effect re-runs,
 * cold/warm deep-link re-delivery, or timeouts-after-accept.
 *
 * Dependency-free — runnable under ts-node.
 */

export type GuardedSubmitResult = {
  ok: boolean;
  jobId?: string;
  duplicate?: boolean;
  reason?: string;
};

export type GuardedSubmitArgs = { url: string; submissionId: string };
export type GuardedSubmitFn = (args: GuardedSubmitArgs) => Promise<GuardedSubmitResult>;

export type ShareSubmitter = {
  submit: (args: GuardedSubmitArgs) => Promise<GuardedSubmitResult>;
  hasAccepted: (submissionId: string) => boolean;
  reset: () => void;
};

export function createShareSubmitter(doSubmit: GuardedSubmitFn): ShareSubmitter {
  const inFlight = new Map<string, Promise<GuardedSubmitResult>>();
  const accepted = new Map<string, GuardedSubmitResult>();

  function submit(args: GuardedSubmitArgs): Promise<GuardedSubmitResult> {
    const key = args.submissionId;

    // Already accepted by the server → never resubmit; report as duplicate.
    const prior = accepted.get(key);
    if (prior) return Promise.resolve({ ...prior, duplicate: true });

    // A concurrent call with the same id shares the single in-flight promise.
    const active = inFlight.get(key);
    if (active) return active;

    const run = (async () => {
      const res = await doSubmit(args);
      if (res.ok) accepted.set(key, res);
      return res;
    })();
    // Clear the in-flight slot on settle (success OR failure) so a genuine
    // failure can be retried; success is guarded by the `accepted` cache above.
    const tracked = run.finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, tracked);
    return tracked;
  }

  return {
    submit,
    hasAccepted: (id: string) => accepted.has(id),
    reset: () => {
      inFlight.clear();
      accepted.clear();
    },
  };
}
