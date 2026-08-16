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
  GALLERY_DISMISS_DISTANCE,
  galleryBackdropOpacity,
  galleryDragOffset,
  shouldClaimGalleryDismiss,
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
  assert.ok(detail.includes('WHY YOU SAVED IT'), 'the single surface is present');
  assert.ok(!detail.includes('>Your note<'), 'no separate "Your note" section remains');
  assert.equal(
    detail.split('WHY YOU SAVED IT').length - 1,
    1,
    'the label appears exactly once',
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

// Claiming (capture phase): only a decisively downward drag takes the gesture
// away from the horizontal carousel.
{
  assert.equal(shouldClaimGalleryDismiss({ dx: 0, dy: 40 }), true, 'straight down claims');
  assert.equal(shouldClaimGalleryDismiss({ dx: 6, dy: 60 }), true, 'mostly down claims');
  assert.equal(shouldClaimGalleryDismiss({ dx: 0, dy: 4 }), false, 'a tiny twitch does not');
  assert.equal(shouldClaimGalleryDismiss({ dx: 0, dy: -80 }), false, 'upward never claims');
  assert.equal(shouldClaimGalleryDismiss({ dx: 90, dy: 0 }), false, 'horizontal paging is safe');
  assert.equal(shouldClaimGalleryDismiss({ dx: -90, dy: 10 }), false, 'reverse paging is safe');
  // Diagonal must NOT constantly dismiss: equal parts down and across is paging.
  assert.equal(shouldClaimGalleryDismiss({ dx: 50, dy: 50 }), false, 'diagonal stays with paging');
  assert.equal(shouldClaimGalleryDismiss({ dx: 30, dy: 60 }), true, 'clearly-down diagonal claims');
}

// Release: distance OR velocity commits; anything else settles back.
{
  assert.equal(
    shouldDismissGalleryOnRelease({ dx: 0, dy: GALLERY_DISMISS_DISTANCE + 5, vy: 0 }),
    true,
    'a long drag dismisses',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dx: 0, dy: 40, vy: 1.5 }),
    true,
    'a short fast flick dismisses',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dx: 0, dy: 40, vy: 0.1 }),
    false,
    'a small slow drag settles back',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dx: 0, dy: -200, vy: -3 }),
    false,
    'upward never dismisses',
  );
  assert.equal(
    shouldDismissGalleryOnRelease({ dx: 300, dy: 20, vy: 0.2 }),
    false,
    'a horizontal page turn never dismisses',
  );
  assert.equal(shouldDismissGalleryOnRelease({ dx: 0, dy: 0, vy: 0 }), false, 'a tap never dismisses');
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

// The wiring: arbitration MUST be in the capture phase. Using the bubble phase
// is exactly why the old handler never fired — the horizontal FlatList inside
// became responder first and never yielded.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(
    detail.includes('onMoveShouldSetPanResponderCapture'),
    'the dismiss layer arbitrates before the scroll view',
  );
  assert.ok(
    detail.includes('shouldClaimGalleryDismiss(gestureState)'),
    'and uses the tested predicate',
  );
  assert.ok(
    detail.includes('onStartShouldSetPanResponderCapture: () => false'),
    'taps still reach the close button and the photos',
  );
  assert.ok(
    detail.includes('shouldDismissGalleryOnRelease(gestureState)'),
    'release uses the tested threshold',
  );
  assert.ok(detail.includes('onPanResponderMove'), 'the gallery follows the finger');
  // The copy stays because it is now true.
  assert.ok(detail.includes('Swipe down to close'), 'the instruction remains, and is honest');
  // The X button must keep working.
  assert.ok(detail.includes('accessibilityLabel="Close photo gallery"'), 'explicit close preserved');
  // Horizontal paging untouched.
  assert.ok(detail.includes('horizontal'), 'the carousel is still horizontal');
  assert.ok(detail.includes('snapToInterval={gallerySnapInterval}'), 'paging preserved');
}

console.log('PASS place detail V2: one why-surface, TikTok/Instagram peers, working swipe-down');
