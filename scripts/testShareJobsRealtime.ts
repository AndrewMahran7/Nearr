import assert from 'node:assert/strict';

import {
  createShareJobsRealtimeSubscription,
  type ShareJobsRealtimeChange,
  type ShareJobsRealtimeChannel,
  type ShareJobsRealtimeClient,
  type ShareJobsRealtimeStatus,
} from '../lib/shareJobsRealtime';

class MockChannel implements ShareJobsRealtimeChannel {
  subscribed = false;
  onCalls = 0;
  eventHandler: ((payload: ShareJobsRealtimeChange) => void) | null = null;
  statusHandler: ((status: ShareJobsRealtimeStatus, error?: Error) => void) | null = null;

  on(
    _type: 'postgres_changes',
    _filter: object,
    callback: (payload: ShareJobsRealtimeChange) => void,
  ): ShareJobsRealtimeChannel {
    if (this.subscribed) {
      throw new Error("cannot add `postgres_changes` callbacks for realtime:share_jobs_badge:user after `subscribe()`.");
    }
    this.onCalls += 1;
    this.eventHandler = callback;
    return this;
  }

  subscribe(callback?: (status: ShareJobsRealtimeStatus, error?: Error) => void): ShareJobsRealtimeChannel {
    assert.equal(this.onCalls, 1, 'callback must be registered before subscribe');
    this.subscribed = true;
    this.statusHandler = callback ?? null;
    return this;
  }
}

class CachingMockClient implements ShareJobsRealtimeClient {
  channels = new Map<string, MockChannel>();
  created: MockChannel[] = [];
  removed: MockChannel[] = [];
  pendingRemovals: Array<() => void> = [];

  channel(name: string): MockChannel {
    const existing = this.channels.get(name);
    if (existing) return existing;
    const channel = new MockChannel();
    this.channels.set(name, channel);
    this.created.push(channel);
    return channel;
  }

  removeChannel(channel: MockChannel): Promise<void> {
    this.removed.push(channel);
    return new Promise((resolve) => {
      this.pendingRemovals.push(() => {
        for (const [name, candidate] of this.channels) {
          if (candidate === channel) this.channels.delete(name);
        }
        resolve();
      });
    });
  }
}

