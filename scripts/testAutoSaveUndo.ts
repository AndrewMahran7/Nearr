import assert from 'node:assert/strict';
import { autoSaveUndoElapsedBucket } from '../lib/autoSaveUndo';

const now = new Date('2026-08-03T12:00:00.000Z').getTime();
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

assert.equal(autoSaveUndoElapsedBucket(ago(5), now), 'under_10s');
assert.equal(autoSaveUndoElapsedBucket(ago(10), now), '10s_to_1m');
assert.equal(autoSaveUndoElapsedBucket(ago(60), now), '1m_to_5m');
assert.equal(autoSaveUndoElapsedBucket(ago(300), now), '5m_to_1h');
assert.equal(autoSaveUndoElapsedBucket(ago(3600), now), 'over_1h');
assert.equal(autoSaveUndoElapsedBucket('not-a-date', now), 'unknown');

console.log('PASS auto-save undo analytics buckets');