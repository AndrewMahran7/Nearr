export type ShareJobsRealtimeStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR';

type PostgresChangesFilter = {
  event: '*';
  schema: 'public';
  table: 'share_jobs';
  filter: string;
};

export type ShareJobsRealtimeChannel = {
  on(
    type: 'postgres_changes',
    filter: PostgresChangesFilter,
    callback: () => void,
  ): ShareJobsRealtimeChannel;
  subscribe(callback?: (status: ShareJobsRealtimeStatus, error?: Error) => void): ShareJobsRealtimeChannel;
};

export type ShareJobsRealtimeClient = {
  channel(name: string): ShareJobsRealtimeChannel;
  removeChannel(channel: ShareJobsRealtimeChannel): Promise<unknown> | unknown;
};

type SubscriptionOptions = {
  client: ShareJobsRealtimeClient;
  scope: 'share_jobs' | 'share_jobs_badge';
  userId: string;
  onInvalidate: () => void;
  onStatus?: (status: ShareJobsRealtimeStatus, error?: Error) => void;
  onError?: (error: unknown) => void;
  coalesceMs?: number;
};

let lifecycleSequence = 0;

export function createShareJobsRealtimeSubscription({
  client,
  scope,
  userId,
  onInvalidate,
  onStatus,
  onError,
  coalesceMs = 120,
}: SubscriptionOptions): () => void {
  let cancelled = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: ShareJobsRealtimeChannel | null = null;

  const invalidate = () => {
    if (cancelled || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!cancelled) onInvalidate();
    }, coalesceMs);
  };

  try {
    const lifecycleId = `${Date.now().toString(36)}:${++lifecycleSequence}`;
    channel = client.channel(`${scope}:${userId}:${lifecycleId}`);
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'share_jobs',
        filter: `user_id=eq.${userId}`,
      },
      invalidate,
    );
    channel.subscribe((status, error) => {
      if (cancelled) return;
      onStatus?.(status, error);
      if (status === 'SUBSCRIBED') invalidate();
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && error) onError?.(error);
    });
  } catch (error) {
    onError?.(error);
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (channel) {
      try {
        void Promise.resolve(client.removeChannel(channel)).catch((error) => onError?.(error));
      } catch (error) {
        onError?.(error);
      }
    }
  };
}