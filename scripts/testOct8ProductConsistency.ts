import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const queue = read('app/share-jobs/index.tsx');
const devQa = read('app/dev-qa.tsx');
const jobDetail = read('app/share-jobs/[jobId].tsx');
const completion = read('lib/shareCompletionUi.ts');
const candidateSave = read('lib/shareJobCandidateConversion.ts');
const recentResults = read('services/shareJobsService.ts');

assert.doesNotMatch(queue, /Development previews|PHASE2_PREVIEW_FIXTURES|VAYRIN_CANDIDATE_FIXTURES/);
assert.match(devQa, /DEVELOPMENT ONLY/);
assert.match(devQa, /Read-only product previews/);
assert.match(devQa, /PHASE2_PREVIEW_FIXTURES/);
assert.match(jobDetail, /initialPhotoUrls:/, 'Quick Check passes candidate photo evidence into its image carousel');
assert.match(candidateSave, /photoUrls: candidate\.photoUrls/, 'Quick Check save carries the complete photo inventory');
assert.match(recentResults, /candidate_snapshot/, 'Recent Finds retains the result candidate image inventory');
assert.match(queue, /RecentAutoSaveImage/);
assert.match(completion, /map in the background/);
assert.match(completion, /primary: 'Done'/);
assert.match(completion, /secondary: 'Open Nearr'/);

console.log('PASS Oct 8 product-surface consistency contracts');
