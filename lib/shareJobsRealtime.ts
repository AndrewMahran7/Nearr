export type ShareJobsRealtimeStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR';

/** Tables this helper is allowed to watch. Every one is RLS-scoped by user_id. */
export type ShareJobsRealtimeTable = 'share_jobs' | 'share_job_place_results';

/** The only part of a postgres_changes payload callers may inspect. */
export type ShareJobsRealtimeChange = { new?: Record<string, unknown> | null };

type PostgresChangesFilter = {
  event: '*';
  schema: 'public';
  table: ShareJobsRealtimeTable;
  filter: string;
};

export type ShareJobsRealtimeChannel = {
  on(
    type: 'postgres_changes',
    filter: PostgresChangesFilter,
    callback: (payload: ShareJobsRealtimeChange) => void,
  ): ShareJobsRealtimeChannel;
  subscribe(callback?: (status: ShareJobsRealtimeStatus, error?: Error) => void): ShareJobsRealtimeChannel;
};

export type ShareJobsRealtimeClient = {
  channel(name: string): ShareJobsRealtimeChannel;
  removeChannel(channel: ShareJobsRealtimeChannel): Promise<unknown> | unknown;
};

type SubscriptionOptions = {
  client: ShareJobsRealtimeClient;
  scope:
    | 'share_jobs'
    | 'share_jobs_badge'
    | 'saved_place_enrichment'
    | 'saved_place_share_completion';
  /** Defaults to `share_jobs` so existing callers are unchanged. */
  table?: ShareJobsRealtimeTable;
  userId: string;
  onInvalidate: () => void;
  /** Drop changes that can't affect the caller before any refetch is scheduled. */
  shouldInvalidate?: (payload: ShareJobsRealtimeChange) => boolean;
  onStatus?: (status: ShareJobsRealtimeStatus, error?: Error) => void;
  onError?: (error: unknown) => void;
  coalesceMs?: number;
};

let lifecycleSequence = 0;

export function createShareJobsRealtimeSubscription({
  client,
  scope,
  table = 'share_jobs',
  userId,
  onInvalidate,
  shouldInvalidate,
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
    // The topic MUST be unique per subscription lifecycle. supabase-js returns
    // the EXISTING channel instance for a duplicate topic, and binding a
    // `postgres_changes` callback on an already joined/joining channel THROWS
    // ("cannot add `postgres_changes` callbacks ... after `subscribe()`"). Two
    // screens subscribing to the same scope at once would otherwise crash the
    // second one into its route error boundary.
    const lifecycleId = `${Date.now().toString(36)}:${++lifecycleSequence}`;
    channel = client.channel(`${scope}:${userId}:${lifecycleId}`);
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (shouldInvalidate && !shouldInvalidate(payload)) return;
        invalidate();
      },
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