import assert from 'node:assert/strict';

import {
  SHARE_COMPLETION_COPY,
  SHARE_COMPLETION_SHEET,
  acceptedBody,
  canDismiss,
  occupiesFullScreen,
  shareCompletionMaxHeight,
  shareCompletionMotion,
} from '../lib/shareCompletionUi';

// ---- compact completion state ---------------------------------------------
// The production bug: the sheet rendered at height:100%. The ceiling must keep
// it to roughly half the window on every common device height.
for (const windowHeight of [667, 812, 844, 932, 1024]) {
  const max = shareCompletionMaxHeight(windowHeight);
  assert.ok(max > 0, 'sheet always has a positive height');
  assert.ok(
    !occupiesFullScreen(max, windowHeight),
    `sheet must not fill the screen at ${windowHeight}pt`,
  );
  assert.ok(max < windowHeight * 0.6, 'sheet stays compact');
}
assert.ok(shareCompletionMaxHeight(0) > 0, 'unknown window height still yields a usable sheet');
assert.ok(shareCompletionMaxHeight(Number.NaN) > 0, 'NaN window height is safe');

// The old full-screen layout is detected as the regression it was.
assert.equal(occupiesFullScreen(844, 844), true);
assert.equal(occupiesFullScreen(400, 844), false);

// Safe areas / tap targets survive.
assert.ok(SHARE_COMPLETION_SHEET.primaryHeight >= 44, 'Done is a full tap target');
assert.ok(SHARE_COMPLETION_SHEET.secondaryHeight >= 40, 'Open Nearr stays tappable');
assert.ok(SHARE_COMPLETION_SHEET.bottomPadding > 0, 'bottom inset padding is reserved');
assert.ok(SHARE_COMPLETION_SHEET.markSize >= 40, 'confirmation mark is visible');

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

console.log('PASS share completion sheet layout, copy, dismissal, and Reduce Motion');
