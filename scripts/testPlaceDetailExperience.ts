import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { reminderStatusLabel } from '../lib/placeDetailUi';
import {
  expandedPlaceDetailHeight,
  mapMarkerViewportInsets,
  mapUsableViewport,
  planSelectedMarkerOcclusion,
} from '../lib/mapViewportGeometry';

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
assert.match(map, /accessibilityLabel=\{t\("Close place details"\)\}/);
// Expanded detail is a measured destination page, not a content-sized card.
assert.match(map, /const expandedSheetHeight = useMemo\(/);
assert.match(map, /expandedPlaceDetailHeight\(\{ availableHeight, safeTopInset \}\)/);
assert.match(map, /previewExpanded && \{ height: expandedSheetHeight \}/);
assert.match(map, /previewScroll: \{ flex: 1 \}/, 'the body fills the card, it does not define it');
{
  for (const [device, mapArea, safeTop] of [
    ['iPhone SE', 584, 24],
    ['iPhone 14', 761, 47],
    ['iPhone 14 Pro Max', 849, 59],
  ] as const) {
    const expanded = expandedPlaceDetailHeight({ availableHeight: mapArea, safeTopInset: safeTop });
    assert.ok(expanded / mapArea >= 0.9, `${device}: expanded detail uses at least 90%`);
    assert.ok(expanded / mapArea <= 0.95, `${device}: expanded detail uses at most 95%`);
  }
}

// Fixed opaque chrome retains identity and owns drag while the body scrolls.
assert.match(map, /styles\.expandedHeader[\s\S]*previewPanResponder\.panHandlers/);
assert.match(map, /\{selected\.place\.name\}/);
assert.match(map, /accessibilityLabel=\{`More options for \$\{selected\.place\.name\}`\}/);
assert.match(map, /expandedHeaderButton: \{[\s\S]*width: 44,[\s\S]*height: 44/);
assert.match(map, /previewCardExpanded: \{[\s\S]*overflow: 'hidden'/);
assert.match(map, /accessibilityLabel=\{t\("Close place details"\)\}/);

// Expanded, the sheet meets the bottom edge with a rounded top only, so it
// reads as part of the map rather than a floating page.
assert.match(map, /previewWrapExpanded: \{[\s\S]*bottom: 0/);
assert.match(map, /previewCardExpanded: \{[\s\S]*borderTopLeftRadius: 28/);
// ...and its content clears the tab bar instead of sliding under it.
assert.match(map, /previewScrollContent: \{[\s\S]*paddingBottom: Spacing\.xxl/);
assert.match(map, /paddingBottom: insets\.bottom \+ Spacing\.xxl \+ 32/);

// Compact-map correction uses the rendered marker canvas on both axes and is
// explicitly idle while the detail page owns almost the whole screen.
const markerInsets = mapMarkerViewportInsets({ width: 148, height: 90, anchorX: 0.5, anchorY: 0.335, breathingRoom: 12 });
assert.ok(Math.abs(markerInsets.top - 42.15) < 0.001);
assert.deepEqual({ right: markerInsets.right, bottom: markerInsets.bottom, left: markerInsets.left }, { right: 86, bottom: 71.85, left: 86 });
const viewport = mapUsableViewport({ width: 390, height: 760, top: 120, bottom: 220, margin: 0, markerInsets });
assert.equal(planSelectedMarkerOcclusion({ point: { x: 385, y: 160 }, viewport }).kind, 'move');
assert.equal(planSelectedMarkerOcclusion({ point: { x: 5, y: 500 }, viewport }).kind, 'move');
assert.match(map, /if \(previewExpanded \|\| !selected/);

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
const sequence = ['styles.hero,', 'styles.heroCaption', 'styles.destinationActions,', '<SourceRibbon', 'styles.savedBecauseCard', 'styles.reminderRow,', 'styles.visitCard', 'title={t("Near this place")}', 'title={t("Also nearby")}'];
let previous = -1;
for (const marker of sequence) {
  const position = detail.indexOf(marker);
  assert.ok(position > previous, `${marker} follows the preceding Fieldnotes section`);
  previous = position;
}
assert.match(detail, /title=\{t\("Directions"\)\}[\s\S]*onPress=\{onGetDirections\}/);
assert.match(detail, /photoUrls.length > 0[\s\S]*1 \/ \{photoUrls.length\}/, 'truthful count includes one image');
assert.match(detail, /prefetchAdjacent=\{false\}[\s\S]*loadOnlyVisited/, 'gallery retains bounded loading');
assert.match(detail, /<Modal visible=\{moreOpen\}/, 'More owns management');
assert.match(detail, /title=\{t\("Edit note"\)\}/);
assert.match(detail, /title=\{t\("Share place"\)\}/);
assert.match(detail, /title=\{t\("Wrong place\?"\)\}/);
assert.match(detail, /title=\{t\("Remove saved place"\)\}[\s\S]*confirmDelete\(\)/);

// Personal context stays ONE surface (notes ?? ai_note) rather than a cue block
// stacked on a user block, and it is still live from the saved row.
assert.match(detail, /accessibilityLabel=\{t\("Add why you saved this place"\)\}/);
assert.match(detail, /whySavedDisplay\(\{ notes, ai_note: saved\.ai_note \}\)/);
assert.match(detail, /accessibilityLiveRegion="polite"/);
assert.match(detail, /styles\.savedBecauseTitle/);
assert.match(detail, /styles\.emptyNoteRow/);
// The reminder is now a compact control in the action row, not a card of its
// own competing with the place.
assert.ok(!detail.includes('styles.reminderCard'), 'the standalone reminder card is gone');
assert.match(detail, /styles\.reminderControl/);
assert.match(detail, /reminderSwitchSlot: \{[\s\S]*width: REMINDER_SWITCH_SLOT_WIDTH[\s\S]*flexShrink: 0[\s\S]*paddingHorizontal: REMINDER_SWITCH_TRAILING_CLEARANCE/);
assert.match(detail, /onLayout=\{verifyReminderSwitchBounds\}/, 'native switch reports its actual layout bounds');
assert.match(detail, /reminderCopy: \{ flexGrow: 1, flexShrink: 1, minWidth: 0/);
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
assert.match(detail, /accessibilityLabel=\{t\("Wrong place\? Correct this saved place"\)\}/);
assert.match(detail, /Remove \${saved\.place\.name} from saved places/);
assert.match(detail, /manageText: \{[\s\S]*color: colors\.textMuted/, 'management actions are low-emphasis');
assert.match(detail, /manageAction: \{[\s\S]*minHeight: 44/, 'low emphasis never means small targets');
assert.match(editor, /useSafeAreaInsets/);
assert.match(editor, /headerActionButton: \{ flex: 1, minHeight: 44/);
assert.match(editor, /keyboardDismissMode=\{NOTE_EDITOR_BEHAVIOR\.keyboardDismissMode\}/);

console.log('PASS physical map detail hierarchy, safe close, compact metadata/reminder, personal notes, and fallback convergence');
