import assert from 'node:assert/strict';

import {
  SHARE_COMPLETION_COPY,
  SHARE_COMPLETION_LAYOUT,
  acceptedBody,
  canDismiss,
  shareCompletionMotion,
} from '../lib/shareCompletionUi';

// Safe areas / tap targets survive.
assert.ok(SHARE_COMPLETION_LAYOUT.primaryHeight >= 44, 'Done is a full tap target');
assert.ok(SHARE_COMPLETION_LAYOUT.secondaryHeight >= 44, 'Open Nearr is a full tap target');
assert.ok(SHARE_COMPLETION_LAYOUT.horizontalPadding >= 16, 'small phones retain side padding');
assert.ok(SHARE_COMPLETION_LAYOUT.markSize >= 40, 'confirmation mark is visible');

// ---- Done / Open Nearr copy ------------------------------------------------
assert.equal(SHARE_COMPLETION_COPY.primary, 'Done');
assert.equal(SHARE_COMPLETION_COPY.secondary, 'Open Nearr');
assert.equal(SHARE_COMPLETION_COPY.acceptedTitle, 'Sent to Nearr');
assert.match(acceptedBody(false), /add it to your map/i);
assert.match(acceptedBody(true), /already shared/i);
assert.notEqual(acceptedBody(true), acceptedBody(false), 'duplicate is stated honestly');

// A submitting state never blocks dismissal — the extension must not hold
// Instagram/TikTok open while Phase 2 runs.
assert.equal(canDismiss('submitting'), true);
assert.equal(canDismiss('accepted'), true);
assert.equal(canDismiss('recoverable'), true);

// ---- Reduce Motion ---------------------------------------------------------
const reduced = shareCompletionMotion(true);
assert.equal(reduced.animate, false, 'Reduce Motion disables the animation');
assert.equal(reduced.durationMs, 0, 'Reduce Motion renders the final frame immediately');
assert.equal(reduced.fromScale, 1, 'no scale-in under Reduce Motion');
assert.equal(reduced.fromOpacity, 1, 'content is fully visible under Reduce Motion');

const normal = shareCompletionMotion(false);
assert.equal(normal.animate, true);
assert.ok(normal.durationMs > 0 && normal.durationMs <= 400, 'motion stays short and light');
assert.ok(normal.fromScale < 1, 'mark scales in');
assert.ok(normal.fromOpacity < 1, 'content fades in');

console.log('PASS share completion surface layout, copy, dismissal, and Reduce Motion');
