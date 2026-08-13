import assert from 'node:assert/strict';

import { createQueueSwipeCoordinator } from '../lib/queueSwipeCoordinator';

const coordinator = createQueueSwipeCoordinator();
const closed: string[] = [];

coordinator.open('one', () => closed.push('one'));
assert.equal(coordinator.activeRowId(), 'one');

coordinator.open('two', () => closed.push('two'));
assert.deepEqual(closed, ['one'], 'opening a second row closes the first');
assert.equal(coordinator.activeRowId(), 'two');

coordinator.closeActive();
assert.deepEqual(closed, ['one', 'two'], 'scroll/tap close closes the active row');
assert.equal(coordinator.activeRowId(), null);

coordinator.open('three', () => closed.push('three'));
coordinator.unregister('three');
coordinator.closeActive();
assert.deepEqual(closed, ['one', 'two'], 'an unmounted row is not closed later');

console.log('PASS queue swipe single-open coordination');
