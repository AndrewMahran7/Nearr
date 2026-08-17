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
assert.match(map, /previewCardExpanded: \{[\s\S]*borderTopLeftRadius: 26/);
// ...and its content clears the tab bar instead of sliding under it.
assert.match(map, /previewScrollContent: \{[\s\S]*paddingBottom: Spacing\.xxl/);

// Deep links and legacy callers converge on the same map-owned presentation.
assert.match(fallback, /<Redirect/);
assert.match(fallback, /pathname: '\/\(tabs\)\/map'/);
assert.match(fallback, /params: \{ savedPlaceId: id \}/);

// Hero and identity are visual-first: the photo carries the page and the
// name/context sit on it under a scrim. Category stays compact and normalized.
assert.match(detail, /style=\{styles\.heroImage\}/);
// Cinematic, not boxy: the hero is a wide 1.9:1 band that bleeds past the
// sheet's own padding, and its height follows the device width instead of
// being a fixed slab that eats a small screen.
assert.match(detail, /hero: \{[\s\S]*aspectRatio: 1\.9/, 'the hero is wide, not tall');
assert.match(detail, /hero: \{[\s\S]*marginHorizontal: -Spacing\.sm/, 'it bleeds past the padding');
assert.ok(!/hero: \{[\s\S]*height: 250/.test(detail), 'the fixed 250pt box is gone');
// The scrim is a ramp, not three thick steps that printed seams across the
// photo and turned the lower third into a black slab.
assert.match(detail, /heroScrim6/, 'the ramp has fine steps');
assert.ok(!detail.includes('heroScrimStrong'), 'the 0.45 slab band is gone');
{
  const band = detail.slice(detail.indexOf('const heroScrimBand'), detail.indexOf('type RadiusMode'));
  const alpha = Number(band.match(/rgba\(0,0,0,([\d.]+)\)/)?.[1]);
  assert.ok(alpha <= 0.1, `each band is a small step (${alpha})`);
  assert.ok(alpha * 6 < 0.6, 'and six of them stay short of a solid black bottom');
}
assert.match(detail, /styles\.heroScrim1/, 'title legibility over photography is deliberate');
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
assert.match(detail, /actionButton: \{[\s\S]*minHeight: 48/, 'comfortable touch targets');

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
