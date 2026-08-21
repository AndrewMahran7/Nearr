import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeFacebookMetadata } from '../supabase/functions/process-share-link/metadata/facebookMetadata';
import {
  cleanDescription,
  cleanIngestionCaption,
} from '../supabase/functions/process-share-link/metadata/normalizeText';

const useful =
  'Five places to eat in Orange County: Pho House, Harbor Coffee, Mesa Bakery. ' +
  '#orangecounty #foodguide 📍 Costa Mesa, California';
const normalized = normalizeFacebookMetadata({
  title: '2.8M views · 1.3K reactions | Five places to eat in Orange County | Facebook',
  description: useful,
});
assert.equal(normalized.title, 'Five places to eat in Orange County');
assert.equal(normalized.description, useful);
assert.match(normalized.description!, /#orangecounty/);
assert.match(normalized.description!, /Costa Mesa/);

assert.deepEqual(
  normalizeFacebookMetadata({
    title: 'A complete creator caption with a venue | Example Page',
    description: 'A complete creator caption with a venue',
  }),
  {
    title: 'A complete creator caption with a venue',
    description: 'A complete creator caption with a venue',
  },
);

for (const generic of [
  'See posts, photos and more on Facebook.',
  'Log into Facebook to start sharing and connecting with your friends.',
  'Create an account or log in to Facebook to continue.',
]) {
  assert.equal(normalizeFacebookMetadata({ title: 'Facebook', description: generic }).description, null);
}

const longCaption = `${'Venue clue and neighborhood. '.repeat(20)}${'x'.repeat(300)}`;
assert.ok(longCaption.length > 240);
assert.equal(cleanIngestionCaption(longCaption)?.length, longCaption.length);
assert.match(cleanIngestionCaption(longCaption)!, /x{100}/);

const bounded = cleanIngestionCaption('y'.repeat(12_000));
assert.equal(bounded?.length, 10_000);
assert.ok((cleanDescription(longCaption)?.length ?? 0) <= 240, 'legacy preview cleaner remains bounded');

assert.deepEqual(normalizeFacebookMetadata({ title: null, description: null }), {
  title: null,
  description: null,
});

const asyncWorkerSource = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
assert.match(
  asyncWorkerSource,
  /sourceMetadata:\s*\{\s*title,\s*description,/,
  'metadata jobs durably retain the bounded public caption',
);
assert.match(
  asyncWorkerSource,
  /sourceMetadata:\s*persistedSourceMetadata/,
  'media jobs durably retain the resolver caption and public identity',
);

console.log('17 Facebook metadata assertions passed.');
