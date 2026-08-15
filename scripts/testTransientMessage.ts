/**
 * scripts/testTransientMessage.ts
 *
 * Lifecycle of the map's transient confirmation ("Saved to your map"):
 * it appears on a save signal, retires on the first real user action, is
 * immune to internal render/system activity, and can never be taken down by a
 * previous message's timer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TRANSIENT_MESSAGE_MS,
  isMeaningfulInteraction,
  nextTransientMessage,
  shouldHonorDismiss,
} from '../lib/transientMessage';

// --- 1. Appears on a save-completion signal ---------------------------------
{
  const first = nextTransientMessage(null, 'Saved to your map', 'saved-1');
  assert.equal(first.message, 'Saved to your map');
  assert.equal(first.undoId, 'saved-1');
  assert.equal(first.id, 1);
}

// --- 2. Idle timeout is a lightweight acknowledgement, not a notification ---
{
  assert.ok(TRANSIENT_MESSAGE_MS >= 2000, 'long enough to register / be announced');
  assert.ok(TRANSIENT_MESSAGE_MS <= 4000, 'short enough never to feel stale');
}

// --- 3. First meaningful interaction dismisses immediately ------------------
{
  for (const source of ['press', 'scroll', 'gesture', 'marker_press', 'sheet_dismiss', 'navigation']) {
    assert.equal(isMeaningfulInteraction(source), true, `${source} dismisses`);
  }
}

// --- 4. Internal/system activity must NOT dismiss --------------------------
{
  for (const source of [
    'image_load',
    'realtime_update',
    'cache_refresh',
    'layout',
    'animation_frame',
    'sheet_auto_expand',
    'camera_animation',
    'ai_note_arrived',
  ]) {
    assert.equal(isMeaningfulInteraction(source), false, `${source} must not dismiss`);
  }
  // Unknown sources default to NOT dismissing, so a newly added internal event
  // can never silently start eating the confirmation.
  assert.equal(isMeaningfulInteraction('some_future_internal_event'), false);
  assert.equal(isMeaningfulInteraction(''), false);
  assert.equal(isMeaningfulInteraction(null), false);
  assert.equal(isMeaningfulInteraction(undefined), false);
}

// --- 5. A new success signal gets its own lifecycle -------------------------
{
  const first = nextTransientMessage(null, 'Saved to your map', 'saved-1');
  const second = nextTransientMessage(first, 'Saved to your map', 'saved-2');
  assert.notEqual(second.id, first.id, 'identical text is still a distinct message');
  assert.equal(second.id, 2);
  assert.equal(second.undoId, 'saved-2');
}

// --- 6. A stale timer cannot dismiss a newer message ------------------------
{
  const first = nextTransientMessage(null, 'Saved to your map', null);
  const second = nextTransientMessage(first, 'Already on your map', null);
  // The first message's timer fires late, carrying its own id.
  assert.equal(shouldHonorDismiss(second, first.id), false, 'old timer cannot kill the new message');
  // The current message's own timer is honored.
  assert.equal(shouldHonorDismiss(second, second.id), true);
  // An explicit dismiss (user action / unmount) always applies.
  assert.equal(shouldHonorDismiss(second, null), true);
  assert.equal(shouldHonorDismiss(second, undefined), true);
  // Nothing showing → nothing to dismiss.
  assert.equal(shouldHonorDismiss(null, 1), false);
  assert.equal(shouldHonorDismiss(null, null), false);
}

// --- Component + map wiring -------------------------------------------------
const snackbar = readFileSync(join(process.cwd(), 'components/map/MapSnackbar.tsx'), 'utf8');

// 7. The timer must not be restarted by the parent re-rendering. `onDismiss`
// is an inline arrow from the map, so it must be held in a ref and kept OUT of
// the effect deps — this was the actual bug behind the ~15s lifetime.
assert.match(snackbar, /const dismissRef = useRef\(onDismiss\)/);
assert.match(
  snackbar,
  /\}, \[visible, anim, token, durationMs\]\);/,
  'the auto-dismiss timer is keyed on the message token, never on onDismiss',
);
assert.doesNotMatch(
  snackbar,
  /\}, \[visible, anim, onDismiss, durationMs\]\);/,
  'onDismiss identity must not restart the countdown',
);
assert.match(snackbar, /return \(\) => clearTimeout\(id\)/, 'timers are cleaned up on unmount');
assert.match(snackbar, /durationMs = TRANSIENT_MESSAGE_MS/, 'uses the shared duration');
assert.doesNotMatch(snackbar, /durationMs = 4000/, 'the old default is gone');

const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
assert.match(map, /token=\{snackbar\?\.id\}/, 'each message passes its identity to the timer');
assert.match(map, /nextTransientMessage\(current, message, undoId\)/, 'one place raises messages');

// 8. Dismissing the confirmation must never clear the selected place.
assert.match(
  map,
  /const handleUserInteraction = useCallback\(\(source: InteractionSource\) => \{[\s\S]{0,260}setSnackbar\(\(current\) => \(current \? null : current\)\);\s*\n\s*\}, \[\]\);/,
  'the interaction handler only touches the snackbar',
);
// Scope the check to the handler's OWN body. (`dismissSelectedPlace` calls the
// handler and then clears the place — but that is the user dismissing the
// place, not the confirmation dismissing it.)
{
  const start = map.indexOf('const handleUserInteraction = useCallback(');
  assert.ok(start > 0, 'the interaction handler exists');
  const body = map.slice(start, map.indexOf('}, []);', start));
  assert.ok(!body.includes('setSelected('), 'the handler never clears the selected place');
  assert.ok(!body.includes('dismissSelectedPlace'), 'the handler never collapses the sheet');
  assert.ok(body.includes('setSnackbar('), 'the handler only retires the confirmation');
}

// Interaction is observed WITHOUT consuming the touch: returning false from the
// capture hooks means the wrapper never becomes the responder, so buttons,
// scrolling and map gestures behave exactly as before.
assert.match(
  map,
  /onStartShouldSetResponderCapture=\{\(\) => \{\s*\n\s*handleUserInteraction\('press'\);\s*\n\s*return false;/,
  'taps still reach their button',
);
assert.match(
  map,
  /onMoveShouldSetResponderCapture=\{\(\) => \{\s*\n\s*handleUserInteraction\('gesture'\);\s*\n\s*return false;/,
  'gestures are observed, not swallowed',
);
assert.match(map, /onScrollBeginDrag=\{\(\) => handleUserInteraction\('scroll'\)\}/);
assert.match(map, /handleUserInteraction\('marker_press'\)/);
assert.match(map, /handleUserInteraction\('sheet_dismiss'\)/);

console.log('PASS transient confirmation lifecycle, interaction dismissal, and timer safety');
