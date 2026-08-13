import assert from 'node:assert/strict';

import { deriveSuggestedPlaceNote, initialSavedPlaceNote } from '../lib/placeNote';

const categories = ['cafe', 'bakery', 'bar', 'restaurant', 'museum', 'park', 'store', null];
for (const category of categories) {
  const note = deriveSuggestedPlaceNote({ sourceType: 'instagram', category });
  assert.equal(note, null, `provider/category metadata does not create a ${category ?? 'generic'} note`);
}

assert.equal(
  deriveSuggestedPlaceNote({ sourceType: 'manual', category: 'restaurant' }),
  null,
  'manual saves do not invent post context',
);
assert.equal(
  initialSavedPlaceNote({
    notes: 'My exact edited note',
    sourceType: 'tiktok',
    category: 'cafe',
  }),
  'My exact edited note',
  'existing notes are never replaced',
);
assert.equal(
  initialSavedPlaceNote({ notes: '', sourceType: 'link', category: 'museum' }),
  '',
  'empty shared notes stay empty instead of impersonating user writing',
);

console.log('PASS place-note derivation');
