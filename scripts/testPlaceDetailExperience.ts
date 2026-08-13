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

// Hero and identity are visual-first; category is compact and normalized.
assert.match(detail, /style=\{styles\.heroImage\}/);
assert.match(detail, /hero: \{[\s\S]*height: 188/);
assert.match(detail, /splitPlaceAddress\(saved\.place\.formatted_address\)\.locality/);
assert.match(detail, /CATEGORY_LABELS\[savedPlaceCategory\(saved\)\]/);
assert.match(detail, /style=\{styles\.categoryPill\}/);
assert.ok(!detail.includes('>Category</Text>'), 'Category must not be a standalone section');

// Only the compact primary actions remain, preserving real handlers.
for (const action of ['Directions', 'Share', 'Open original']) assert.ok(detail.includes(`label="${action}"`));
assert.match(detail, /buildSavedPlaceShareContent\(saved\)/);
assert.match(detail, /void openSource\(\)/);
assert.match(detail, /actionPill: \{[\s\S]*minHeight: 52/);

// Personal context is separate, concise, and live from the saved row.
assert.ok(detail.indexOf('Your note') < detail.indexOf('Nearby reminder'));
assert.match(detail, /notes\.trim\(\) \? \([\s\S]*numberOfLines=\{4\}/);
assert.match(detail, /accessibilityLabel="Add a note"/);
assert.match(detail, /saved\.ai_note\?\.trim\(\)/);
assert.match(detail, /accessibilityLiveRegion="polite"/);
assert.match(detail, />From the post</);
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

// Correction/removal and note editor contracts remain accessible.
assert.match(detail, /title="Wrong place\?"/);
assert.match(detail, /title="Remove from saved"/);
assert.match(editor, /useSafeAreaInsets/);
assert.match(editor, /headerActionButton: \{ flex: 1, minHeight: 44/);
assert.match(editor, /keyboardDismissMode=\{NOTE_EDITOR_BEHAVIOR\.keyboardDismissMode\}/);

console.log('PASS physical map detail hierarchy, safe close, compact metadata/reminder, personal notes, and fallback convergence');
