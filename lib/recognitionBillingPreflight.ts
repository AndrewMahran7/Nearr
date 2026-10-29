import { supabase } from './supabase';
import { fetchPlusStatus } from './plusClient';

/** Refresh stale server-verified subscription state before a user-confirmed
 * recognition save. This never opens StoreKit or treats SDK state as access.
 * Existing reservations are settled in SQL; do not reject their owner merely
 * because all free/tokens are already reserved for that very job. */
export type RecognitionBillingTarget = { jobId: string } | { resultId: string };

export async function assertRecognitionAccount(expectedUserId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== expectedUserId) throw new Error('recognition_account_changed');
}

export async function refreshRecognitionBilling(target: RecognitionBillingTarget): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (error || !user) throw new Error('recognition_account_required');
  let jobId: string;
  if ('resultId' in target) {
    const result = await supabase.from('share_job_place_results').select('share_job_id,user_id')
      .eq('id', target.resultId).eq('user_id', user.id).maybeSingle();
    if (result.error || result.data?.user_id !== user.id || typeof result.data?.share_job_id !== 'string') {
      throw new Error('recognition_job_not_owned');
    }
    jobId = result.data.share_job_id;
  } else jobId = target.jobId;
  // A stale screen may still display the previous account's job. Refreshing
  // billing for the new account must never authorize saving that old result.
  const job = await supabase.from('share_jobs').select('id,user_id')
    .eq('id', jobId).eq('user_id', user.id).maybeSingle();
  if (job.error || job.data?.id !== jobId || job.data?.user_id !== user.id) throw new Error('recognition_job_not_owned');
  await assertRecognitionAccount(user.id);
  // Anonymous accounts cannot purchase Plus; SQL still enforces free usage.
  if (!user.is_anonymous) {
    const status = await fetchPlusStatus(user.id, 'status');
    if (status.usage.verificationRequired === true) throw new Error('plus_verification_required');
  }
  await assertRecognitionAccount(user.id);
  return user.id;
}
