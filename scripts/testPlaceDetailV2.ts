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
import { createOnceLatch } from '../lib/onceLatch';
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
  const rolodex = readFileSync(join(process.cwd(), 'components/PhotoRolodex.tsx'), 'utf8');
  assert.ok(detail.includes('<PhotoRolodexModal'), 'Place Detail delegates to the shared rolodex');
  const start = detail.indexOf('async function saveNote(');
  assert.ok(start > -1, 'saveNote exists');
  const body = detail.slice(start, detail.indexOf('\n  }', start));
  assert.ok(body.includes('updateSavedPlace(saved.id, { notes: nextNotes })'), 'writes notes');
  assert.ok(!body.includes('ai_note'), 'an edit never writes or clears ai_note');

  // Fieldnotes keeps one reason with explicit provenance, independent of the source ribbon.
  assert.equal(detail.split('WHY YOU SAVED IT').length - 1, 1);
  assert.ok(detail.includes("whySaved.origin === 'user' ? 'Your note' : 'From the post'"));
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
  assert.ok(detail.includes('<SourceRibbon'), 'shared provenance component renders source');
  assert.ok(detail.includes('Ionicons'), 'uses the icon family that has logo-tiktok');
  // The old generic-glyph mapping is gone for good.
  assert.ok(!detail.includes("case 'tiktok':\n      return 'video'"), 'no generic TikTok glyph');
  assert.ok(!detail.includes('sourceActionIcon'), 'the Feather-only mapping is removed');
  // The logo is never the only cue for what tapping does.
  assert.ok(detail.includes('platform={sourceAttribution.platformName}'), 'platform is explicit');
  assert.ok(detail.includes('capabilities.canWatchSource ? () => void openSource()'), 'ribbon invokes exact-source handler only when supported');
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

