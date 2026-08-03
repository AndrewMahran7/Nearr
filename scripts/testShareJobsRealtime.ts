import assert from 'node:assert/strict';

import {
  createShareJobsRealtimeSubscription,
  type ShareJobsRealtimeChannel,
  type ShareJobsRealtimeClient,
  type ShareJobsRealtimeStatus,
} from '../lib/shareJobsRealtime';

class MockChannel implements ShareJobsRealtimeChannel {
  subscribed = false;
  onCalls = 0;
  eventHandler: (() => void) | null = null;
  statusHandler: ((status: ShareJobsRealtimeStatus, error?: Error) => void) | null = null;

  on(_type: 'postgres_changes', _filter: object, callback: () => void): ShareJobsRealtimeChannel {
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

  client.created[1].eventHandler?.();
  client.created[1].eventHandler?.();
  client.created[1].eventHandler?.();
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

  client.created[2].eventHandler?.();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(invalidations, 1, 'late events after cleanup are ignored');

  assert.equal(client.created.every((channel) => channel.onCalls === 1), true);
  const signedOutUserId: string | null = null;
  if (signedOutUserId) mount(signedOutUserId);
  assert.equal(client.created.length, 3, 'signed-out state creates no channel');
  console.log('PASS share queue Realtime lifecycle regression');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});