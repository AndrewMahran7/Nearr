export type ActionableShareJobStatus = 'completed' | 'needs_help' | 'failed';

/** Stable per job and actionable state; 41 ASCII bytes, below APNs' 64-byte cap. */
export function shareJobNotificationLogicalId(
  jobId: string,
  status: ActionableShareJobStatus,
): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error('invalid_share_job_notification_id');
  }
  const code = status === 'completed' ? 'c' : status === 'needs_help' ? 'h' : 'f';
  return `n1:${jobId.toLowerCase()}:${code}`;
}
