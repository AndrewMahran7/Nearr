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

// --- Screen wiring: behavior preserved, hierarchy changed -------------------
const screen = readFileSync(join(process.cwd(), 'app/opportunity/[id].tsx'), 'utf8');

// 1/2. Routing + directions untouched.
assert.match(screen, /openExternalMaps\(\{/, 'uses the existing directions helper');
assert.match(screen, /trackEvent\('opportunity_get_directions_tapped'/);
// 6. Get directions is the single filled CTA.
assert.match(screen, /styles\.primaryCta/);
assert.match(screen, />Get directions</);

// 3/4. Visit decision maps onto the existing backend + analytics.
assert.match(screen, /markVisited\(saved\.id\)/);
assert.match(screen, /trackEvent\('opportunity_visited_tapped'/);
assert.match(screen, /trackEvent\('place_marked_visited'/);
assert.match(screen, />I went!</);
assert.match(screen, />Not yet</);
// Copy changed; the analytics event name is still semantically correct.
assert.match(screen, /trackEvent\('opportunity_maybe_next_time_tapped'/, 'analytics not renamed for aesthetics');

// 5. Archive-on-third preserved via the shared policy helper.
assert.match(screen, /shouldArchiveOnDecline\(saved\.reminder_opportunity_count\)/);
assert.match(screen, /markArchived\(saved\.id, \{ exhausted: true \}\)/);
assert.match(screen, /trackEvent\('opportunity_archived_after_3'/);

// 6. Reminder adjustment demoted but reachable, with its analytics intact.
assert.match(screen, /trackEvent\('opportunity_adjust_radius_tapped'/);
assert.match(screen, /styles\.reminderLink/, 'reminder settings is a low-emphasis footer link');
assert.doesNotMatch(screen, /title="Adjust reminder radius"/, 'no longer a full-width button');
assert.match(screen, /reminderLinkText: \{[\s\S]{0,120}color: colors\.textMuted/);

// The old admin framing is gone.
assert.doesNotMatch(screen, /Opportunity \{opportunityNumber\} of/, 'no "Opportunity N of 3" headline');
assert.doesNotMatch(screen, /You&apos;re near \{saved\.place\.name\}/, 'the place leads, not the reminder');

// 11. Missing photo still renders an intentional hero.
assert.match(screen, /styles\.heroFallback/);
assert.match(screen, /onError=\{\(\) => setHeroFailed\(true\)\}/);
// Reuses the shared cached rich-details helper — no new Places request here.
assert.match(screen, /getCachedPlaceRichDetails\(googlePlaceId\)/);

// 14. Closing is purely a dismissal.
{
  const start = screen.indexOf('accessibilityLabel="Close"');
  const around = screen.slice(Math.max(0, start - 320), start + 120);
  assert.ok(around.includes('router.back()'), 'close just navigates back');
  assert.ok(!/markArchived|markVisited|updateSavedPlace/.test(around), 'close never mutates the place');
}

// Theme tokens, not hard-coded to one screenshot.
assert.match(screen, /createStyles\(colors, typography\)/);
assert.match(screen, /backgroundColor: colors\.bg/);

console.log('PASS nearby-opportunity copy, honest metadata, and preserved reminder semantics');
