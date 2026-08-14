/**
 * scripts/testPhotoCarousel.ts
 *
 * Paging + prefetch-window math for the saved-place photo carousel
 * (lib/photoCarousel.ts). The visible focus treatment is driven from the
 * native scroll offset, so these cover the page counter/dots index and the
 * bounded warm-up window rather than any animation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adjacentPrefetchTargets, pageIndexFromOffset } from '../lib/photoCarousel';

const INTERVAL = 300;

// --- the active page tracks the offset continuously, not just at rest -------
{
  assert.equal(pageIndexFromOffset(0, INTERVAL, 5), 0);
  assert.equal(pageIndexFromOffset(300, INTERVAL, 5), 1);
  // Past the halfway point the NEXT page is already the active one, which is
  // what makes a settling swipe look bright before momentum finishes.
  assert.equal(pageIndexFromOffset(151, INTERVAL, 5), 1, 'past halfway the next page is active');
  assert.equal(pageIndexFromOffset(149, INTERVAL, 5), 0, 'before halfway the current page holds');
  assert.equal(pageIndexFromOffset(1200, INTERVAL, 5), 4);
}

// Boundaries: rubber-band overscroll must never produce an out-of-range page.
{
  assert.equal(pageIndexFromOffset(-80, INTERVAL, 5), 0, 'overscroll left clamps to first');
  assert.equal(pageIndexFromOffset(99_999, INTERVAL, 5), 4, 'overscroll right clamps to last');
  assert.equal(pageIndexFromOffset(0, INTERVAL, 1), 0, 'single photo has one page');
  assert.equal(pageIndexFromOffset(500, INTERVAL, 1), 0);
  assert.equal(pageIndexFromOffset(0, INTERVAL, 0), 0, 'no photos never indexes anything');
}

// Degenerate inputs must not produce NaN (which would break the counter).
{
  assert.equal(pageIndexFromOffset(Number.NaN, INTERVAL, 5), 0);
  assert.equal(pageIndexFromOffset(300, 0, 5), 0);
  assert.equal(pageIndexFromOffset(300, Number.NaN, 5), 0);
  for (const count of [0, 1, 5]) {
    assert.ok(Number.isInteger(pageIndexFromOffset(450, INTERVAL, count)));
  }
}

// --- prefetch window is bounded and direction-aware -------------------------
const five = ['a', 'b', 'c', 'd', 'e'];
{
  // Forward first: the likelier swipe direction is warmed before the previous.
  assert.deepEqual(adjacentPrefetchTargets(five, 2), ['d', 'b']);
  assert.deepEqual(adjacentPrefetchTargets(five, 0), ['b'], 'first page has no previous');
  assert.deepEqual(adjacentPrefetchTargets(five, 4), ['d'], 'last page has no next');
  // Never the centered photo — it is already on screen.
  for (let i = 0; i < five.length; i += 1) {
    assert.ok(!adjacentPrefetchTargets(five, i).includes(five[i]!), 'centered photo is not refetched');
  }
  // Bounded: one page each side by default, so at most two requests.
  for (let i = 0; i < five.length; i += 1) {
    assert.ok(adjacentPrefetchTargets(five, i).length <= 2, 'default window stays at two photos');
  }
}

// A wider radius stays bounded and ordered outward.
{
  assert.deepEqual(adjacentPrefetchTargets(five, 2, 2), ['d', 'b', 'e', 'a']);
  assert.ok(adjacentPrefetchTargets(five, 2, 99).length <= five.length - 1, 'never exceeds the album');
  assert.deepEqual(adjacentPrefetchTargets(five, 2, 0), [], 'a zero radius warms nothing');
}

// --- nothing to warm --------------------------------------------------------
{
  assert.deepEqual(adjacentPrefetchTargets(['only'], 0), [], 'one photo triggers no request');
  assert.deepEqual(adjacentPrefetchTargets([], 0), [], 'no photos triggers no request');
  assert.deepEqual(adjacentPrefetchTargets(undefined as never, 0), []);
}

// Malformed / duplicate entries never become requests.
{
  assert.deepEqual(adjacentPrefetchTargets(['a', null, 'c'], 1), ['c', 'a']);
  assert.deepEqual(adjacentPrefetchTargets(['a', 'b', '   '], 1), ['a'], 'blank urls are skipped');
  assert.deepEqual(adjacentPrefetchTargets(['dup', 'x', 'dup'], 1), ['dup'], 'duplicates collapse');
  assert.deepEqual(adjacentPrefetchTargets(['a', 'b', 'c'], 99), ['b'], 'out-of-range index clamps');
}

// --- carousel wiring contracts ---------------------------------------------
const sheet = readFileSync(
  join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'),
  'utf8',
);

assert.match(sheet, /<Animated\.FlatList/, 'the carousel is animated-capable');
assert.match(sheet, /useNativeDriver: true/, 'focus dimming runs off the JS thread');
assert.match(sheet, /onScroll=\{handleGalleryScroll\}/);
assert.match(sheet, /scrollEventThrottle=\{16\}/);
assert.match(
  sheet,
  /galleryScrollX\.interpolate\(/,
  'brightness is interpolated from scroll offset, not from React state',
);
assert.doesNotMatch(
  sheet,
  /index === safeGalleryIndex\s*\?\s*styles\.galleryPhotoShellActive/,
  'the centered page must not depend on a state comparison to look active',
);
assert.doesNotMatch(
  sheet,
  /onMomentumScrollEnd=\{\(event\) => \{[\s\S]{0,200}setGalleryIndex/,
  'the active page must not wait for momentum to end',
);
// The list identity must stay stable across swipes (remounting would refetch).
assert.match(sheet, /`gallery-\$\{galleryOpenSeed\}-\$\{photoUrls\.length\}`/);
assert.doesNotMatch(sheet, /key=\{`gallery-\$\{safeGalleryIndex/, 'never key the list by active index');
assert.match(sheet, /keyExtractor=\{\(url: string\) => `gallery-\$\{url\}`\}/, 'stable per-photo identity');
// Prefetch stays bounded and only while the gallery is open.
assert.match(sheet, /if \(!galleryOpen\) return;[\s\S]{0,120}adjacentPrefetchTargets/);
assert.match(sheet, /prefetchedPhotoUrlsRef\.current\.has\(url\)/, 'requests are deduped');

console.log('PASS photo carousel paging, bounded prefetch window, and native focus wiring');
