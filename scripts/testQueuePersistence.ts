import assert from 'node:assert/strict';

import {
  addClearedQueueIds,
  addDismissedQueueIds,
  persistQueueIdsOptimistically,
  readClearedQueueIds,
  readDismissedQueueIds,
  subscribeQueueDismissals,
  type QueueIdStorage,
} from '../lib/queueClearedState';
import { filterDismissedQueueRows } from '../lib/queueInbox';

class MemoryStorage implements QueueIdStorage {
  values = new Map<string, string>();
  writes = 0;
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.writes += 1;
    if (this.failWrites) throw new Error('disk full');
    this.values.set(key, value);
  }
}

async function main() {
  const storage = new MemoryStorage();
  const dismissalEvents: Array<{ userId: string; ids: string[] }> = [];
  const unsubscribe = subscribeQueueDismissals((userId, ids) => {
    dismissalEvents.push({ userId, ids: [...ids] });
  });
  await addDismissedQueueIds('user-a', ['active-1'], storage);
  assert.deepEqual(
    dismissalEvents,
    [{ userId: 'user-a', ids: ['active-1'] }],
    'a dismissal immediately invalidates every mounted queue consumer',
  );
  unsubscribe();
  const afterRestart = await readDismissedQueueIds('user-a', storage);
  assert.deepEqual([...afterRestart], ['active-1'], 'dismissal survives a fresh read/restart');
  assert.deepEqual(
    filterDismissedQueueRows(
      [{ id: 'active-1' }, { id: 'review-2' }],
      afterRestart,
    ).map((row) => row.id),
    ['review-2'],
    'refresh/realtime payload cannot resurrect a dismissed id or hide another row',
  );

  const beforeBatchWrites = storage.writes;
  await addClearedQueueIds('user-a', ['done-1', 'done-2', 'done-2'], storage);
  assert.equal(storage.writes, beforeBatchWrites + 1, 'clear completed is one batch write');
  assert.deepEqual(
    [...await readClearedQueueIds('user-a', storage)],
    ['done-1', 'done-2'],
    'batch clear is deduplicated',
  );
  await addClearedQueueIds('user-a', ['done-1', 'done-2'], storage);
  assert.deepEqual([...await readClearedQueueIds('user-a', storage)], ['done-1', 'done-2']);

  const failingStorage = new MemoryStorage();
  failingStorage.failWrites = true;
  const prior = new Set(['keep-hidden']);
  const applied: Set<string>[] = [];
  await assert.rejects(
    persistQueueIdsOptimistically({
      current: prior,
      ids: ['new-hidden'],
      apply: (next) => applied.push(new Set(next)),
      persist: (ids) => addDismissedQueueIds('user-a', ids, failingStorage),
    }),
    /disk full/,
  );
  assert.deepEqual([...applied[0]!], ['keep-hidden', 'new-hidden'], 'dismissal hides optimistically');
  assert.deepEqual([...applied.at(-1)!], ['keep-hidden'], 'failed persistence restores exact prior state');
}

void main().then(() => console.log('PASS queue dismissal persistence, batching, and rollback'));
