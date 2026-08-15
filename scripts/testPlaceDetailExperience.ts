import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { reminderStatusLabel } from '../lib/placeDetailUi';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const map = read('app/(tabs)/map.tsx');
const detail = read('components/map/SelectedPlaceDetails.tsx');
const editor = read('components/map/NoteEditorModal.tsx');
const fallback = read('app/place/[id].tsx');

// The physical runtime is the selected-place branch owned by the map.
assert.match(map, /selected \? \([\s\S]*previewExpanded[\s\S]*<SelectedPlaceDetails/);
assert.match(map, /accessibilityLabel="Close place details"/);
assert.match(map, /windowHeight - insets\.top - insets\.bottom/);
assert.match(map, /closeBtn: \{[\s\S]*width: 44,[\s\S]*height: 44/);

// Deep links and legacy callers converge on the same map-owned presentation.
assert.match(fallback, /<Redirect/);
assert.match(fallback, /pathname: '\/\(tabs\)\/map'/);
assert.match(fallback, /params: \{ savedPlaceId: id \}/);

// Hero and identity are visual-first: the photo carries the page and the
// name/context sit on it under a scrim. Category stays compact and normalized.
assert.match(detail, /style=\{styles\.heroImage\}/);
assert.match(detail, /hero: \{[\s\S]*height: 250/, 'the hero dominates the first screenful');
assert.match(detail, /styles\.heroScrimStrong/, 'title legibility over photography is deliberate');
assert.match(detail, /styles\.heroCaption/, 'name + context are part of the hero, not a separate block');
assert.match(detail, /splitPlaceAddress\(saved\.place\.formatted_address\)\.locality/);
assert.match(detail, /CATEGORY_LABELS\[savedPlaceCategory\(saved\)\]/);
assert.match(detail, /style=\{styles\.categoryPill\}/);
assert.ok(!detail.includes('>Category</Text>'), 'Category must not be a standalone section');

// Going there is the single emphasized action; the rest stay quiet companions.
assert.match(detail, /styles\.primaryAction/, 'Directions is the one filled action');
assert.match(detail, />Directions</);
assert.ok(detail.includes('label="Share"'));
assert.match(detail, /label=\{sourceActionLabel\(saved\)\}/, 'source-post access is a first-class action');
assert.match(detail, /buildSavedPlaceShareContent\(saved\)/);
assert.match(detail, /void openSource\(\)/);
assert.match(detail, /actionPill: \{[\s\S]*minHeight: 52/);

// Personal context is separate, live from the saved row, and the source cue
// leads because it answers "why did I save this?".
assert.ok(detail.indexOf('Your note') < detail.indexOf('Nearby reminder'));
assert.ok(
  detail.indexOf('narrative.showSourceNote') < detail.indexOf('narrative.userNote'),
  'the source cue is the emotional lead, above the user note',
);
assert.match(detail, /accessibilityLabel="Add your own note"/);
assert.match(detail, /savedPlaceNarrative\(\{ notes, ai_note: saved\.ai_note \}\)/);
assert.match(detail, /accessibilityLiveRegion="polite"/);
assert.match(detail, /styles\.sourceNoteLabel/);
assert.match(detail, />Use as my note</);
assert.match(detail, /<NoteEditorModal[\s\S]*aiNote=\{saved\.ai_note\}/);
assert.doesNotMatch(detail, /\[saved\.place\.google_place_id, saved\]/, 'AI-note updates cannot reset photo/detail state');

// Reminder is collapsed by default and only expands its radius controls on demand.
assert.match(detail, /useState\(false\);[\s\S]*setReminderSettingsExpanded/);
assert.match(detail, /notifyOn && reminderSettingsExpanded \? \(/);
assert.match(detail, /accessibilityState=\{\{ expanded: reminderSettingsExpanded \}\}/);
assert.equal(reminderStatusLabel({ enabled: false, mode: 'default', profile: null, milesText: '1', minutesText: '10' }), 'Off');
assert.equal(reminderStatusLabel({ enabled: true, mode: 'default', profile: { default_radius_value: 1, default_radius_unit: 'miles' }, milesText: '1', minutesText: '10' }), 'On · 1 mile');
assert.equal(reminderStatusLabel({ enabled: true, mode: 'miles', profile: null, milesText: '2.5', minutesText: '10' }), 'On · 2.5 miles');

// Correction/removal stay reachable but visually secondary — they must never
// compete with Directions or the content itself.
assert.match(detail, /accessibilityLabel="Wrong place\? Correct this saved place"/);
assert.match(detail, /Remove \${saved\.place\.name} from saved places/);
assert.match(detail, /manageText: \{[\s\S]*color: colors\.textMuted/, 'management actions are low-emphasis');
assert.match(detail, /manageAction: \{[\s\S]*minHeight: 44/, 'low emphasis never means small targets');
assert.ok(
  detail.indexOf('styles.manageRow') > detail.indexOf('styles.reminderCard'),
  'management actions sit at the very bottom',
);
assert.match(editor, /useSafeAreaInsets/);
assert.match(editor, /headerActionButton: \{ flex: 1, minHeight: 44/);
assert.match(editor, /keyboardDismissMode=\{NOTE_EDITOR_BEHAVIOR\.keyboardDismissMode\}/);

console.log('PASS physical map detail hierarchy, safe close, compact metadata/reminder, personal notes, and fallback convergence');
