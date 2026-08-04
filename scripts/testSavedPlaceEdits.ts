import assert from 'node:assert/strict';

import { applySavedPlaceEdit } from '../lib/savedPlaceEdits';
import type { SavedPlaceWithPlace } from '../types';

const saved = {
  id: 'saved-1',
  notifications_enabled: true,
  radius_value: null,
  radius_unit: null,
  notes: null,
  place: { id: 'place-1', name: 'Test Place' },
} as SavedPlaceWithPlace;

const disabled = applySavedPlaceEdit(saved, { notifications_enabled: false });
assert.equal(disabled.notifications_enabled, false, 'explicit false must survive cache hydration');
assert.equal(disabled.notes, null, 'omitted fields keep their persisted value');
assert.equal(disabled.place, saved.place, 'place identity remains stable');

const edited = applySavedPlaceEdit(saved, {
  notifications_enabled: false,
  radius_value: 2,
  radius_unit: 'miles',
  notes: 'Try the patio',
});
assert.deepEqual(
  {
    notifications_enabled: edited.notifications_enabled,
    radius_value: edited.radius_value,
    radius_unit: edited.radius_unit,
    notes: edited.notes,
  },
  {
    notifications_enabled: false,
    radius_value: 2,
    radius_unit: 'miles',
    notes: 'Try the patio',
  },
);

console.log('PASS saved-place edit hydration');