/**
 * lib/hostShareSubmit.ts
 *
 * Host-app SINGLETON guarded share submitter. A single share action (identified
 * by a stable submission id) creates at most one job even when the cold-start
 * AND warm-start deep-link listeners both process the same URL, the handoff
 * screen remounts, the user taps retry, or the request times out AFTER the
 * server already accepted it (the retry reuses the id and the server returns the
 * existing job). Being module-level, it dedupes ACROSS component instances in
 * the host process.
 *
 * Host-only (imports supabase) — do NOT import from the Share Extension target.
 */
import { supabase } from './supabase';
import { resolveCreateShareJobUrl } from './featureFlags';
import { createShareJob } from './shareJobClient';
import { createShareSubmitter, type GuardedSubmitResult } from './shareSubmit';

export const hostShareSubmitter = createShareSubmitter(
  async ({ url, submissionId }): Promise<GuardedSubmitResult> => {
    const endpoint = resolveCreateShareJobUrl();
    if (!endpoint) return { ok: false, reason: 'no_endpoint' };
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    if (!token) return { ok: false, reason: 'missing_auth' };
    const result = await createShareJob({
      endpoint,
      url,
      accessToken: token,
      clientRequestId: submissionId,
    });
    if (result.ok) {
      return { ok: true, jobId: result.jobId, duplicate: result.duplicate };
    }
    return { ok: false, reason: result.reason };
  },
);
