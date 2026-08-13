import assert from 'node:assert/strict';

import {
  browseFilterCount,
  buildSavedPlacesBrowseResults,
  filterSavedPlaces,
  formatBrowseDistance,
  hasOriginalVideo,
  savedPlaceNotePreview,
  searchSavedPlaces,
  sortSavedPlaces,
  type SavedBrowseFilters,
} from '../lib/savedPlacesBrowse';
import { CATEGORY_LABELS, savedPlaceCategory } from '../lib/placeCategory';
import type { SavedPlaceWithPlace } from '../types';

function place(args: {
  id: string;
  createdAt: string;
  category?: any;
  primaryType?: string | null;
  sourceType?: any;
  sourceUrl?: string | null;
  address?: string;
  notes?: string | null;
  aiNote?: string | null;
  archived?: boolean;
}): SavedPlaceWithPlace {
  return {
    id: args.id, user_id: 'u1', place_id: `p-${args.id}`,
    radius_value: null, radius_unit: null, notes: args.notes ?? null, ai_note: args.aiNote ?? null,
    source_type: args.sourceType ?? 'manual', source_url: args.sourceUrl ?? null,
    notifications_enabled: false, last_notified_at: null, notification_count: 0,
    reminder_opportunity_count: 0, archived_at: args.archived ? args.createdAt : null,
    visited_at: null, reminders_exhausted_at: null, category: args.category ?? null,
    created_at: args.createdAt, updated_at: args.createdAt,
    place: {
      id: `p-${args.id}`, google_place_id: `gp-${args.id}`, name: args.id,
      formatted_address: args.address ?? `${args.id}, Anaheim, CA`, latitude: 33, longitude: -117,
      category: null, google_primary_type: args.primaryType ?? null, google_types: null,
      google_maps_url: null, created_at: args.createdAt,
    },
  } as SavedPlaceWithPlace;
}

const restaurant = place({ id: 'Older Restaurant', createdAt: '2026-08-01T00:00:00Z', category: 'restaurant', notes: 'Order the birria' });
const cafe = place({ id: 'New Cafe', createdAt: '2026-08-10T00:00:00Z', primaryType: 'coffee_shop', sourceType: 'instagram', sourceUrl: 'https://www.instagram.com/reel/Cafe/' });
const hotel = place({ id: 'Lake Hotel', createdAt: '2026-08-05T00:00:00Z', category: 'hotel', sourceType: 'link', sourceUrl: 'https://youtu.be/HotelVideo', aiNote: 'Quiet rooms by the lake' });
const mapsLink = place({ id: 'Maps Link', createdAt: '2026-08-04T00:00:00Z', category: 'restaurant', sourceType: 'link', sourceUrl: 'https://maps.google.com/?cid=123' });
const archived = place({ id: 'Archived', createdAt: '2026-08-11T00:00:00Z', category: 'park', archived: true });
const all = [restaurant, cafe, hotel, archived];
const none: SavedBrowseFilters = { categories: [], hasVideo: false };

// Default Recent and cache updates.
assert.deepEqual(sortSavedPlaces([restaurant, cafe, hotel], 'recent').map((p) => p.id), ['New Cafe', 'Lake Hotel', 'Older Restaurant']);
assert.equal(buildSavedPlacesBrowseResults({ places: all, query: '', filters: none, sort: 'recent' })[0]!.id, 'New Cafe');
const realtime = place({ id: 'Realtime Save', createdAt: '2026-08-12T23:00:00Z', category: 'cafe' });
assert.equal(buildSavedPlacesBrowseResults({ places: [realtime, ...all], query: '', filters: none, sort: 'recent' })[0]!.id, 'Realtime Save');
assert.ok(!buildSavedPlacesBrowseResults({ places: all, query: '', filters: none, sort: 'recent' }).some((p) => p.id === 'Archived'));

