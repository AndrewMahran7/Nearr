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
assert.match(
  map,
  /shouldRenderSelectedPlaceDetail \? \([\s\S]*previewExpanded[\s\S]*<SelectedPlaceDetails/,
);
assert.match(map, /accessibilityLabel="Close place details"/);
// The expanded sheet takes a FIXED share of the map area rather than growing
// with its content. Content-driven height is what let it swallow the screen
// until only a sliver of map survived; the map has to stay a real part of the
// composition, with the selected marker visible above the sheet.
assert.match(map, /const expandedSheetHeight = useMemo\(/);
assert.match(map, /availableHeight - expandedSheetMapPeek\(safeTopInset\)/);
assert.match(map, /previewExpanded && \{ height: expandedSheetHeight \}/);
assert.match(map, /previewScroll: \{ flex: 1 \}/, 'the body fills the card, it does not define it');
// The peek is DERIVED from the raised Queue pill, not from a percentage, so
// "the detail owns the screen" and "the Queue stays tappable" cannot drift
// apart. An earlier pass reserved 72% for the sheet to keep a big map header;
// the product decision is now the opposite.
assert.match(map, /RAISED_QUEUE_PILL_HEIGHT = Spacing\.sm \+ 44/);
assert.match(
  map,
  /function expandedSheetMapPeek\(safeTopInset: number\): number \{[\s\S]{0,160}safeTopInset \+ RAISED_QUEUE_PILL_HEIGHT \+ Spacing\.md/,
);
{
  const peek = (safeTop: number) => safeTop + 8 + 44 + 12;
  const expanded = (available: number, safeTop: number) =>
    Math.max(380, Math.round(available - peek(safeTop)));
  for (const [device, mapArea, safeTop] of [
    ['iPhone SE', 584, 24],
    ['iPhone 14', 761, 47],
    ['iPhone 14 Pro Max', 849, 59],
  ] as const) {
    const share = expanded(mapArea, safeTop) / mapArea;
    assert.ok(share >= 0.84, `${device}: the sheet takes ${(share * 100).toFixed(0)}% of the map area`);
    const visibleMap = mapArea - expanded(mapArea, safeTop);
    assert.ok(
      visibleMap > safeTop + 8 + 44,
      `${device}: the ${visibleMap}pt strip still clears the raised Queue pill`,
    );
  }
}

// Dismissal is primarily the drag handle. The explicit close is a small mark
// on the handle line, not a control with a 44pt band to itself.
assert.match(map, /closeBtnFloating: \{[\s\S]*width: 30,[\s\S]*height: 30/);
assert.match(map, /hitSlop=\{12\}/, 'small visually, still a 54pt target');
assert.match(map, /accessibilityLabel="Close place details"/);
assert.ok(
  !map.includes('expandedDetailHeader'),
  'the dedicated 44pt close row is gone',
);

// Expanded, the sheet meets the bottom edge with a rounded top only, so it
// reads as part of the map rather than a floating page.
assert.match(map, /previewWrapExpanded: \{[\s\S]*bottom: 0/);
assert.match(map, /previewCardExpanded: \{[\s\S]*borderTopLeftRadius: 28/);
// ...and its content clears the tab bar instead of sliding under it.
assert.match(map, /previewScrollContent: \{[\s\S]*paddingBottom: Spacing\.xxl/);

// Deep links and legacy callers converge on the same map-owned presentation.
assert.match(fallback, /<Redirect/);
assert.match(fallback, /pathname: '\/\(tabs\)\/map'/);
assert.match(fallback, /params: \{ savedPlaceId: id \}/);

// Fieldnotes intentionally replaces the previous utility-first cinematic strip.
assert.match(detail, /hero: \{[\s\S]*aspectRatio: 4 \/ 3/);
assert.doesNotMatch(detail, /styles\.heroScrim/, 'identity is readable on canvas, not on photography');
assert.match(detail, /splitPlaceAddress\(saved.place.formatted_address\).locality/);
assert.match(detail, /CATEGORY_LABELS\[categoryKey\]/);
assert.match(detail, /\[categoryLabel, locality\].filter\(Boolean\)/, 'absent context creates no empty separator');
assert.match(detail, /buildSavedPlaceShareContent\([\s\S]{0,160}referralId/);
assert.match(detail, /void openSource\(\)/);
const sequence = ['styles.hero,', 'styles.heroCaption', 'styles.destinationActions,', '<SourceRibbon', 'styles.savedBecauseCard', 'styles.reminderRow,', 'styles.visitCard', 'title="Saved nearby"', 'title="Also nearby"'];
let previous = -1;
for (const marker of sequence) {
  const position = detail.indexOf(marker);
  assert.ok(position > previous, `${marker} follows the preceding Fieldnotes section`);
  previous = position;
}
assert.match(detail, /title="Directions"[\s\S]*onPress=\{onGetDirections\}/);
assert.match(detail, /photoUrls.length > 0[\s\S]*1 \/ \{photoUrls.length\}/, 'truthful count includes one image');
assert.match(detail, /prefetchAdjacent=\{false\}[\s\S]*loadOnlyVisited/, 'gallery retains bounded loading');
assert.match(detail, /<Modal visible=\{moreOpen\}/, 'More owns management');
assert.match(detail, /title="Edit note"/);
assert.match(detail, /title="Share place"/);
assert.match(detail, /title="Wrong place\?"/);
assert.match(detail, /title="Remove saved place"[\s\S]*confirmDelete\(\)/);

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
assert.equal(reminderStatusLabel({ enabled: false, mode: 'default', milesText: '1', minutesText: '10' }), 'Off');
// Default mode resolves by category at notification time, so it must not
// claim a stale profile-wide number here.
assert.equal(reminderStatusLabel({ enabled: true, mode: 'default', milesText: '1', minutesText: '10' }), 'On');
assert.equal(reminderStatusLabel({ enabled: true, mode: 'miles', milesText: '2.5', minutesText: '10' }), 'On · 2.5 miles');

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
