import assert from 'node:assert/strict';

import { browseFilterCount, filterSavedPlaces, hasOriginalVideo, sortSavedPlaces } from '../lib/savedPlacesBrowse';
import type { SavedPlaceWithPlace } from '../types';

function place(id: string, createdAt: string, category: any, sourceType: any = 'manual'): SavedPlaceWithPlace {
  return {
    id,
    user_id: 'u1',
    place_id: `p-${id}`,
    radius_value: null,
    radius_unit: null,
    notes: null,
    ai_note: null,
    source_type: sourceType,
    source_url: sourceType === 'manual' ? null : `https://${sourceType}.com/post/${id}`,
    notifications_enabled: false,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    category,
    created_at: createdAt,
    updated_at: createdAt,
    place: {
      id: `p-${id}`,
      google_place_id: `gp-${id}`,
      name: id,
      formatted_address: `${id}, Anaheim, CA`,
      latitude: 33,
      longitude: -117,
      google_maps_url: null,
      created_at: createdAt,
    },
  } as SavedPlaceWithPlace;
}

const older = place('Older Restaurant', '2026-08-01T00:00:00Z', 'restaurant', 'manual');
const newer = place('New Cafe', '2026-08-10T00:00:00Z', 'cafe', 'instagram');
const hotel = place('Lake Hotel', '2026-08-05T00:00:00Z', 'hotel', 'tiktok');

assert.deepEqual(sortSavedPlaces([older, newer, hotel], 'recent').map((p) => p.id), ['New Cafe', 'Lake Hotel', 'Older Restaurant']);
assert.equal(hasOriginalVideo(newer), true);
assert.equal(hasOriginalVideo(older), false);
assert.deepEqual(filterSavedPlaces([older, newer, hotel], { category: 'cafes', hasVideo: false }).map((p) => p.id), ['New Cafe']);
assert.deepEqual(filterSavedPlaces([older, newer, hotel], { category: null, hasVideo: true }).map((p) => p.id), ['New Cafe', 'Lake Hotel']);
assert.equal(browseFilterCount({ category: 'hotels', hasVideo: true }), 2);

console.log('PASS saved places Recent/Nearby sorting, category filters, and Has video filter');
