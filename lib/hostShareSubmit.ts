/**
 * lib/hostShareSubmit.ts
 *
 * Host-app SINGLETON guarded share submitter. A single share action (identified
 * by a stable submission id) creates at most one job even when the cold-start
 * AND warm-start deep-link listeners both process the same URL, the handoff
 * screen remounts, the user taps retry, or the request times out AFTER the
 * server already accepted it (the retry reuses the id and the server returns the
 * existing job). Being module-level, it dedupes ACROSS component instances in
 * the host process, but only inside the same authenticated account.
 *
 * Host-only (imports supabase) — do NOT import from the Share Extension target.
 */
import { supabase } from './supabase';
import { resolveCreateShareJobUrl } from './featureFlags';
import { createShareJob } from './shareJobClient';
import { reconcileDurableShareAcceptance } from './shareHandoffAcceptance';
import { createShareSubmitter, type GuardedSubmitArgs, type GuardedSubmitResult, type ShareSubmitter } from './shareSubmit';
import { sharedAuth } from './sharedAuth';

const DURABLE_RECONCILIATION_TIMEOUT_MS = 2_500;
const submittersByAccount = new Map<string, ShareSubmitter>();

async function currentActor() {
  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session?.user.id || !session.access_token) return null;
    return { userId: session.user.id, token: session.access_token };
  } catch {
    return null;
  }
}

async function actorStillMatches(expectedUserId: string): Promise<boolean> {
  return (await currentActor())?.userId === expectedUserId;
}

async function findDurableShareJob(clientRequestId: string, expectedUserId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DURABLE_RECONCILIATION_TIMEOUT_MS);
  try {
    if (!await actorStillMatches(expectedUserId)) return null;
    const { data, error } = await supabase
      .from('share_jobs')
      .select('id,status')
      .eq('idempotency_key', clientRequestId)
      .eq('user_id', expectedUserId)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (!await actorStillMatches(expectedUserId)) return null;
    if (error || !data || typeof data.id !== 'string') return null;
    return { id: data.id, status: typeof data.status === 'string' ? data.status : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function accountSubmitter(expectedUserId: string): ShareSubmitter {
  return createShareSubmitter(
  async ({ url, submissionId }): Promise<GuardedSubmitResult> => {
    const endpoint = resolveCreateShareJobUrl();
    if (!endpoint) return { ok: false, reason: 'no_endpoint' };
    const actor = await currentActor();
    if (!actor) return { ok: false, reason: 'missing_auth' };
    if (actor.userId !== expectedUserId) return { ok: false, reason: 'account_changed' };
    sharedAuth.recordShareTrace(submissionId, 'create_share_job_fetch_started', 'host');
    const requestResult = await createShareJob({
      endpoint,
      url,
      accessToken: actor.token,
      clientRequestId: submissionId,
      submissionPath: 'host_app',
    });
    if (!await actorStillMatches(expectedUserId)) return { ok: false, reason: 'account_changed' };
    const result = await reconcileDurableShareAcceptance({
      result: requestResult,
      clientRequestId: submissionId,
      findByClientRequestId: id => findDurableShareJob(id, expectedUserId),
    });
    if (!await actorStillMatches(expectedUserId)) return { ok: false, reason: 'account_changed' };
    if (!requestResult.ok && result.ok) {
      console.log(`[share-job] durable_ack_reconciled=true reason=${requestResult.reason}`);
    }
    if (result.ok) {
      return {
        ok: true,
        jobId: result.jobId,
        duplicate: result.duplicate,
        requiresPurchase: result.requiresPurchase,
        availableUses: result.availableUses,
      };
    }
    return {
      ok: false,
      reason: result.reason,
      httpStatus: result.httpStatus,
      responseErrorCode: result.responseErrorCode,
      requestId: result.requestId,
    };
  },
  );
}

export const hostShareSubmitter = {
  async submit(args: GuardedSubmitArgs): Promise<GuardedSubmitResult> {
    // Resolve identity before consulting accepted or in-flight caches. The
    // server still receives the original SID; account scope is local only.
    const actor = await currentActor();
    if (!actor) return { ok: false, reason: 'missing_auth' };
    let submitter = submittersByAccount.get(actor.userId);
    if (!submitter) {
      submitter = accountSubmitter(actor.userId);
      submittersByAccount.set(actor.userId, submitter);
    }
    const result = await submitter.submit(args);
    // This also guards cache hits, which skip the network callback above.
    if (!await actorStillMatches(actor.userId)) return { ok: false, reason: 'account_changed' };
    return result;
  },
  async hasAccepted(submissionId: string): Promise<boolean> {
    const actor = await currentActor();
    if (!actor) return false;
    const accepted = submittersByAccount.get(actor.userId)?.hasAccepted(submissionId) ?? false;
    return await actorStillMatches(actor.userId) && accepted;
  },
  reset() {
    submittersByAccount.clear();
  },
};
