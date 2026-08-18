/**
 * scripts/testPlaceDetailV2.ts
 *
 * Place Detail V2 functional contracts:
 *   1. "Why you saved it" is ONE surface (notes ?? ai_note) and editing it
 *      never touches ai_note provenance.
 *   2. TikTok gets first-class branding, exactly like Instagram — and a manual
 *      save gets no fake platform.
 *   3. The photo gallery's "↓ Swipe down to close" promise is backed by real
 *      gesture arbitration that does not break horizontal paging.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testPlaceDetailV2.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { whySavedDisplay } from '../lib/placeDetailUi';
import { hasOpenableSource, resolvePlaceSource } from '../lib/placeSource';
import {
  GALLERY_DISMISS_ACTIVATE_DY,
  GALLERY_DISMISS_DISTANCE,
  GALLERY_DISMISS_FAIL_DX,
  GALLERY_DISMISS_VELOCITY,
  galleryBackdropOpacity,
  galleryDragOffset,
  gallerySwipeIntent,
  resolveGallerySwipe,
  shouldDismissGalleryOnRelease,
} from '../lib/photoCarousel';

// ---------------------------------------------------------------------------
// 1. "Why you saved it" — one concept, two fields, provenance preserved
// ---------------------------------------------------------------------------
{
  // notes wins when both exist.
  const both = whySavedDisplay({ notes: 'Go for the patio', ai_note: 'Known for ramen' });
  assert.equal(both.text, 'Go for the patio');
  assert.equal(both.origin, 'user');
  assert.equal(both.seedFromSourceNote, false, 'the user already wrote their own');

  // ai_note is the displayed starting value when the user has not written one.
  const aiOnly = whySavedDisplay({ notes: null, ai_note: 'Known for ramen' });
  assert.equal(aiOnly.text, 'Known for ramen');
  assert.equal(aiOnly.origin, 'source');
  assert.equal(aiOnly.seedFromSourceNote, true, 'editing starts from the cue, not a blank box');

  // Neither → an editable empty state, never a broken-looking empty card.
  const neither = whySavedDisplay({ notes: null, ai_note: null });
  assert.deepEqual(neither, { text: null, origin: null, seedFromSourceNote: false });

  // Whitespace is not content.
  assert.equal(whySavedDisplay({ notes: '   ', ai_note: 'cue' }).origin, 'source');
  assert.equal(whySavedDisplay({ notes: '   ', ai_note: '  ' }).text, null);
}

// The edit path must persist into `notes` ONLY. This mirrors the component's
// saveNote: updateSavedPlace(id, { notes }) — ai_note is never in the patch.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const start = detail.indexOf('async function saveNote(');
  assert.ok(start > -1, 'saveNote exists');
  const body = detail.slice(start, detail.indexOf('\n  }', start));
  assert.ok(body.includes('updateSavedPlace(saved.id, { notes: nextNotes })'), 'writes notes');
  assert.ok(!body.includes('ai_note'), 'an edit never writes or clears ai_note');

  // And exactly one visible "why" surface — not an AI block plus a user block.
  // The heading is derived once (source → "Saved because…", manual save →
  // "Your note") and rendered from that single variable, so a second section
  // cannot reappear by accident.
  assert.ok(detail.includes("'Saved because…'"), 'the single surface is present');
  assert.equal(
    detail.split('savedBecauseLabel').length - 1,
    2,
    'the heading is computed once and rendered once',
  );
  assert.equal(
    detail.split('const hasReason = !!whySaved.text').length - 1,
    1,
    'exactly one place decides whether there is a note to show',
  );
  assert.ok(
    !detail.includes('sourceNoteCard') && !detail.includes('sourceCardLabel'),
    'the old cue-card + saved-from-card pair is gone',
  );
}

// ---------------------------------------------------------------------------
// 2. Platform attribution — TikTok and Instagram as peers
// ---------------------------------------------------------------------------
{
  const ig = resolvePlaceSource({ source_type: 'instagram', source_url: 'https://instagram.com/reel/x' });
  const tt = resolvePlaceSource({ source_type: 'tiktok', source_url: 'https://tiktok.com/@a/video/1' });
  assert.ok(ig && tt);

  assert.equal(ig!.platform, 'instagram');
  assert.equal(ig!.brandIcon, 'logo-instagram');
  assert.equal(ig!.branded, true);
  assert.equal(ig!.sourceA11yLabel, 'Instagram source');
  assert.equal(ig!.actionA11yLabel, 'Watch original Instagram post');

  assert.equal(tt!.platform, 'tiktok');
  assert.equal(tt!.brandIcon, 'logo-tiktok', 'TikTok gets a real brand mark');
  assert.equal(tt!.branded, true);
  assert.equal(tt!.sourceA11yLabel, 'TikTok source');
  assert.equal(tt!.actionA11yLabel, 'Watch original TikTok');

  // Peers: same shape, same weight, neither degraded to a generic glyph.
  assert.equal(tt!.actionLabel, ig!.actionLabel, 'same action copy');
  assert.notEqual(tt!.brandIcon, 'video', 'TikTok is never a generic video icon');
  assert.notEqual(tt!.brandIcon, ig!.brandIcon, 'and never wears the Instagram logo');
  assert.equal(
    Object.keys(ig!).sort().join(','),
    Object.keys(tt!).sort().join(','),
    'identical attribution contract for both platforms',
  );
}

// Manual save: no source at all → no attribution, no fake platform.
{
  assert.equal(resolvePlaceSource({ source_type: null, source_url: null }), null);
  assert.equal(resolvePlaceSource({}), null);
  assert.equal(resolvePlaceSource({ source_type: null, source_url: '   ' }), null);
  assert.equal(hasOpenableSource({ source_url: null }), false);
  assert.equal(hasOpenableSource({ source_url: 'https://tiktok.com/x' }), true);
}

// Canonical source_type wins; the URL host is only a fallback.
{
  // A mislabelled URL can never override the persisted contract.
  const declared = resolvePlaceSource({
    source_type: 'tiktok',
    source_url: 'https://instagram.com/reel/whatever',
  });
  assert.equal(declared!.platform, 'tiktok', 'source_type is authoritative');

  // Missing source_type → infer from the host.
  for (const [url, expected] of [
    ['https://www.tiktok.com/@user/video/123', 'tiktok'],
    ['https://vm.tiktok.com/abc', 'tiktok'],
    ['https://www.instagram.com/reel/abc/', 'instagram'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://fb.watch/abc', 'facebook'],
  ] as const) {
    assert.equal(resolvePlaceSource({ source_url: url })!.platform, expected, url);
  }

  // An unrecognised host is an honest generic link, not a guessed platform.
  const generic = resolvePlaceSource({ source_url: 'https://someblog.example/post' });
  assert.equal(generic!.platform, 'link');
  assert.equal(generic!.branded, false, 'a generic link never claims a brand');
  assert.equal(generic!.actionLabel, 'Open link');

  // Malformed URL with no type → nothing to attribute, but still openable text.
  assert.equal(resolvePlaceSource({ source_url: 'not a url' })!.platform, 'link');
}

// The component must use the shared resolver and real brand marks.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(detail.includes('resolvePlaceSource'), 'uses the shared attribution resolver');
  assert.ok(detail.includes('sourceAttribution.brandIcon'), 'renders the brand mark');
  assert.ok(detail.includes('Ionicons'), 'uses the icon family that has logo-tiktok');
  // The old generic-glyph mapping is gone for good.
  assert.ok(!detail.includes("case 'tiktok':\n      return 'video'"), 'no generic TikTok glyph');
  assert.ok(!detail.includes('sourceActionIcon'), 'the Feather-only mapping is removed');
  // The logo is never the only cue for what tapping does.
  assert.ok(detail.includes('sourceAttribution.actionLabel'), 'a text label accompanies the logo');
  assert.ok(detail.includes('sourceAttribution.actionA11yLabel'), 'icon actions are labelled');
}

// Watch original opens the EXACT stored source URL — never a rebuilt one.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const start = detail.indexOf('async function openSource(');
  const body = detail.slice(start, detail.indexOf('\n  }', start));
  assert.ok(body.includes('rawUrl: sourceUrl'), 'opens the stored source_url verbatim');
  assert.ok(!/https?:\/\//.test(body), 'never synthesises a platform URL');
}

// ---------------------------------------------------------------------------
// 3. Gallery swipe-down — the promise the copy makes
// ---------------------------------------------------------------------------

// Axis lock, one sample at a time. These are the SAME numbers handed to the
// native recogniser (failOffsetX / failOffsetY / activeOffsetY), evaluated in
// the recogniser's own order: fail first, activate second.
{
  assert.equal(gallerySwipeIntent({ dx: 0, dy: 40 }), 'dismiss', 'straight down dismisses');
  assert.equal(gallerySwipeIntent({ dx: 6, dy: 60 }), 'dismiss', 'mostly down dismisses');
  assert.equal(gallerySwipeIntent({ dx: 0, dy: 4 }), 'undecided', 'a tiny twitch decides nothing');
  assert.equal(gallerySwipeIntent({ dx: 0, dy: -80 }), 'page', 'upward is never a dismissal');
  assert.equal(gallerySwipeIntent({ dx: 90, dy: 0 }), 'page', 'horizontal paging is safe');
  assert.equal(gallerySwipeIntent({ dx: -90, dy: 10 }), 'page', 'reverse paging is safe');
  // Diagonal must NOT constantly dismiss: real sideways travel is paging.
  assert.equal(gallerySwipeIntent({ dx: 50, dy: 50 }), 'page', 'diagonal stays with paging');
  assert.equal(
    gallerySwipeIntent({ dx: GALLERY_DISMISS_FAIL_DX, dy: GALLERY_DISMISS_ACTIVATE_DY + 20 }),
    'dismiss',
    'a slightly diagonal downward drag still closes',
  );
  assert.equal(gallerySwipeIntent({ dx: Number.NaN, dy: Number.NaN }), 'undecided');
}

// A whole gesture: the FIRST decisive sample owns it. Neither side may change
// its mind afterwards, so a page turn that drifts downward at the end is still
// a page turn — and a downward drag that wanders sideways still dismisses.
{
  const straightDown = [
    { dx: 0, dy: 3 },
    { dx: 1, dy: 9 },
    { dx: 2, dy: 30 },
    { dx: 4, dy: 160 },
  ];
  assert.equal(resolveGallerySwipe(straightDown), 'dismiss', 'a slow drag down closes');

  const fastHorizontal = [
    { dx: 8, dy: 1 },
    { dx: 46, dy: 3 },
    { dx: 140, dy: 9 },
  ];
  assert.equal(resolveGallerySwipe(fastHorizontal), 'page', 'a fast swipe pages');

  const pageThenSag = [
    { dx: 12, dy: 2 },
    { dx: 80, dy: 40 },
    { dx: 120, dy: 220 },
  ];
  assert.equal(resolveGallerySwipe(pageThenSag), 'page', 'a page turn that sags never dismisses');

  const dismissThenDrift = [
    { dx: 2, dy: 20 },
    { dx: 60, dy: 90 },
    { dx: 130, dy: 240 },
  ];
  assert.equal(resolveGallerySwipe(dismissThenDrift), 'dismiss', 'a claimed dismissal is kept');

  // Overscrolling at the first/last photo drags sideways against a wall — the
  // list does not move, but the FINGER does, so this must still page.
  const overscrollAtEdge = [
    { dx: -5, dy: 1 },
    { dx: -28, dy: 6 },
    { dx: -60, dy: 22 },
  ];
  assert.equal(resolveGallerySwipe(overscrollAtEdge), 'page', 'edge overscroll is not a dismissal');

  assert.equal(resolveGallerySwipe([]), 'undecided', 'a tap decides nothing');
  assert.equal(resolveGallerySwipe([{ dx: 0, dy: 0 }]), 'undecided');
}

// Release: distance OR velocity commits; anything else settles back. `dy` is
// measured from ACTIVATION (the recogniser zeroes translation there), and
// velocity is px/second, matching the recogniser's `velocityY`.
{
  assert.equal(
    shouldDismissGalleryOnRelease({ dy: GALLERY_DISMISS_DISTANCE + 5, vy: 0 }),
    true,
    'a long slow drag dismisses',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dy: GALLERY_DISMISS_DISTANCE - 5, vy: 0 }),
    false,
    'just short of the threshold settles back',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dy: 40, vy: GALLERY_DISMISS_VELOCITY + 100 }),
    true,
    'a short fast flick dismisses',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dy: 40, vy: 100 }),
    false,
    'a small slow drag settles back',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dy: -200, vy: -3000 }),
    false,
    'upward never dismisses',
  );
  assert.equal(shouldDismissGalleryOnRelease({ dy: 0, vy: 0 }), false, 'a tap never dismisses');
  assert.equal(shouldDismissGalleryOnRelease({ dy: Number.NaN, vy: Number.NaN }), false);
}

// Interactive follow: downward-only, clamped, with a bounded backdrop fade.
{
  assert.equal(galleryDragOffset(120), 120, 'the gallery tracks the finger');
  assert.equal(galleryDragOffset(-120), 0, 'dragging up does not lift it off-screen');
  assert.equal(galleryDragOffset(Number.NaN), 0);

  assert.equal(galleryBackdropOpacity(0, 800), 1, 'opaque at rest');
  assert.ok(galleryBackdropOpacity(300, 800) < 1, 'fades as it is dragged away');
  assert.ok(galleryBackdropOpacity(10_000, 800) >= 0.35, 'never fully transparent');
  assert.equal(galleryBackdropOpacity(120, 0), galleryBackdropOpacity(120, 1), 'degenerate height safe');
}

// The wiring. Arbitration must happen in the NATIVE recogniser, not the JS
// responder system: on iOS the carousel is a UIScrollView whose pan cancels JS
// touches at ~10pt in any direction, which is exactly why the PanResponder
// versions of this gesture only ever fired by luck.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  // (`PanResponder` still appears in the explanatory comment above the gesture
  // — what must be gone is any USE of it.)
  assert.ok(
    !detail.includes('PanResponder.create') && !detail.includes('panHandlers'),
    'the JS responder system no longer arbitrates against a native scroll view',
  );
  assert.ok(detail.includes('Gesture.Pan()'), 'the dismiss gesture is a native recogniser');
  assert.ok(
    detail.includes('.activeOffsetY(GALLERY_DISMISS_ACTIVATE_DY)'),
    'it activates only on decisively downward movement',
  );
  assert.ok(
    detail.includes('.failOffsetX([-GALLERY_DISMISS_FAIL_DX, GALLERY_DISMISS_FAIL_DX])'),
    'and fails the moment a drag shows sideways intent, so paging is untouched',
  );
  assert.ok(
    detail.includes('.failOffsetY(-GALLERY_DISMISS_FAIL_DY)'),
    'dragging up hands the touch straight back',
  );
  assert.ok(
    detail.includes('.blocksExternalGesture(galleryScrollGesture)'),
    'the carousel waits for the verdict instead of racing it',
  );
  assert.ok(
    detail.includes('<GestureDetector gesture={galleryScrollGesture}>'),
    'the list is wrapped so the scroll recogniser can be ordered',
  );
  assert.ok(
    detail.includes('<GestureHandlerRootView style={styles.galleryRoot}>'),
    'gestures are rooted inside the Modal, so Android receives them too',
  );
  assert.ok(
    detail.includes('shouldDismissGalleryOnRelease({ dy: event.translationY, vy: event.velocityY })'),
    'release uses the tested threshold, in the units the recogniser reports',
  );
  // The drag must never run through React state — that would re-render (and
  // re-request) every photo on every frame of the gesture.
  assert.ok(
    detail.includes('galleryDragY.value = galleryDragOffset(event.translationY)'),
    'the gallery follows the finger through a shared value',
  );
  assert.ok(detail.includes('useSharedValue(0)'), 'the drag lives off the JS thread');
  assert.ok(
    !/setGalleryDrag|setState\(.*translationY/.test(detail),
    'no per-frame React state during the gesture',
  );
  // Dismissal ends at the ONE close path, and a reopen starts from rest.
  assert.ok(detail.includes('runOnJS(closeGallery)()'), 'a committed swipe uses the canonical close');
  assert.ok(
    /galleryDragY\.value = 0;\r?\n\s*setGalleryOpenSeed/.test(detail),
    'reopening clears any leftover translation before the modal is shown',
  );
  // The copy stays because it is now true.
  assert.ok(detail.includes('Swipe down to close'), 'the instruction remains, and is honest');
  // The X button must keep working.
  assert.ok(detail.includes('accessibilityLabel="Close photo gallery"'), 'explicit close preserved');
  // Horizontal paging untouched.
  assert.ok(detail.includes('horizontal'), 'the carousel is still horizontal');
  assert.ok(detail.includes('snapToInterval={gallerySnapInterval}'), 'paging preserved');
}

// ---------------------------------------------------------------------------
// 4. The production visual target: Saved because, Did you go yet, Also nearby
// ---------------------------------------------------------------------------

// "Saved because…" degrades honestly. No source ⇒ no watch action, no platform
// row, and no empty creator/avatar shell — just the user's own note.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');

  // Every source-bearing element is gated on a real, openable source.
  // Exactly ONE Watch post affordance for a social save: the action row. The
  // full-width CTA that used to sit inside this card repeated it and made the
  // card the tallest thing on the screen.
  assert.ok(!detail.includes('watchButton'), 'the duplicate CTA inside Saved because is gone');
  assert.equal(
    detail.split('sourceAttribution.actionLabel').length - 1,
    1,
    'the source action label is rendered exactly once, in the action row',
  );
  {
    const actionRow = detail.indexOf('styles.actionRow');
    const card = detail.indexOf('styles.savedBecauseCard');
    assert.ok(
      detail.indexOf('sourceAttribution.actionLabel') < card,
      'and that one lives above Saved because, in the action row',
    );
    assert.ok(actionRow > -1 && card > actionRow);
  }
  // The tile still opens the post, so direct interaction survives the removal.
  {
    const tile = detail.indexOf('styles.sourceTile');
    const around = detail.slice(Math.max(0, tile - 700), tile);
    assert.ok(around.includes('void openSource()'), 'tapping the source tile opens the post');
  }

  for (const gated of ['styles.sourceTile']) {
    const index = detail.indexOf(gated);
    assert.ok(index > -1, `${gated} exists`);
    const preceding = detail.slice(Math.max(0, index - 900), index);
    assert.ok(
      preceding.includes('sourceUrl && sourceAttribution'),
      `${gated} only renders when a real source URL is stored`,
    );
  }
  // The platform is credited from resolved attribution, never hardcoded —
  // either on its own line beside a reason, or folded into the heading when
  // there is no reason yet (so the card never says "Instagram" twice).
  const attribution = detail.indexOf('styles.attributionRow');
  assert.ok(attribution > -1);
  assert.ok(
    detail.slice(attribution - 500, attribution).includes('sourceAttribution && hasReason ? ('),
    'the platform line needs attribution, not a hardcoded platform',
  );
  assert.ok(
    detail.includes('`Saved from ${sourceAttribution.platformName}`'),
    'the no-reason heading states the fact we have, from the resolver',
  );
  assert.ok(
    !detail.includes('Why did you save this?'),
    'an unanswered question is no longer the centrepiece of the card',
  );
  assert.ok(detail.includes('Add a note'), 'writing one is offered as a quiet link');

  // Nearr does not persist the post's own thumbnail or the creator's handle,
  // so neither may be invented.
  assert.ok(
    !/creator|@\{|avatarUrl|thumbnailUrl|posterUrl/i.test(detail),
    'no fabricated creator handle, avatar, or video still',
  );
  // The copy is category-neutral: nothing assumes the place is a restaurant.
  assert.ok(
    !/\b(menu|dish|eat here|the food|reservation|table for)\b/i.test(detail),
    'Place Detail copy never assumes a restaurant',
  );
}

// Category neutrality: every Nearr category has a glyph, and a place with no
// street address (a city, an island) drops the locality line instead of
// rendering an empty one.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const start = detail.indexOf('const CATEGORY_ICONS');
  const block = detail.slice(start, detail.indexOf('};', start));
  for (const category of [
    'restaurant', 'cafe', 'hotel', 'beach', 'island', 'park', 'museum',
    'hiking_trail', 'scenic_spot', 'shopping', 'transportation', 'other',
  ]) {
    assert.ok(block.includes(`${category}:`), `${category} has a glyph`);
  }
  assert.ok(detail.includes('{locality ? ('), 'no address → no locality row');
  assert.ok(
    detail.includes('CATEGORY_ICONS[categoryKey]'),
    'the glyph follows the normalized Nearr category, never a raw provider type',
  );
}

// "Did you go yet?" is a compact feedback card, not gamification, and the
// answered state persists rather than re-asking on reopen.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(detail.includes('styles.visitCard'));
  assert.ok(detail.includes('visited.prompt') && detail.includes('visited.supportCopy'));
  assert.ok(detail.includes("visited.visited ? 'You went here'"), 'an answered place says so');
  assert.ok(
    detail.includes('{visited.visited ? ('),
    'and does not re-offer the question it already has an answer to',
  );
  assert.ok(
    !/\bstreaks?\b|\bachievement|\btrophy\b|\blevel up\b|\bmilestone\b|places visited this/i.test(detail),
    'no gamification / achievement-card UI',
  );
  assert.ok(!/reviews?Count|review_count|\d+ reviews/i.test(detail), 'no review counts');
}

// Also Nearby is presentation-only: same selector, same exact-id navigation,
// and the row component is generic enough for a future "From this video".
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const row = readFileSync(join(process.cwd(), 'components/map/place/PlaceCardRow.tsx'), 'utf8');

  assert.ok(detail.includes('title="Also nearby"'), 'presented by the shared row');
  assert.ok(detail.includes('<PlaceCardRow'), 'via the reusable component');
  assert.ok(
    !/ALSO_NEARBY_MAX_METERS|maxMeters:|limit:/.test(detail),
    'the redesign did not quietly retune the distance/limit semantics',
  );
  assert.ok(row.includes('title'), 'the row is titled by its caller, not hardcoded');
  assert.ok(
    !/alsoNearby|selectAlsoNearby|distanceMeters/.test(row),
    'the row knows nothing about WHY its places were chosen — a second row can reuse it',
  );
  assert.ok(!/fetch\(|googleapis|placesService/.test(row), 'no external discovery');
}

// Theme: both palettes, via tokens — never a parallel colour system.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const styles = detail.slice(detail.indexOf('function createStyles('));
  // Raw colour is permitted in exactly two places: type/scrims that sit ON the
  // photo or the full-screen gallery (where the image, not the theme, sets the
  // contrast), and shadow colours. Every surface colour must be a token.
  for (const line of styles.split('\n')) {
    const raw = line.match(/#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\)/);
    if (!raw) continue;
    const isShadow = /shadowColor|textShadowColor/.test(line);
    const isMonochrome =
      /#FFFFFF/i.test(raw[0]) || /rgba\(\s*(0,\s*0,\s*0|255,\s*255,\s*255)/.test(raw[0]);
    assert.ok(
      isShadow || isMonochrome,
      `raw colour ${raw[0]} must come from a theme token instead — "${line.trim()}"`,
    );
  }
  assert.ok(styles.includes('colors.accentSoft'), 'accent washes use a theme token');
  assert.ok(styles.includes('colors.accentBorder'), 'accent hairlines use a theme token');

  const theme = readFileSync(join(process.cwd(), 'lib/theme.tsx'), 'utf8');
  const constants = readFileSync(join(process.cwd(), 'constants/colors.ts'), 'utf8');
  assert.ok(constants.includes('accentSoft') && constants.includes('accentBorder'), 'dark palette defines them');
  assert.ok(theme.includes('accentSoft') && theme.includes('accentBorder'), 'light palette defines them');
}

// Small screens: the action row fits at every supported width, with no
// breakpoint and no truncation. The previous pass had a `viewportWidth < 390`
// fallback and still shipped "Watch p…" on a 390pt iPhone, because 390 < 390
// is false. The fix was to cut the fixed cost, not to move the threshold.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  const toggle = readFileSync(join(process.cwd(), 'components/map/place/ReminderToggle.tsx'), 'utf8');

  assert.ok(
    !detail.includes('compactActionRow'),
    'no width breakpoint to get wrong by one point',
  );
  assert.ok(
    !/<Switch\b/.test(detail),
    'the fixed ~51pt system Switch is gone — it was the reason the row overflowed',
  );
  assert.ok(detail.includes('<ReminderToggle'), 'replaced by the compact toggle');
  assert.match(toggle, /TRACK_WIDTH = 40/, 'which is 40pt, not 51');
  assert.match(toggle, /accessibilityRole="switch"/, 'and still a switch to VoiceOver');
  assert.match(toggle, /accessibilityState=\{\{ checked: value \}\}/);
  assert.match(toggle, /hitSlop=\{10\}/, 'with a real touch target');
  assert.ok(!/react-native-\w/.test(toggle), 'pure RN — no native dependency');

  assert.match(detail, /actionButtonText: \{[\s\S]*fontSize: 11/, 'labels stay readable');
  assert.ok(detail.includes('numberOfLines={1}'), 'and never wrap the row');

  // The budget itself, at the three widths that matter. `Watch post` and
  // `Directions` are ~61pt at 11pt semibold; anything under that truncates.
  const SHEET_PADDING = 32; // Spacing.lg each side
  const DIVIDER = 9; // hairline + Spacing.xs margins
  const BELL_CLUSTER = 68; // bell + "1 mi" + chevron + padding
  const TOGGLE = 40;
  const WIDEST_LABEL = 61;
  for (const width of [375, 390, 430]) {
    const perAction = (width - SHEET_PADDING - DIVIDER - BELL_CLUSTER - TOGGLE) / 3;
    assert.ok(
      perAction >= WIDEST_LABEL + 8,
      `${width}pt: ${perAction.toFixed(0)}pt per action clears "Watch post" (${WIDEST_LABEL}pt) with margin`,
    );
  }
}

// Also Nearby: three compact cards previewable, plus the See map affordance.
{
  const row = readFileSync(join(process.cwd(), 'components/map/place/PlaceCardRow.tsx'), 'utf8');
  const cardWidth = Number(row.match(/CARD_WIDTH = (\d+)/)?.[1]);
  const gap = Number(row.match(/row: \{ gap: (\d+)/)?.[1]);
  assert.ok(Number.isFinite(cardWidth) && Number.isFinite(gap));
  for (const width of [375, 390, 430]) {
    const content = width - 32;
    // Fractional: a partially-visible fourth card is the point of a strip.
    const previewable = (content + gap) / (cardWidth + gap);
    assert.ok(
      previewable >= 2.9,
      `${width}pt previews ${previewable.toFixed(1)} cards (was ~2.2 at 148pt wide)`,
    );
  }
  assert.ok(cardWidth >= 100, 'but not so narrow that ordinary names become unreadable');
  assert.ok(cardWidth <= 120, 'and not the oversized tile that only fit two');

  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(detail.includes("actionLabel={onSeeMap ? 'See map' : undefined}"), 'See map is offered');
  assert.ok(row.includes('actionLabel') && row.includes('onAction'), 'the row supports a header action');
  const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  assert.ok(
    map.includes('onSeeMap={() => setPreviewExpanded(false)}'),
    'See map contracts the sheet — it does not dismiss the place or move the camera',
  );
  assert.ok(
    !/onSeeMap=\{[^}]*(?:animateToRegion|fitToCoordinates|router\.(push|replace))/.test(map),
    'and never builds a new route or drives the camera',
  );
}

// Did you go yet: one horizontal band, not a stacked card.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.match(
    detail,
    /visitCard: \{[\s\S]{0,120}flexDirection: 'row'/,
    'icon, copy and both answers share a line',
  );
  assert.ok(!detail.includes('styles.visitHeader'), 'the stacked header block is gone');

  // Thumbs, not Yes/Not yet — and not a rating.
  assert.ok(!/>Yes</.test(detail) && !/'Not yet'/.test(detail), 'the wide text buttons are gone');
  assert.ok(detail.includes('name="thumbs-up"'), 'thumbs-up is a real vector icon');
  assert.ok(detail.includes('name="thumbs-down"'), 'thumbs-down is a real vector icon');
  assert.ok(!/[\u{1F44D}\u{1F44E}]/u.test(detail), 'no Unicode emoji');
  assert.match(detail, /thumbButton: \{[\s\S]*width: 36,[\s\S]*height: 36/, 'compact');
  assert.ok(detail.includes('hitSlop={6}'), 'but a 48pt effective target');

  // Semantics: up = went, down = not yet. Never like/dislike, never red/green,
  // and thumbs-down must remain a purely local, non-mutating acknowledgement.
  assert.match(detail, /accessibilityLabel=\{`Yes, I went to \$\{saved\.place\.name\}`\}/);
  assert.match(detail, /accessibilityLabel=\{`No, not yet — keep \$\{saved\.place\.name\}/);
  {
    // Look FORWARD from each handler to the icon it renders, so the visited
    // state's non-interactive thumbs-up (which appears first in the file)
    // cannot be mistaken for the button.
    const up = detail.indexOf('void handleMarkVisited()');
    assert.ok(up > -1, 'the visit handler still exists');
    assert.ok(
      detail.slice(up, up + 900).includes('name="thumbs-up"'),
      'thumbs-up calls the SAME handler the Yes button did',
    );

    const down = detail.indexOf('setVisitDeferred(true)');
    assert.ok(down > -1);
    const downBlock = detail.slice(down, down + 900);
    assert.ok(
      downBlock.includes('name="thumbs-down"'),
      'thumbs-down calls the SAME handler Not yet did',
    );
    assert.ok(
      !/markVisited|updateSavedPlace\(|deleteSavedPlace|dislike|rating|downvote/.test(downBlock),
      'thumbs-down records nothing — it means "not yet", never "I disliked this"',
    );
  }
  // Selected state uses the Nearr accent, not rating colours.
  assert.match(detail, /thumbButtonSelected: \{[\s\S]*backgroundColor: colors\.accentSoft/);
  {
    const stylesStart = detail.indexOf('    thumbButton: {');
    const thumbStyles = detail.slice(stylesStart, detail.indexOf('},', detail.indexOf('thumbButtonSelected')) + 2);
    assert.ok(
      !/colors\.danger|colors\.success|green|red/i.test(thumbStyles),
      'no red/green like-dislike semantics',
    );
  }
  // An answered place shows its answer instead of asking again.
  assert.ok(
    detail.includes('accessibilityLabel={`You went to ${saved.place.name}`}'),
    'the visited state renders a selected thumbs-up',
  );
}

console.log('PASS place detail V2: one why-surface, TikTok/Instagram peers, working swipe-down, reference composition');
