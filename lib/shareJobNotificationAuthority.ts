export type ShareJobNotificationAuthorityInput = {
  id?: unknown;
  status?: unknown;
  notification_status?: unknown;
  notification_payload?: unknown;
  user_id?: unknown;
};

export type AuthoritativeShareJobNotification = {
  jobId: string;
  userId: string;
  payload: { title: string; body: string; data: Record<string, unknown> };
};

const TERMINAL_SHARE_JOB_STATUSES = new Set(['completed', 'needs_help', 'failed']);

/** Validate the persisted row after an atomic notification claim. */
export function authoritativeShareJobNotification(
  row: ShareJobNotificationAuthorityInput | null | undefined,
): AuthoritativeShareJobNotification | null {
  if (!row || typeof row.id !== 'string' || typeof row.user_id !== 'string') return null;
  if (!TERMINAL_SHARE_JOB_STATUSES.has(String(row.status ?? ''))) return null;
  if (row.notification_status !== 'sending') return null;

  const raw = row.notification_payload;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  if (typeof payload.title !== 'string' || typeof payload.body !== 'string') return null;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if ((data as Record<string, unknown>).jobId !== row.id) return null;
  const expectedType = row.status === 'completed' ? 'share_job_completed' : 'share_job_needs_help';
  if ((data as Record<string, unknown>).type !== expectedType) return null;

  return {
    jobId: row.id,
    userId: row.user_id,
    payload: {
      title: payload.title,
      body: payload.body,
      data: data as Record<string, unknown>,
    },
  };
}
