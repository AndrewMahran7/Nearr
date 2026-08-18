/**
 * scripts/testSavedPlaceDetailUi.ts
 *
 * Presentation contracts for the saved-place detail sheet
 * (components/map/SelectedPlaceDetails.tsx):
 *   - the persisted source cue (`ai_note`) and the user's own note stay
 *     strictly separate and never blend,
 *   - a missing/blank cue omits the section instead of rendering a
 *     "no note available" placeholder,
 *   - reminder status stays readable in both enabled and disabled states.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { reminderStatusLabel, savedPlaceNarrative } from '../lib/placeDetailUi';

// --- source cue present ----------------------------------------------------
{
  const n = savedPlaceNarrative({
    ai_note: 'That stacked Italian sandwich looks absolutely ridiculous. Need it.',
    notes: null,
  });
  assert.equal(n.showSourceNote, true);
  assert.equal(n.sourceNote, 'That stacked Italian sandwich looks absolutely ridiculous. Need it.');
  assert.equal(n.userNote, null);
  assert.equal(n.canPromoteSourceNote, true, 'offer "use as my note" when there is no user note');
}

// --- source cue missing ----------------------------------------------------
for (const ai_note of [null, undefined, '', '   ', '\n\t ']) {
  const n = savedPlaceNarrative({ ai_note, notes: null });
  assert.equal(n.showSourceNote, false, `blank cue (${JSON.stringify(ai_note)}) hides the section`);
  assert.equal(n.sourceNote, null);
  assert.equal(n.canPromoteSourceNote, false, 'nothing to promote without a cue');
}

// --- the two notes never blend ---------------------------------------------
{
  const n = savedPlaceNarrative({
    ai_note: 'Tiny pasta spot, giant plates, zero chance I would remember it.',
    notes: 'Go with Brandon',
  });
  assert.equal(n.showSourceNote, true);
  assert.equal(n.userNote, 'Go with Brandon');
  assert.notEqual(n.sourceNote, n.userNote);
  assert.equal(
    n.canPromoteSourceNote,
    false,
    'never offer to overwrite a note the user already wrote',
  );
}

// A user note with no cue keeps rendering; only the cue section disappears.
{
  const n = savedPlaceNarrative({ ai_note: null, notes: 'Try the spicy rigatoni' });
  assert.equal(n.userNote, 'Try the spicy rigatoni');
  assert.equal(n.showSourceNote, false);
}

// Whitespace-only user note is treated as absent (so the compact add-note row
// shows instead of an empty "Your note" block).
{
  const n = savedPlaceNarrative({ ai_note: 'Looks unreal.', notes: '   ' });
  assert.equal(n.userNote, null);
  assert.equal(n.canPromoteSourceNote, true);
}

// Missing fields entirely (older cached rows) must not throw.
{
  const n = savedPlaceNarrative({});
  assert.deepEqual(n, {
    sourceNote: null,
    userNote: null,
    showSourceNote: false,
    canPromoteSourceNote: false,
  });
}

// --- reminder enabled / disabled -------------------------------------------
{
  const profile = { default_radius_value: 1, default_radius_unit: 'miles' as const };
  // 'default' mode no longer resolves to profile.default_radius_value at
  // notification time (a category-aware distance applies instead — see
  // lib/nearbyEligibility.ts), so it must not claim a specific number even
  // when a profile is present.
  assert.equal(
    reminderStatusLabel({ enabled: true, mode: 'default', profile, milesText: '1', minutesText: '10' }),
    'On',
  );
  assert.equal(
    reminderStatusLabel({ enabled: true, mode: 'miles', profile, milesText: '2.5', minutesText: '10' }),
    'On · 2.5 miles',
  );
  assert.equal(
    reminderStatusLabel({ enabled: true, mode: 'minutes', profile, milesText: '1', minutesText: '10' }),
    'On · 10 minutes',
  );
  assert.equal(
    reminderStatusLabel({ enabled: false, mode: 'miles', profile, milesText: '1', minutesText: '10' }),
    'Off',
    'a disabled reminder still states its state plainly',
  );
  // No profile yet (cold start) must still produce a readable status.
  assert.equal(
    reminderStatusLabel({ enabled: true, mode: 'default', profile: null, milesText: '1', minutesText: '10' }),
    'On',
  );
}

// --- sheet render contracts -------------------------------------------------
const sheet = readFileSync(
  join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'),
  'utf8',
);

// Place Detail V2 presents ONE "Why you saved it" surface (notes ?? ai_note)
// instead of an AI block stacked on a user block. The decision still lives in
// the shared helper, so the display rule stays unit-testable.
assert.match(sheet, /whySavedDisplay\(/, 'the sheet derives its notes from the shared helper');
assert.match(sheet, /hasReason = !!whySaved\.text/, 'the surface is gated on the helper');
// The heading names the ORIGIN of the save, and falls back to the user's own
// note when there is no post to credit — one surface either way.
// Three honest headings from one derivation: a reason from a post, a post with
// no reason yet, and a manual save.
assert.match(sheet, /'Saved because…'/, 'consumer-facing label for the source cue');
assert.match(sheet, /const savedBecauseLabel = !sourceAttribution/);
assert.match(sheet, /\? 'Your note'/, 'a manual save is the user’s own note');
assert.match(sheet, /`Saved from \$\{sourceAttribution\.platformName\}`/);
// The label must never expose how the cue was produced.
assert.doesNotMatch(
  sheet,
  /AI summary|AI note<|generated description|model output|extraction|No AI note/i,
  'the cue is never described as model output to the user',
);
assert.match(sheet, /a11yLabel=\{`Get directions to \$\{saved\.place\.name\}`\}/);
assert.match(sheet, /reminderStatus/, 'compact reminder still surfaces its status');
assert.match(
  sheet,
  /accessibilityLabel=\{`Nearby reminder for \$\{saved\.place\.name\}`\}/,
  'the toggle keeps a label, naming the place it controls',
);
assert.match(sheet, /minHeight: 44/, 'management actions keep an accessible target');
assert.match(sheet, /styles\.manageRow/, 'destructive actions live in the low-emphasis footer');

console.log('PASS saved-place detail notes, reminder status, and sheet contracts');
