/**
 * scripts/testRelatedPlaces.ts
 *
 * Two ways one saved place can be related to another, and they are not the
 * same relationship:
 *
 *   From this video — you saved these out of the SAME post. Semantic, exact,
 *                     and not bounded by distance.
 *   Also nearby     — these happen to be close. Geographic, distance-ranked,
 *                     with a modest nudge away from category monotony.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testRelatedPlaces.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALSO_NEARBY_DIVERSITY_DETOUR_METERS,
  ALSO_NEARBY_LIMIT,
  savedPlaceDistanceMeters,
  selectAlsoNearby,
} from '../lib/alsoNearby';
import { SAME_SOURCE_LIMIT, selectSameSourcePlaces } from '../lib/sameSourcePlaces';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const REEL = 'https://www.instagram.com/reel/NicaraguaTrip/';
const OTHER_REEL = 'https://www.instagram.com/reel/CostaRicaTrip/';

type SP = {
  id: string;
  source_url?: string | null;
  created_at?: string | null;
  category?: string | null;
  place: { name: string; latitude?: number | null; longitude?: number | null };
};

const place = (
  id: string,
  name: string,
  extra: Partial<SP> & { lat?: number; lng?: number } = {},
): SP => ({
  id,
  source_url: extra.source_url ?? null,
  created_at: extra.created_at ?? null,
  category: extra.category ?? null,
  place: { name, latitude: extra.lat ?? null, longitude: extra.lng ?? null },
});

// One reel, four Nicaraguan destinations, saved in the order the resolver
// emitted them. Hundreds of km apart.
const OMETEPE = place('sp-ometepe', 'Ometepe Island', {
  source_url: REEL, created_at: '2026-08-01T10:00:00.000Z', lat: 11.5, lng: -85.6,
});
const GRANADA = place('sp-granada', 'Granada', {
  source_url: REEL, created_at: '2026-08-01T10:00:01.000Z', lat: 11.93, lng: -85.95,
});
const SAN_JUAN = place('sp-sjds', 'San Juan del Sur', {
  source_url: REEL, created_at: '2026-08-01T10:00:02.000Z', lat: 11.25, lng: -85.87,
});
const LEON = place('sp-leon', 'León', {
  source_url: REEL, created_at: '2026-08-01T10:00:03.000Z', lat: 12.43, lng: -86.88,
});

// ---------------------------------------------------------------------------
// 1. From this video — the Nicaragua fixture
// ---------------------------------------------------------------------------
{
  const all = [OMETEPE, GRANADA, SAN_JUAN, LEON];
  const siblings = selectSameSourcePlaces(GRANADA, all);

  assert.deepEqual(
    siblings.map((s) => s.place.name),
    ['Ometepe Island', 'San Juan del Sur', 'León'],
    'the other destinations from the same reel, in the order they were saved',
  );
  assert.ok(
    !siblings.some((s) => s.id === GRANADA.id),
    'the place you are looking at is never in its own list',
  );
  // The whole point: this relationship ignores distance. León is ~150km from
  // Granada — far outside the Also Nearby radius — and is still a sibling.
  const leonDistance = savedPlaceDistanceMeters(GRANADA, LEON)!;
  assert.ok(leonDistance > 80_000, `León is ${Math.round(leonDistance / 1000)}km away`);
  assert.ok(siblings.some((s) => s.id === LEON.id), 'and is still shown');
}

// ---------------------------------------------------------------------------
// 2. Source identity is exact — never "same creator", "same day", "same city"
// ---------------------------------------------------------------------------
{
  const otherReel = place('sp-other', 'Tamarindo', {
    source_url: OTHER_REEL,
    created_at: '2026-08-01T10:00:01.500Z', // saved between two siblings
    lat: 11.9, lng: -85.9,                  // and right next door
  });
  const siblings = selectSameSourcePlaces(GRANADA, [GRANADA, LEON, otherReel]);
  assert.deepEqual(siblings.map((s) => s.id), ['sp-leon'], 'a different reel is not a sibling');

  // Harmless tracking params must not split one reel into two.
  const tracked = place('sp-tracked', 'Masaya', {
    source_url: `${REEL}?igshid=abc123&utm_source=ig_web_copy_link`,
    created_at: '2026-08-01T10:00:04.000Z',
  });
  assert.ok(
    selectSameSourcePlaces(GRANADA, [GRANADA, tracked]).some((s) => s.id === 'sp-tracked'),
    'the same reel matches itself across tracking params',
  );

  // Platforms cannot collide: same path, different host.
  const tiktok = place('sp-tiktok', 'Somewhere', {
    source_url: 'https://www.tiktok.com/reel/NicaraguaTrip/',
    created_at: '2026-08-01T10:00:05.000Z',
  });
  assert.deepEqual(
    selectSameSourcePlaces(GRANADA, [GRANADA, tiktok]),
    [],
    'an identical path on another platform is a different post',
  );
}

// ---------------------------------------------------------------------------
// 3. No section rather than an empty one
// ---------------------------------------------------------------------------
{
  // Manual save: no source at all, so no group can be fabricated.
  const manual = place('sp-manual', 'Corner Cafe', { lat: 11.9, lng: -85.9 });
  const otherManual = place('sp-manual-2', 'Corner Bakery', { lat: 11.9, lng: -85.9 });
  assert.deepEqual(
    selectSameSourcePlaces(manual, [manual, otherManual]),
    [],
    'two sourceless saves are not siblings of each other',
  );
  assert.deepEqual(selectSameSourcePlaces(GRANADA, [GRANADA]), [], 'a one-place source has none');
  assert.deepEqual(selectSameSourcePlaces(null, [GRANADA]), []);
  assert.deepEqual(selectSameSourcePlaces(GRANADA, null), []);
  assert.deepEqual(
    selectSameSourcePlaces(place('sp-blank', 'X', { source_url: '   ' }), [GRANADA]),
    [],
    'whitespace is not a source',
  );
}

// A sibling the user has REMOVED is simply absent from the collection, so it
// stops being offered. Nothing reaches back into historical share results.
{
  const remaining = [GRANADA, OMETEPE, SAN_JUAN]; // León deleted
  const siblings = selectSameSourcePlaces(GRANADA, remaining);
  assert.ok(!siblings.some((s) => s.id === LEON.id), 'a removed sibling is not resurrected');
  assert.equal(siblings.length, 2);
}

// Deduped by exact saved_places.id, and bounded.
{
  assert.equal(selectSameSourcePlaces(GRANADA, [GRANADA, LEON, LEON, LEON]).length, 1);
  const many = Array.from({ length: 20 }, (_, i) =>
    place(`sp-${i}`, `P${i}`, { source_url: REEL, created_at: `2026-08-01T10:00:${String(i).padStart(2, '0')}.000Z` }),
  );
  assert.equal(selectSameSourcePlaces(GRANADA, many).length, SAME_SOURCE_LIMIT, 'bounded row');
}

// Never a provider lookup.
{
  const src = read('lib/sameSourcePlaces.ts');
  assert.ok(!/fetch\(|googleapis|placesService|searchText/.test(src), 'no discovery calls');
  assert.ok(src.includes('isSameSourceUrl'), 'reuses the provenance predicate');
  assert.ok(src.includes('normalizeShareUrl'), 'and the existing canonicalizer');
  // This task consumes provenance; it must not rewrite the merge policy.
  const merge = read('lib/savedPlaceSourceMerge.ts');
  for (const outcome of ['attached', 'already_attached', 'existing_source_preserved']) {
    assert.ok(merge.includes(`'${outcome}'`), `${outcome} merge semantics still present`);
  }
}

// ---------------------------------------------------------------------------
// 4. Also nearby excludes the siblings shown above it
// ---------------------------------------------------------------------------
{
  // A tight cluster so everything is genuinely "nearby".
  const anchor = place('a', 'Anchor', { source_url: REEL, lat: 33.7455, lng: -117.8677, category: 'beach' });
  const sib = place('b', 'Sibling', { source_url: REEL, lat: 33.7460, lng: -117.8690, category: 'cafe' });
  const near = place('c', 'Neighbour', { lat: 33.7470, lng: -117.8700, category: 'restaurant' });

  const siblings = selectSameSourcePlaces(anchor, [anchor, sib, near]);
  assert.deepEqual(siblings.map((s) => s.id), ['b']);

  const nearby = selectAlsoNearby(anchor, [anchor, sib, near], {
    excludeIds: siblings.map((s) => s.id),
  });
  assert.deepEqual(
    nearby.map((e) => e.saved.id),
    ['c'],
    'a place under "From this video" is not repeated under "Also nearby"',
  );

  // Without the exclusion it WOULD have appeared — proving the guard is live.
  assert.equal(selectAlsoNearby(anchor, [anchor, sib, near]).length, 2);
}

// ---------------------------------------------------------------------------
// 5. Category diversity — modest, deterministic, distance-safe
// ---------------------------------------------------------------------------
const categoryOf = (p: SP) => p.category ?? null;

// The brief's own example. Anchor is a beach; three beaches by distance would
// waste every visible card saying the same thing.
{
  const mi = (m: number) => m * 1609.344;
  const at = (id: string, name: string, category: string, miles: number) =>
    place(id, name, {
      category,
      lat: 33.7455 + miles / 69, // ~69 miles per degree of latitude
      lng: -117.8677,
    });
  const anchor = place('anchor', 'Anchor Beach', { category: 'beach', lat: 33.7455, lng: -117.8677 });
  const pool = [
    anchor,
    at('b1', 'Beach A', 'beach', 0.4),
    at('c1', 'Cafe', 'cafe', 0.6),
    at('r1', 'Burger', 'restaurant', 0.8),
    at('b2', 'Beach B', 'beach', 0.9),
    at('s1', 'Surf shop', 'shopping', 1.1),
    at('b3', 'Beach C', 'beach', 1.2),
  ];

  const plain = selectAlsoNearby(anchor, pool).map((e) => e.saved.id);
  assert.deepEqual(plain, ['b1', 'c1', 'r1', 'b2', 's1', 'b3'], 'distance order, unchanged');

  const diverse = selectAlsoNearby(anchor, pool, { categoryOf }).map((e) => e.saved.id);
  assert.deepEqual(
    diverse.slice(0, 3),
    ['c1', 'r1', 's1'],
    'the three visible cards each say something new',
  );
  assert.deepEqual(
    diverse.slice(3),
    ['b1', 'b2', 'b3'],
    'and the beaches still follow, in distance order — nothing is dropped',
  );
  assert.equal(diverse.length, plain.length, 'diversity reorders, it never filters');
  assert.deepEqual(
    selectAlsoNearby(anchor, pool, { categoryOf }).map((e) => e.saved.id),
    diverse,
    'deterministic: same input, same row',
  );
  void mi;
}

// Distance wins a real contest. A far cafe must not displace a near restaurant.
{
  const anchor = place('anchor', 'Anchor', { category: 'beach', lat: 33.7455, lng: -117.8677 });
  const nearRestaurant = place('near', 'Near restaurant', {
    category: 'restaurant', lat: 33.7455 + 0.3 / 69, lng: -117.8677,
  });
  const farCafe = place('far', 'Far cafe', {
    category: 'cafe', lat: 33.7455 + 35 / 69, lng: -117.8677,
  });

  const row = selectAlsoNearby(anchor, [anchor, nearRestaurant, farCafe], { categoryOf });
  assert.equal(row[0].saved.id, 'near', 'a 0.3 mi restaurant beats a 35 mi cafe');
  assert.ok(
    row[1].distanceMeters - row[0].distanceMeters > ALSO_NEARBY_DIVERSITY_DETOUR_METERS,
    'the far one was outside the detour budget',
  );
}

// The budget is absolute, not a ratio — the failure mode a ratio would allow.
{
  const anchor = place('anchor', 'Anchor', { category: 'beach', lat: 0, lng: 0 });
  const sameCatNear = place('n', 'Beach', { category: 'beach', lat: 0.001, lng: 0 });
  const newCatJustInside = place('in', 'Cafe', { category: 'cafe', lat: 0.02, lng: 0 });
  const inside = savedPlaceDistanceMeters(anchor, newCatJustInside)!;
  assert.ok(inside < ALSO_NEARBY_DIVERSITY_DETOUR_METERS, 'fixture is inside the budget');
  assert.equal(
    selectAlsoNearby(anchor, [anchor, sameCatNear, newCatJustInside], { categoryOf })[0].saved.id,
    'in',
    'inside the budget, a new category leads',
  );

  const newCatOutside = place('out', 'Cafe', { category: 'cafe', lat: 0.09, lng: 0 });
  assert.ok(savedPlaceDistanceMeters(anchor, newCatOutside)! > ALSO_NEARBY_DIVERSITY_DETOUR_METERS);
  assert.equal(
    selectAlsoNearby(anchor, [anchor, sameCatNear, newCatOutside], { categoryOf })[0].saved.id,
    'n',
    'outside it, distance wins',
  );
}

// Degenerate inputs stay safe, and the radius/limit are untouched by this task.
{
  const anchor = place('anchor', 'Anchor', { category: 'beach', lat: 0, lng: 0 });
  const noCategory = place('x', 'X', { lat: 0.001, lng: 0 });
  assert.equal(
    selectAlsoNearby(anchor, [anchor, noCategory], { categoryOf }).length,
    1,
    'a candidate with no category is still eligible',
  );
  assert.equal(ALSO_NEARBY_LIMIT, 6, 'the cap is unchanged');
  const far = place('far', 'Far', { category: 'cafe', lat: 5, lng: 5 });
  assert.equal(
    selectAlsoNearby(anchor, [anchor, far], { categoryOf }).length,
    0,
    'the ~50 mile radius is unchanged — diversity cannot reach past it',
  );
}

// ---------------------------------------------------------------------------
// 6. Wiring: two sections, one card design, one navigation path
// ---------------------------------------------------------------------------
{
  const detail = read('components/map/SelectedPlaceDetails.tsx');

  assert.ok(detail.includes('selectSameSourcePlaces(saved, allSavedPlaces'), 'uses the selector');
  assert.ok(
    detail.includes('excludeIds: sameSourceIds'),
    'and hands the siblings to Also nearby as exclusions',
  );
  assert.ok(detail.includes('categoryOf: savedPlaceCategory'), 'diversity uses the normalized category');

  // Same compact card component for both rows — no new sibling card style.
  assert.equal(
    detail.split('<PlaceCardRow').length - 1,
    3,
    'saved relationships and recommendations use the accepted PlaceCardRow',
  );
  assert.ok(
    detail.indexOf('sourceAttribution.siblingSectionTitle') < detail.indexOf('title="Also nearby"'),
    'From this video sits ABOVE Also nearby',
  );
  // Both rows select by the exact saved row, through the same callback a marker
  // tap uses. Two occurrences: one per row.
  assert.equal(
    detail.split('onSelectNearby?.(').length - 1,
    2,
    'siblings navigate exactly like nearby cards',
  );
  assert.ok(!detail.includes("router.push('/place/"), 'no second detail route');
  // The section is gated on real attribution, so a manual save renders nothing.
  assert.match(detail, /sameSourceEntries\.length > 0 && sourceAttribution \? \(/);
}

// Platform-truthful heading.
{
  const source = read('lib/placeSource.ts');
  assert.equal(
    source.split("siblingSectionTitle: 'From this video'").length - 1,
    5,
    'the video platforms say video',
  );
  assert.ok(
    source.includes("siblingSectionTitle: 'From this post'"),
    'a generic link is honestly called a post, not a video',
  );
}

console.log('PASS related places: same-source siblings, no duplication, distance-safe diversity');
