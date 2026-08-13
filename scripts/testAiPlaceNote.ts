import assert from 'node:assert/strict';

import { generateAiPlaceNote, preserveUserNote } from '../lib/aiPlaceNote';

assert.equal(
  generateAiPlaceNote({
    placeName: 'Los de Juarez Burritos',
    category: 'restaurant',
    evidence: ['Known for birria burritos and bottled Mexican sodas'],
  }),
  'Known for birria burritos and bottled Mexican sodas.',
);
assert.equal(
  generateAiPlaceNote({
    placeName: 'Some Place',
    evidence: ['1101 W Lincoln Ave, Anaheim, CA'],
  }),
  null,
  'an address alone is not a useful note',
);
assert.equal(
  generateAiPlaceNote({ placeName: 'Some Place', evidence: ['great'] }),
  null,
  'generic unsupported language is not shown as AI context',
);
assert.equal(
  generateAiPlaceNote({ placeName: 'June Lake Loop Trail', evidence: ['Scenic lake stop with mountain views'] }),
  'Scenic lake stop with mountain views.',
);
assert.deepEqual(
  preserveUserNote(' My exact note ', 'Generated context.'),
  { notes: 'My exact note', aiNote: 'Generated context.' },
  'user notes and AI context remain separate',
);
assert.deepEqual(
  preserveUserNote('My exact note', null),
  { notes: 'My exact note', aiNote: null },
  'missing AI context never changes a user note',
);

console.log('PASS AI note generation is concise, source-grounded, and user-note safe');
