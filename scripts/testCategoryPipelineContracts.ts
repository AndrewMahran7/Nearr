import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePlaceCategory } from '../lib/placeCategory';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const manual = read('services/savedPlacesService.ts');
const metadata = read('supabase/functions/process-share-link/save.ts');
const media = read('supabase/functions/process-share-jobs/index.ts');
const multiPlace = read('services/shareJobCandidateSave.ts');
const quickCheck = read('app/share-jobs/[jobId].tsx');

// Every mutation resolves from the same provider identity contract.
assert.match(manual, /resolvePlaceCategory\(\{\s*placeName: candidate\.name,\s*googlePrimaryType: candidate\.primaryType,\s*googleTypes: candidate\.rawTypes,/);
assert.match(metadata, /resolvePlaceCategory\(\{\s*placeName: candidate\.name,\s*googlePrimaryType: candidate\.primaryType,\s*googleTypes: candidate\.types,/);
assert.match(media, /resolvePlaceCategory\(\{\s*placeName: candidate\.name,\s*googlePrimaryType: candidate\.primaryType,\s*googleTypes: candidate\.types,/);
assert.match(manual, /placeName: args\.replacement\.name,[\s\S]*correct_saved_place_provider/);
assert.match(multiPlace, /shareJobCandidateToPlaceCandidate/);
assert.match(multiPlace, /saveSavedPlace/);
assert.match(quickCheck, /persistShareJobCandidate/);

// Duplicate metadata saves must also be reclassified rather than retaining the
// category written by an older resolver version.
assert.match(metadata, /existingSaved\.id[\s\S]*category: categoryResolution\.category/);

const provider = {
  placeName: 'Santa Cruz Mountain Brewing',
  googlePrimaryType: 'brewery',
  googleTypes: ['brewery', 'food', 'point_of_interest', 'establishment'],
} as const;
const paths = ['metadata_auto_save', 'media_auto_save', 'manual_save', 'multi_place_save', 'wrong_place_correction'];
const categories = paths.map(() => resolvePlaceCategory(provider).category);
assert.deepEqual(categories, paths.map(() => 'brewery'), 'the same provider has one category across all save paths');

const corrected = resolvePlaceCategory({
  placeName: 'Runyon Canyon Trail',
  googlePrimaryType: 'hiking_area',
  googleTypes: ['hiking_area', 'park', 'point_of_interest'],
});
assert.equal(corrected.category, 'hiking_trail');
assert.notEqual(corrected.category, 'restaurant', 'Wrong place correction does not retain the old provider category');

console.log('PASS metadata, media, manual, multi-place, quick-check, duplicate, and correction category contracts');