// Every gallery opening gets a fresh close latch. Competing close sources
// (swipe completion, X, system back) can therefore produce exactly one state
// transition, while a subsequent opening can still close normally.
{
  let closeCount = 0;
  let closeLatch = createOnceLatch();
  const close = () => {
    if (!closeLatch.acquire()) return;
    closeCount += 1;
  };

  close();
  close();
  close();
  assert.equal(closeCount, 1, 'duplicate dismiss attempts close once per opening');

  closeLatch = createOnceLatch();
  close();
  assert.equal(closeCount, 2, 'a reopened gallery receives a fresh close allowance');
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
  const rolodex = readFileSync(join(process.cwd(), 'components/PhotoRolodex.tsx'), 'utf8');
  // (`PanResponder` still appears in the explanatory comment above the gesture
  // — what must be gone is any USE of it.)
  assert.ok(
    !rolodex.includes('PanResponder.create') && !rolodex.includes('panHandlers'),
    'the JS responder system no longer arbitrates against a native scroll view',
  );
  assert.ok(rolodex.includes('Gesture.Pan()'), 'the dismiss gesture is a native recogniser');
  assert.ok(
    rolodex.includes('.activeOffsetY(GALLERY_DISMISS_ACTIVATE_DY)'),
    'it activates only on decisively downward movement',
  );
  assert.ok(
    rolodex.includes('.failOffsetX([-GALLERY_DISMISS_FAIL_DX, GALLERY_DISMISS_FAIL_DX])'),
    'and fails the moment a drag shows sideways intent, so paging is untouched',
  );
  assert.ok(
    rolodex.includes('.failOffsetY(-GALLERY_DISMISS_FAIL_DY)'),
    'dragging up hands the touch straight back',
  );
  assert.ok(
    rolodex.includes('.blocksExternalGesture(scrollGesture)'),
    'the carousel waits for the verdict instead of racing it',
  );
  assert.ok(
    rolodex.includes('<GestureDetector gesture={scrollGesture}>'),
    'the list is wrapped so the scroll recogniser can be ordered',
  );
  assert.ok(
    rolodex.includes('<GestureHandlerRootView style={styles.root}>'),
    'gestures are rooted inside the Modal, so Android receives them too',
  );
  assert.ok(
    rolodex.includes('shouldDismissGalleryOnRelease({'),
    'release uses the tested threshold, in the units the recogniser reports',
  );
  // The drag must never run through React state — that would re-render (and
  // re-request) every photo on every frame of the gesture.
  assert.ok(
    rolodex.includes('dragY.value = galleryDragOffset(event.translationY)'),
    'the gallery follows the finger through a shared value',
  );
  assert.ok(rolodex.includes('useSharedValue(0)'), 'the drag lives off the JS thread');
  assert.ok(
    !/setGalleryDrag|setState\(.*translationY/.test(rolodex),
    'no per-frame React state during the gesture',
  );
  // Dismissal ends at the ONE close path, and a reopen starts from rest.
  assert.ok(rolodex.includes('runOnJS(close)()'), 'a committed swipe uses the canonical close');
  assert.ok(
    rolodex.includes('dismissLatchRef.current = createOnceLatch()') &&
      rolodex.includes('dismissLatchRef.current.acquire()'),
    'all close sources are idempotent for each gallery opening',
  );
  assert.ok(
    rolodex.includes('if (finished) runOnJS(close)()'),
    'a cancelled exit animation cannot close an immediately reopened gallery',
  );
  assert.ok(
    /dragY\.value = 0;[\s\S]{0,160}setOpenSeed/.test(rolodex),
    'reopening clears any leftover translation before the modal is shown',
  );
  // The copy stays because it is now true.
  assert.ok(rolodex.includes('Swipe down to close'), 'the instruction remains, and is honest');
  // The X button must keep working.
  assert.ok(rolodex.includes('accessibilityLabel="Close photo gallery"'), 'explicit close preserved');
  // Horizontal paging untouched.
  assert.ok(rolodex.includes('horizontal'), 'the carousel is still horizontal');
  assert.ok(rolodex.includes('snapToInterval={snapInterval}'), 'paging preserved');
}

// ---------------------------------------------------------------------------
// 4. The production visual target: Saved because, Did you go yet, Also nearby
// ---------------------------------------------------------------------------

// Real source fields feed the shared ribbon; manual saves have no fake platform.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.equal(detail.split('<SourceRibbon').length - 1, 1, 'one primary source ribbon');
  const ribbon = detail.indexOf('<SourceRibbon');
  assert.ok(detail.slice(ribbon - 25, ribbon).includes('sourceAttribution ?'));
  assert.ok(ribbon < detail.indexOf('styles.savedBecauseCard'));
  assert.ok(detail.includes('platform={sourceAttribution.platformName}'));
  assert.ok(detail.includes('primarySource?.creator'));
  assert.ok(detail.includes('primarySource?.caption ?? undefined'));
  assert.ok(detail.includes('primarySource.thumbnailUrl'));
  assert.ok(detail.includes('capabilities.canWatchSource ? () => void openSource()'));
  assert.ok(detail.includes('unavailable={!sourceUrl}'));
  assert.ok(detail.includes('Add a note'), 'optional blank note stays editable');
  assert.ok(detail.includes('item.creator') && detail.includes('item.thumbnailUrl'), 'multi-source metadata survives');
  assert.ok(detail.includes('[categoryLabel, locality].filter(Boolean)'), 'unknown address creates no empty separator');
  assert.ok(detail.includes('CATEGORY_LABELS[categoryKey]'), 'normalized category remains visible');
  assert.ok(!/\b(menu|dish|eat here|the food|reservation|table for)\b/i.test(detail), 'category-neutral copy');
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
  const alsoNearbySelection = detail.slice(
    detail.indexOf('const alsoNearby = useMemo('),
    detail.indexOf('const sameSourceEntries = useMemo('),
  );
  assert.ok(
    !/ALSO_NEARBY_MAX_METERS|maxMeters:|limit:/.test(alsoNearbySelection),
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
  assert.ok(theme.includes('LightPalette') && theme.includes('DarkPalette'), 'both appearances use canonical palettes');
}

// Native reminder is now independent of the Directions row; large text grows.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(detail.includes('<Switch value={notifyOn}'));
  assert.ok(detail.includes('accessibilityLabel={`Nearby reminder for ${saved.place.name}`}'));
  assert.ok(detail.includes('largeText && styles.reminderRowLarge'));
  assert.ok(detail.includes('largeText && styles.destinationActionsLarge'));
  assert.ok(detail.includes('await updateSavedPlace(saved.id, { notifications_enabled: next })'));
  assert.ok(detail.indexOf('await updateSavedPlace(saved.id, { notifications_enabled: next })') < detail.indexOf('setNotifyOn(next)'));
  assert.ok(detail.includes('await ensureNotificationPermission()'));
  assert.ok(detail.includes('await ensureBackgroundLocationPermission()'));
  assert.ok(detail.includes('Your previous reminder setting is unchanged'));
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
    map.includes('onSeeMap={openNearbyExplorer}'),
    'See map contracts the sheet — it does not dismiss the place or move the camera',
  );
  assert.ok(
    !/onSeeMap=\{[^}]*(?:router\.(push|replace))/.test(map),
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
