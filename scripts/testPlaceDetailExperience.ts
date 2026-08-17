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
// The expanded sheet is bounded by the MAP AREA (which already excludes the
// tab bar) and stops short of the top chrome, so the map — and the selected
// marker — stay visible above it.
assert.match(map, /maxHeight: Math\.max\(360, availableHeight - safeTopInset/);
assert.match(map, /closeBtn: \{[\s\S]*width: 44,[\s\S]*height: 44/);
// Expanded, the sheet meets the bottom edge with a rounded top only, so it
// reads as part of the map rather than a floating page.
assert.match(map, /previewWrapExpanded: \{[\s\S]*bottom: 0/);
assert.match(map, /previewCardExpanded: \{[\s\S]*borderTopLeftRadius: Radius\.lg/);

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
assert.match(detail, /CATEGORY_LABELS\[categoryKey\]/);
// Category and locality are icon-led context lines on the hero, not a pill and
// not a metadata table. Locality is conditional because a saved city or island
// legitimately has no street address.
assert.match(detail, /styles\.heroMetaText/);
assert.match(detail, /CATEGORY_ICONS\[categoryKey\]/, 'every Nearr category has a glyph');
assert.match(detail, /\{locality \? \(/, 'no locality → one less line, never an empty row');
assert.ok(!detail.includes('>Category</Text>'), 'Category must not be a standalone section');

// The action row leads the sheet: Directions first, then the source post, then
// Share, then the reminder behind a divider.
assert.match(detail, /styles\.actionRow/);
assert.match(detail, /label="Directions"/);
assert.ok(detail.includes('label="Share"'));
assert.ok(
  detail.indexOf('styles.actionRow') < detail.indexOf('styles.hero,'),
  'the action row sits above the hero, as the reference lays it out',
);
assert.ok(
  detail.indexOf('label="Directions"') < detail.indexOf('label="Share"'),
  'Directions leads',
);
// Source-post access is a first-class action. The label/brand now come from
// the shared attribution resolver so Instagram and TikTok stay peers.
assert.match(
  detail,
  /sourceAttribution\.actionLabel/,
  'source-post access is a first-class action',
);
assert.match(detail, /buildSavedPlaceShareContent\(saved\)/);
assert.match(detail, /void openSource\(\)/);
assert.match(detail, /actionButton: \{[\s\S]*minHeight: 56/, 'comfortable touch targets');

// Section order, top to bottom, exactly as the production reference lays it
// out: action row → hero → today's hours → Saved because → Did you go yet? →
// Also nearby → management footer.
{
  const order = [
    'styles.actionRow',
    'styles.hero,',
    '{todayHours ? (',
    'styles.savedBecauseCard',
    'styles.visitCard',
    'title="Also nearby"',
    'styles.manageRow',
  ].map((marker) => {
    const index = detail.indexOf(marker);
    assert.ok(index > -1, `${marker} is present`);
    return { marker, index };
  });
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      order[i].index > order[i - 1].index,
      `${order[i].marker} follows ${order[i - 1].marker}`,
    );
  }
}

// Personal context stays ONE surface (notes ?? ai_note) rather than a cue block
// stacked on a user block, and it is still live from the saved row.
assert.match(detail, /accessibilityLabel="Add why you saved this place"/);
assert.match(detail, /whySavedDisplay\(\{ notes, ai_note: saved\.ai_note \}\)/);
assert.match(detail, /accessibilityLiveRegion="polite"/);
assert.match(detail, /styles\.savedBecauseTitle/);
// The reminder is now a compact control in the action row, not a card of its
// own competing with the place.
assert.ok(!detail.includes('styles.reminderCard'), 'the standalone reminder card is gone');
assert.match(detail, /styles\.reminderControl/);
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
assert.match(editor, /useSafeAreaInsets/);
assert.match(editor, /headerActionButton: \{ flex: 1, minHeight: 44/);
assert.match(editor, /keyboardDismissMode=\{NOTE_EDITOR_BEHAVIOR\.keyboardDismissMode\}/);

console.log('PASS physical map detail hierarchy, safe close, compact metadata/reminder, personal notes, and fallback convergence');
