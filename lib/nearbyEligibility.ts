/**
 * Nearr — category-aware nearby notification radius + eligibility decision.
 *
 * WHY THIS EXISTS
 * ----------------
 * Before this module, every saved place used the SAME flat radius: an
 * explicit per-place override if the user set one, otherwise the user's one
 * global "Default reminder distance" from Settings. A 3-mile cafe and a
 * 40-mile national park were treated identically. This module replaces that
 * flat default with a deterministic per-category radius, and separates
 * "is this place close enough to be a candidate" (radius) from "should we
 * actually notify" (eligibility): entering a radius makes a place ELIGIBLE,
 * not sent.
 *
 * SCOPE
 * -----
 * Pure, deterministic, no I/O. This module does not read AsyncStorage or
 * Supabase, does not know how cooldowns are persisted, and does not compute
 * distances — callers pass in already-resolved distances and suppression
 * signals. That keeps it trivially unit-testable and keeps the existing
 * cooldown/dedupe machinery in `lib/notifications.ts` as the single owner of
 * persisted state.
 *
 * WHERE THE DEFAULT USED TO COME FROM
 * ------------------------------------
 * `effectiveRadiusMeters()` in `lib/notifications.ts` still honors an
 * explicit per-place radius first. When a place has none, it now resolves
 * the category radius below instead of the profile's flat default — see
 * that function's comment for the reasoning. The Settings screen and the
 * place-detail "Default" label still describe `profile.default_radius_value`
 * verbatim; updating that copy is a UI change and was deliberately left out
 * of this pass (flagged as a follow-up in the PR notes).
 */

import { milesToMeters } from './geo';
import { isNearrCategory, type NearrCategory } from './placeCategory';

// ---------------------------------------------------------------------------
// Category-aware radius
// ---------------------------------------------------------------------------

export type NearbyRadiusBucket = 'food' | 'everyday' | 'outdoor' | 'destination';

/**
 * Product hypotheses (V1). Nothing else in the app hardcodes these numbers —
 * retune here and every caller picks it up.
 */
export const NEARBY_RADIUS_MILES: Readonly<Record<NearbyRadiusBucket, number>> = {
  food: 3,
  everyday: 4,
  outdoor: 6,
  destination: 10,
};

/** Bucket used for 'other' and any category with no clear "worth a longer trip" signal. */
export const DEFAULT_NEARBY_RADIUS_BUCKET: NearbyRadiusBucket = 'everyday';

/**
 * Every `NearrCategory` mapped to exactly one radius bucket. The `satisfies`
 * clause makes this exhaustive at compile time: adding a category to
 * `NEARR_CATEGORIES` without updating this map fails `tsc`, rather than
 * silently falling through to the wrong radius.
 *
 * Hotels/resorts intentionally get no dedicated logic yet (per product ask)
 * — conservative "everyday" default until there's a real hypothesis for
 * lodging-specific proximity behavior.
 */
export const CATEGORY_RADIUS_BUCKET = {
  // Food & drink — quick, close-by stops.
  restaurant: 'food',
  cafe: 'food',
  bakery: 'food',
  bar: 'food',
  brewery: 'food',
  dessert: 'food',
  // Stays — conservative default, no dedicated hypothesis yet.
  hotel: 'everyday',
  resort: 'everyday',
  // Outdoor nature spots worth a short drive.
  park: 'outdoor',
  beach: 'outdoor',
  waterfall: 'outdoor',
  lake: 'outdoor',
  marina: 'outdoor',
  island: 'outdoor',
  scenic_spot: 'outdoor',
  // Destination-worthy — things people plan a trip around.
  winery: 'destination',
  hiking_trail: 'destination',
  attraction: 'destination',
  museum: 'destination',
  entertainment: 'destination',
  nightlife: 'destination',
  sports: 'destination',
  // Everyday / unclear.
  shopping: 'everyday',
  fitness: 'everyday',
  wellness: 'everyday',
  transportation: 'everyday',
  education: 'everyday',
  service: 'everyday',
  other: 'everyday',
} satisfies Record<NearrCategory, NearbyRadiusBucket>;

export function getNearbyNotificationRadiusBucket(
  category: NearrCategory | string | null | undefined,
): NearbyRadiusBucket {
  if (!isNearrCategory(category)) return DEFAULT_NEARBY_RADIUS_BUCKET;
  return CATEGORY_RADIUS_BUCKET[category];
}

/** The category-aware default radius, in miles. */
export function getNearbyNotificationRadiusMiles(
  category: NearrCategory | string | null | undefined,
): number {
  return NEARBY_RADIUS_MILES[getNearbyNotificationRadiusBucket(category)];
}

