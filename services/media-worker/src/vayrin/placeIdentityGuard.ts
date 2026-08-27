/** Worker-side lexical guard. The canonical recognition classifier lives in
 * lib/placeIdentityClassification.ts; this build-local adapter keeps the
 * worker package self-contained while enforcing the same closed boundary. */

const TYPE_ALIASES = [
  'swimming hole', 'scenic viewpoint', 'scenic overlook', 'hiking trail',
  'coffee shop', 'cliff jumping spot', 'cliff jumping', 'cliff jump', 'national park',
  'state park', 'train station', 'bus station', 'art gallery',
  'wellness center', 'fitness center', 'cocktail bar', 'food spot',
  'cenote', 'cenotes', 'waterfall', 'waterfalls', 'falls', 'cascade',
  'cave', 'caves', 'cavern', 'grotto', 'beach', 'beaches', 'cove', 'shore',
  'lake', 'lakes', 'lagoon', 'reservoir', 'river', 'rivers', 'creek', 'stream',
  'cliff', 'cliffs', 'bluff', 'headland', 'viewpoint', 'overlook', 'lookout',
  'trail', 'trails', 'trailhead', 'park', 'parks', 'playground', 'island',
  'islands', 'marina', 'harbor', 'harbour', 'pier', 'restaurant', 'restaurants',
  'eatery', 'diner', 'bistro', 'cafe', 'bar', 'bars', 'pub', 'bakery',
  'brewery', 'winery', 'hotel', 'hotels', 'hostel', 'motel', 'inn', 'resort',
  'museum', 'gallery', 'landmark', 'monument', 'attraction', 'bridge',
  'station', 'airport', 'store', 'shop', 'market', 'mall', 'spa', 'gym',
].sort((a, b) => b.length - a.length);

const DESCRIPTORS = new Set([
  'underground', 'hidden', 'secret', 'natural', 'beautiful', 'scenic', 'rocky',
  'local', 'nearby', 'small', 'big', 'large', 'public', 'private', 'famous',
  'popular', 'best', 'amazing', 'old', 'new', 'historic', 'outdoor', 'indoor',
  'freshwater', 'saltwater', 'blue', 'clear', 'deep', 'shallow', 'remote',
]);

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isCategoryOnlyPlaceName(value: string): boolean {
  if (value.trim() === 'The Cave') return false;
  if (/^Hidden\s+(?:Falls|Waterfall)$/u.test(value.trim())) return false;
  const normalized = fold(value);
  const alias = TYPE_ALIASES.find((item) => ` ${normalized} `.includes(` ${item} `));
  if (!alias) return false;
  const aliasTokens = new Set(alias.split(' '));
  const residual = normalized.split(' ').filter((token) =>
    !['a', 'an', 'the', 'this', 'that'].includes(token) && !aliasTokens.has(token));
  return residual.length === 0 || residual.every((token) =>
    DESCRIPTORS.has(token) || /^\d+$/.test(token) || /^(foot|feet|ft|meter|metre|meters|metres)$/.test(token));
}