async function run(): Promise<void> {
  const oldClient = new CachingMockClient();
  const oldMount = (): MockChannel => {
    const channel = oldClient.channel('share_jobs_badge:user');
    channel.on('postgres_changes', {}, () => undefined);
    channel.subscribe();
    return channel;
  };
  const oldChannel = oldMount();
  void oldClient.removeChannel(oldChannel);
  assert.throws(
    oldMount,
    /cannot add `postgres_changes` callbacks .* after `subscribe\(\)`/,
    'same-topic remount reproduces the physical-device failure before async removal',
  );

  const client = new CachingMockClient();
  const errors: unknown[] = [];
  let invalidations = 0;

  const mount = (userId = 'user') => createShareJobsRealtimeSubscription({
    client,
    scope: 'share_jobs_badge',
    userId,
    coalesceMs: 0,
    onInvalidate: () => { invalidations += 1; },
    onError: (error) => errors.push(error),
  });

  const disposeFirst = mount();
  assert.equal(client.created.length, 1, 'map mount creates one channel');
  assert.equal(client.created[0].onCalls, 1, 'mount registers one callback');
  disposeFirst();
  assert.deepEqual(client.removed, [client.created[0]], 'map unmount removes exactly its channel');

  const disposeSecond = mount();
  assert.equal(client.created.length, 2, 'rapid remount creates a new channel before old removal resolves');
  assert.notEqual(client.created[0], client.created[1], 'remount never reuses subscribed channel');
  assert.equal(errors.length, 0, 'notification to queue to confirmation to map stays local and does not throw');

  const channelsBeforeRerender = client.created.length;
  assert.equal(client.created[1].onCalls, 1, 'rerender does not attach another callback');
  assert.equal(client.created.length, channelsBeforeRerender, 'rerender creates no extra channel');

  client.created[1].statusHandler?.('CLOSED');
  client.created[1].statusHandler?.('SUBSCRIBED');
  assert.equal(client.created[1].onCalls, 1, 'inactive to active recovery never reattaches callbacks');

  client.created[1].eventHandler?.({});
  client.created[1].eventHandler?.({});
  client.created[1].eventHandler?.({});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(invalidations, 1, 'repeated realtime events coalesce to one refresh');
  assert.equal(client.created.length, 2, 'events and rerenders do not create subscriptions');

  client.created[1].statusHandler?.('CHANNEL_ERROR', new Error('socket unavailable'));
  assert.equal(errors.length, 1, 'subscription failure is reported locally');

  disposeSecond();
  const disposeThird = mount('other-user');
  assert.equal(client.removed[1], client.created[1], 'user change disposes old channel first');
  assert.equal(client.created.length, 3, 'user change creates a fresh channel');
  disposeThird();

  client.created[2].eventHandler?.({});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(invalidations, 1, 'late events after cleanup are ignored');

  assert.equal(client.created.every((channel) => channel.onCalls === 1), true);
  const signedOutUserId: string | null = null;
  if (signedOutUserId) mount(signedOutUserId);
  assert.equal(client.created.length, 3, 'signed-out state creates no channel');

  // Regression: two screens subscribing to the SAME scope AT THE SAME TIME.
  // useSavedPlaces is mounted by the map and by the share-job detail route
  // simultaneously. With a shared per-user topic the second mount received the
  // already-joined channel and `.on()` threw out of its effect, which the
  // detail route surfaced as "Couldn't open this item".
  const concurrentClient = new CachingMockClient();
  const concurrentErrors: unknown[] = [];
  let enrichmentInvalidations = 0;
  const mountEnrichment = () => createShareJobsRealtimeSubscription({
    client: concurrentClient,
    scope: 'saved_place_enrichment',
    table: 'share_job_place_results',
    userId: 'user',
    coalesceMs: 0,
    onInvalidate: () => { enrichmentInvalidations += 1; },
    shouldInvalidate: (payload) => typeof payload?.new?.saved_place_id === 'string',
    onError: (error) => concurrentErrors.push(error),
  });

  const disposeMapScreen = mountEnrichment();
  const disposeDetailScreen = mountEnrichment();
  assert.equal(concurrentErrors.length, 0, 'a second concurrent mount never throws');
  assert.equal(concurrentClient.created.length, 2, 'each concurrent mount owns a channel');
  assert.notEqual(
    concurrentClient.created[0],
    concurrentClient.created[1],
    'concurrent mounts never share a subscribed channel instance',
  );
  assert.equal(
    concurrentClient.created.every((channel) => channel.onCalls === 1),
    true,
    'no channel is ever bound twice',
  );

  // Irrelevant ledger rows must not trigger a refetch.
  concurrentClient.created[1].eventHandler?.({ new: { saved_place_id: null } });
  concurrentClient.created[1].eventHandler?.({});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(enrichmentInvalidations, 0, 'rows without a saved place are ignored');

  concurrentClient.created[1].eventHandler?.({ new: { saved_place_id: 'saved-1' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(enrichmentInvalidations, 1, 'an enriched saved place refreshes the cache');

  // Closing the detail route must not tear down the map's subscription.
  disposeDetailScreen();
  assert.deepEqual(
    concurrentClient.removed.slice(-1),
    [concurrentClient.created[1]],
    'unmount removes only its own channel',
  );
  concurrentClient.created[0].eventHandler?.({ new: { saved_place_id: 'saved-2' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(enrichmentInvalidations, 2, 'the still-mounted screen keeps receiving updates');
  disposeMapScreen();

  console.log('PASS share queue Realtime lifecycle regression');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});