/** The category-aware default radius, in meters — what distance-check/geofence APIs consume. */
export function getNearbyNotificationRadiusMeters(
  category: NearrCategory | string | null | undefined,
): number {
  return milesToMeters(getNearbyNotificationRadiusMiles(category));
}

/**
 * Resolve the already-classified category for a reminder-path place.
 *
 * Deliberately does not re-run classification (name / Google-type
 * heuristics) — that already happened once at save time
 * (`resolvePlaceCategory` in `lib/placeCategory.ts`) and is persisted, DB
 * check-constrained, on `saved_places.category`. The reminder engine only
 * ever reads that stored, deterministic value; an unset or invalid value
 * (legacy rows saved before categorization existed) resolves to `'other'`.
 */
export function resolveReminderPlaceCategory(saved: {
  category?: NearrCategory | string | null;
}): NearrCategory {
  return isNearrCategory(saved.category) ? saved.category : 'other';
}

// ---------------------------------------------------------------------------
// "Clearly not actionable" — closed suppression
// ---------------------------------------------------------------------------

/**
 * Google `business_status` values that mean "do not send someone here."
 *
 * Deliberately does NOT attempt live "closed right now" hours: Nearr does
 * not cache `opening_hours`/`utc_offset` on `places` today (see
 * `lib/placeHours.ts`, which needs both and has neither available in the
 * reminder path), and fetching them on every location tick would mean a
 * network call from the background location/geofence path — exactly what
 * this module must not do. Live hours suppression is a documented
 * follow-up, not implemented here. Unknown status is never treated as
 * closed — only a reliable, already-cached "not operating" signal is.
 */
const NOT_ACTIONABLE_BUSINESS_STATUSES = new Set(['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY']);

export function isPlaceReliablyClosed(businessStatus: string | null | undefined): boolean {
  return typeof businessStatus === 'string' && NOT_ACTIONABLE_BUSINESS_STATUSES.has(businessStatus);
}

// ---------------------------------------------------------------------------
// Eligibility decision
// ---------------------------------------------------------------------------

export type NearbyEligibilityReason =
  | 'eligible'
  | 'outside_radius'
  | 'visited'
  | 'closed'
  | 'recently_notified';

export type NearbyEligibilityInput = {
  distanceMeters: number;
  radiusMeters: number;
  /**
   * True when the place is already marked visited. In production, visited
   * places are filtered out of the reminder set before they ever reach here
   * (the `saved_places` query and the offline snapshot both exclude
   * `visited_at is not null`) — this is a defensive second check, directly
   * testable, not a second source of truth.
   */
  isVisited?: boolean;
  /** True when a cooldown or lifetime notification-count cap already blocks a send. */
  isRecentlyNotified: boolean;
  /** True when `business_status` says the place is closed permanently or temporarily. */
  isReliablyClosed: boolean;
};

export type NearbyEligibilityResult =
  | { eligible: true; reason: 'eligible' }
  | { eligible: false; reason: Exclude<NearbyEligibilityReason, 'eligible'> };

/**
 * The whole "is this place a notification candidate" decision, in one place.
 *
 * Radius determines eligibility; eligibility does not automatically mean
 * notify — a caller still has to run this candidate through
 * `selectNearbyNotificationWinner` against everything else eligible in the
 * same evaluation cycle before actually sending.
 */
export function evaluateNearbyNotificationEligibility(
  input: NearbyEligibilityInput,
): NearbyEligibilityResult {
  if (input.isVisited) return { eligible: false, reason: 'visited' };
  if (input.distanceMeters > input.radiusMeters) {
    return { eligible: false, reason: 'outside_radius' };
  }
  if (input.isReliablyClosed) return { eligible: false, reason: 'closed' };
  if (input.isRecentlyNotified) return { eligible: false, reason: 'recently_notified' };
  return { eligible: true, reason: 'eligible' };
}

// ---------------------------------------------------------------------------
// Winner selection — at most one notification per evaluation cycle
// ---------------------------------------------------------------------------

export type NearbyWinnerCandidate = { distanceMeters: number };

export type NearbyWinnerSelection<T> = {
  winner: T | null;
  /** Everyone else, nearest-first — each implicitly "lost_to_nearer_candidate". */
  losers: T[];
};

/**
 * Pick a single winner among places eligible in the SAME evaluation cycle.
 *
 * No reliable "open right now" signal is available (see
 * `isPlaceReliablyClosed` above — only permanently/temporarily-closed is
 * known, not live hours), so ranking is nearest-eligible-wins, per the V1
 * product decision to avoid a speculative "actionability" score.
 */
export function selectNearbyNotificationWinner<T extends NearbyWinnerCandidate>(
  candidates: readonly T[],
): NearbyWinnerSelection<T> {
  if (candidates.length === 0) return { winner: null, losers: [] };
  const sorted = [...candidates].sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { winner: sorted[0], losers: sorted.slice(1) };
}
