/**
 * scripts/testOpportunityUi.ts
 *
 * The nearby-opportunity screen: place-first presentation, honest metadata,
 * and — critically — the three-opportunity reminder semantics surviving the
 * copy change from "Maybe next time" to "Not yet".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_OPPORTUNITIES,
  businessStatusLabel,
  opportunityCopy,
  opportunityMetaChips,
  opportunityNarrative,
  opportunityNumberFor,
  shouldArchiveOnDecline,
  sourcePostLabel,
} from '../lib/opportunityUi';
import type { SavedPlaceWithPlace } from '../types';

const place = (patch: Record<string, unknown> = {}): SavedPlaceWithPlace =>
  ({
    id: 'saved-1',
    ai_note: null,
    notes: null,
    source_type: 'instagram',
    source_url: null,
    reminder_opportunity_count: 1,
    category: 'restaurant',
    place: {
      id: 'place-1',
      name: 'Keno’s Restaurant',
      formatted_address: '123 Main St, San Clemente, CA 92672, USA',
      latitude: 33.42,
      longitude: -117.61,
      category: 'restaurant',
      business_status: 'OPERATIONAL',
    },
    ...patch,
  }) as unknown as SavedPlaceWithPlace;

// --- 5. Third decline still archives; earlier ones do not -------------------
{
  assert.equal(MAX_OPPORTUNITIES, 3, 'the three-opportunity policy is unchanged');
  assert.equal(shouldArchiveOnDecline(1), false);
  assert.equal(shouldArchiveOnDecline(2), false);
  assert.equal(shouldArchiveOnDecline(3), true, 'the third decline exhausts the reminder');
  assert.equal(shouldArchiveOnDecline(4), true, 'a delivery overshoot still archives');
  assert.equal(shouldArchiveOnDecline(0), false);
  assert.equal(shouldArchiveOnDecline(null), false);
  assert.equal(shouldArchiveOnDecline(undefined), false);
}

// --- Opportunity number is clamped for display -----------------------------
{
  assert.equal(opportunityNumberFor(1), 1);
  assert.equal(opportunityNumberFor(3), 3);
  assert.equal(opportunityNumberFor(9), 3, 'never displays beyond the policy');
  assert.equal(opportunityNumberFor(0), 1);
  assert.equal(opportunityNumberFor(null), 1);
}

// --- Copy leads with the place, not with reminder bookkeeping ---------------
{
  for (const n of [1, 2, 3]) {
    const copy = opportunityCopy(n);
    assert.equal(copy.eyebrow, "You're nearby");
    assert.equal(copy.decisionPrompt, 'Did you visit?');
    assert.doesNotMatch(copy.eyebrow, /opportunity|\d of \d/i, 'no reminder-policy framing');
  }
  // The count still matters on the LAST one — surfaced as consequence, not guilt.
  assert.equal(opportunityCopy(1).finalNote, null);
  assert.equal(opportunityCopy(2).finalNote, null);
  const final = opportunityCopy(3).finalNote;
  assert.ok(final && /quiet reminders/i.test(final), 'the final opportunity explains what happens');
  assert.doesNotMatch(final!, /last chance|failed|should have/i, 'no pressure or guilt');
}

// --- 12/13. Metadata is honest and adapts to non-restaurants ----------------
{
  assert.deepEqual(opportunityMetaChips(place()), ['Restaurant', 'San Clemente, CA']);

  // A beach is not a restaurant: no price level, no invented fields.
  const beach = place({ category: 'beach', place: { ...place().place, category: 'beach' } });
  assert.ok(opportunityMetaChips(beach).includes('Beach'));

  // business_status is the one honest "should I go right now" signal we hold.
  const closed = place({ place: { ...place().place, business_status: 'CLOSED_TEMPORARILY' } });
  assert.ok(opportunityMetaChips(closed).includes('Temporarily closed'));
  assert.equal(businessStatusLabel('CLOSED_PERMANENTLY'), 'Permanently closed');
  assert.equal(businessStatusLabel('OPERATIONAL'), null, 'open places get no chip');
  assert.equal(businessStatusLabel(null), null);
  assert.equal(businessStatusLabel('SOMETHING_NEW'), null, 'unknown status is never shown');

  // No address → the chip is simply omitted, never blank.
  const noAddress = place({ place: { ...place().place, formatted_address: null } });
  const chips = opportunityMetaChips(noAddress);
  assert.ok(chips.every((c) => c.trim().length > 0));
  assert.ok(!chips.includes(''));

  // Degenerate rows must not throw.
  assert.deepEqual(opportunityMetaChips(null), []);
  assert.deepEqual(opportunityMetaChips(undefined), []);
  assert.doesNotThrow(() => opportunityMetaChips({ place: null } as never));
}

// --- 7-10. Optional context is present or omitted, never a placeholder ------
{
  const full = opportunityNarrative(
    place({ ai_note: 'Best breakfast burrito in OC.', notes: 'Try the chilaquiles', source_url: 'https://instagram.com/p/x' }),
  );
  assert.equal(full.savedBecause, 'Best breakfast burrito in OC.');
  assert.equal(full.userNote, 'Try the chilaquiles');
  assert.equal(full.sourceUrl, 'https://instagram.com/p/x');

  const bare = opportunityNarrative(place());
  assert.equal(bare.savedBecause, null, 'absent note omits the section entirely');
  assert.equal(bare.userNote, null);
  assert.equal(bare.sourceUrl, null);

  // Whitespace-only values count as absent.
  const blank = opportunityNarrative(place({ ai_note: '   ', notes: '\n', source_url: '  ' }));
  assert.equal(blank.savedBecause, null);
  assert.equal(blank.userNote, null);
  assert.equal(blank.sourceUrl, null);
  assert.deepEqual(opportunityNarrative(null), { savedBecause: null, userNote: null, sourceUrl: null });
}

// --- Source label uses consumer language, never a raw URL -------------------
{
  assert.equal(sourcePostLabel('instagram'), 'Watch original reel');
  assert.equal(sourcePostLabel('tiktok'), 'Watch original post');
  assert.equal(sourcePostLabel('link'), 'Open original link');
  assert.equal(sourcePostLabel(null), 'View original');
  for (const t of ['instagram', 'tiktok', 'link', null]) {
    assert.doesNotMatch(sourcePostLabel(t), /http|www\./, 'never renders a URL');
  }
}

// --- The single-place opportunity SCREEN is retired ------------------------
// Nearr now has one canonical answer to "show me this saved place": the
// map-owned Place Detail V2. `/opportunity/[id]` is kept only so ALREADY
// DELIVERED notifications and old deep links still resolve — it redirects into
// that one detail owner instead of maintaining a second presentation.
const screen = readFileSync(join(process.cwd(), 'app/opportunity/[id].tsx'), 'utf8');

assert.match(screen, /Redirect/, 'the legacy route redirects rather than rendering a screen');
assert.match(screen, /resolveOpenSavedPlaceRoute/, 'through the one validated navigation contract');
assert.match(screen, /savedPlaceId: savedPlaceId \?\? null/, 'by exact saved_places.id');
assert.match(screen, /reminderOpen: 'true'/, 'and lands on the EXPANDED Place Detail V2');

// No duplicated presentation or duplicated mutations may survive here.
for (const duplicated of [
  'markVisited',
  'markArchived',
  'openExternalMaps',
  'getCachedPlaceRichDetails',
  'updateSavedPlace',
]) {
  assert.ok(!screen.includes(duplicated), `${duplicated} must not be duplicated in the legacy route`);
}
assert.ok(screen.length < 2_000, 'the 599-line duplicate screen is gone');

// The capabilities it carried still exist — in the canonical owner.
{
  const detail = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
  assert.ok(detail.includes('onGetDirections'), 'directions preserved in Place Detail V2');
  assert.ok(detail.includes('markVisited(saved.id)'), '"I went" preserved in Place Detail V2');
  assert.ok(detail.includes('visited.prompt'), 'the did-you-go prompt lives there');

  // Reminder LIFECYCLE (archive-on-third-decline) is not place detail, and V2's
  // "Not yet" is deliberately inert — so it must stay reachable on the map.
  const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  assert.match(map, />= MAX_REMINDER_OPPORTUNITIES/, 'archive-on-third policy still applied');
  assert.match(map, /markArchived\(selected\.id, \{ exhausted: true \}\)/, 'exhaustion still stamped');
  assert.match(map, /handleNearbyReminderDismiss\(\)/, 'and still reachable from the UI');
  assert.match(map, /trackEvent\('opportunity_archived_after_3'/, 'analytics preserved');
}

console.log('PASS nearby-opportunity copy, honest metadata, and preserved reminder semantics');
