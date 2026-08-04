import assert from 'node:assert/strict';

import { deriveSuggestedPlaceNote, initialSavedPlaceNote } from '../lib/placeNote';

const categories = ['cafe', 'bakery', 'bar', 'restaurant', 'museum', 'park', 'store', null];
for (const category of categories) {
  const note = deriveSuggestedPlaceNote({ sourceType: 'instagram', category });
  assert.ok(note, `shared ${category ?? 'generic'} place gets a suggestion`);
  const wordCount = note.split(/\s+/).length;
  assert.ok(wordCount >= 3 && wordCount <= 10, `${category ?? 'generic'} note is 3-10 words`);
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
  'See what caught your eye here',
  'empty shared notes receive an editable suggestion',
);

console.log('PASS place-note derivation');