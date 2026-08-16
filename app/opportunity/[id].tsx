/**
 * Legacy nearby-opportunity route.
 *
 * Route: `/opportunity/[id]` where `id` is `saved_places.id`. This used to be a
 * dedicated single-place nearby screen with its own hero, directions button and
 * "I went!" / "Not yet" actions.
 *
 * Nearr now has ONE canonical answer to "show me this saved place" — the
 * map-owned Place Detail V2 sheet — reached identically from the Map, the
 * Queue, Home, and a nearby notification. Every capability this screen carried
 * lives there now: Directions, "Did you go yet?", reminder settings, the source
 * post, and removal. Keeping a second single-place UI would have meant two
 * presentations drifting apart.
 *
 * The route itself is kept (not deleted) so ALREADY-DELIVERED notifications and
 * old deep links still resolve. It resolves the exact `saved_places.id` and
 * replaces into the canonical detail flow — no duplicated UI, no name or
 * coordinate matching, no fresh provider lookup.
 *
 * `resolveOpenSavedPlaceRoute` mints a single-use `openRequestId`, so a legacy
 * link opens the same place again on a later tap (the latch fixed in 82eac44).
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';

export default function NearbyOpportunityRedirect() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const savedPlaceId = Array.isArray(id) ? id[0] : id;

  const target = resolveOpenSavedPlaceRoute({
    savedPlaceId: savedPlaceId ?? null,
    source: 'notification',
  });

  return (
    <Redirect
      href={{
        pathname: target.pathname,
        // `reminderOpen` is what makes the map open the detail EXPANDED, so a
        // legacy nearby link lands on the full Place Detail V2 rather than the
        // collapsed preview card.
        params: { ...target.params, reminderOpen: 'true', reminderSource: 'notification' },
      }}
    />
  );
}