// Nearby nearest first, missing coordinates last, and unavailable location preserves Recent.
const nearby = [{ ...restaurant, distanceMeters: 3200 }, { ...cafe, distanceMeters: 400 }];
assert.deepEqual(
  buildSavedPlacesBrowseResults({ places: all, nearbyPlaces: nearby, nearbyReady: true, query: '', filters: none, sort: 'nearby' }).map((p) => p.id),
  ['New Cafe', 'Older Restaurant', 'Lake Hotel'],
);
assert.deepEqual(
  buildSavedPlacesBrowseResults({ places: all, nearbyPlaces: [], nearbyReady: false, query: '', filters: none, sort: 'nearby' }).map((p) => p.id),
  ['New Cafe', 'Lake Hotel', 'Older Restaurant'],
);

// Filters compose and clear.
assert.deepEqual(filterSavedPlaces(all, { categories: ['restaurants'], hasVideo: false }).map((p) => p.id), ['Older Restaurant']);
assert.equal(hasOriginalVideo(cafe), true);
assert.equal(hasOriginalVideo(hotel), true, 'supported YouTube source counts');
assert.equal(hasOriginalVideo(mapsLink), false, 'Google Maps URL is not an original video');
assert.equal(hasOriginalVideo(restaurant), false);
assert.deepEqual(filterSavedPlaces(all, { categories: ['cafes'], hasVideo: true }).map((p) => p.id), ['New Cafe']);
assert.equal(browseFilterCount({ categories: ['cafes', 'hotels'], hasVideo: true }), 3);
assert.deepEqual(filterSavedPlaces(all, none), all, 'Clear filters restores input');

// Search: name, locality, automatic category, notes, casing, clear, and composition.
assert.deepEqual(searchSavedPlaces(all, 'new cafe').map((p) => p.id), ['New Cafe']);
assert.deepEqual(searchSavedPlaces(all, 'ANAHEIM').map((p) => p.id), all.map((p) => p.id));
assert.deepEqual(searchSavedPlaces(all, 'Cafe').map((p) => p.id), ['New Cafe']);
assert.deepEqual(searchSavedPlaces(all, 'BIRRIA').map((p) => p.id), ['Older Restaurant']);
assert.deepEqual(searchSavedPlaces(all, '  '), all);
assert.deepEqual(buildSavedPlacesBrowseResults({ places: all, query: 'cafe', filters: { categories: ['cafes'], hasVideo: true }, sort: 'nearby', nearbyPlaces: nearby, nearbyReady: true }).map((p) => p.id), ['New Cafe']);

// Automatic presentation never exposes raw provider types.
assert.equal(savedPlaceCategory(cafe), 'cafe');
assert.equal(CATEGORY_LABELS[savedPlaceCategory(cafe)], 'Cafe');
assert.notEqual(CATEGORY_LABELS[savedPlaceCategory(cafe)], 'coffee_shop');
assert.deepEqual(savedPlaceNotePreview(restaurant), { text: 'Order the birria', kind: 'user' });
assert.deepEqual(savedPlaceNotePreview(hotel), { text: 'Quiet rooms by the lake', kind: 'post' });
assert.equal(savedPlaceNotePreview(cafe), null);
assert.equal(formatBrowseDistance(400), '0.2 mi');
assert.equal(formatBrowseDistance(32_187), '20 mi');
assert.equal(formatBrowseDistance(undefined), null);

// Removing/correcting is naturally reflected by the keyed cache input; duplicate IDs collapse.
assert.ok(!buildSavedPlacesBrowseResults({ places: [cafe, hotel], query: '', filters: none, sort: 'recent' }).some((p) => p.id === restaurant.id));
const corrected = { ...restaurant, place: { ...restaurant.place, name: 'Correct Restaurant', google_place_id: 'gp-correct' } };
const correctedResults = buildSavedPlacesBrowseResults({ places: [corrected, restaurant, cafe], query: '', filters: none, sort: 'recent' });
assert.equal(correctedResults.filter((p) => p.id === restaurant.id).length, 1);
assert.equal(correctedResults.find((p) => p.id === restaurant.id)?.place.name, 'Correct Restaurant');

console.log('PASS Saved Places pipeline, Recent/Nearby, filters, search, presentation, and cache-state behavior');
