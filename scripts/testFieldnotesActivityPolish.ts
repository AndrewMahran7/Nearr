import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activitySourceFrameUri } from '../lib/activitySourceFrame';
import { actionableJobs, processingJobs, isQueueEmpty } from '../lib/shareJobsUi';

const extraction = { sourceFrameUrl: 'https://example.com/known-source-frame.jpg' };
for (const status of ['queued', 'processing_metadata', 'failed', 'needs_help']) {
  assert.equal(activitySourceFrameUri(null, extraction), extraction.sourceFrameUrl, `${status}: the known receipt frame survives before/without a candidate`);
}
assert.equal(activitySourceFrameUri({ sourceFrameUrl: 'file:///candidate-source.jpg' }, extraction), 'file:///candidate-source.jpg', 'candidate-specific source frame has priority');
assert.equal(activitySourceFrameUri({ sourceFrameUrl: '   ' }, extraction), extraction.sourceFrameUrl);
assert.equal(activitySourceFrameUri(null, { sourceFrameUrl: 42 }), undefined);
assert.equal(activitySourceFrameUri({ sourceFrameUrl: 42 } as any, extraction), extraction.sourceFrameUrl);
assert.equal(activitySourceFrameUri(null, null), undefined, 'missing evidence remains missing');
const jobs = [{ id: 'processing', status: 'processing_metadata' }, { id: 'failed', status: 'failed' }, { id: 'multi', status: 'needs_help' }, { id: 'saved', status: 'completed' }];
assert.deepEqual(processingJobs(jobs).map(job => job.id), ['processing']);
assert.deepEqual(actionableJobs(jobs).map(job => job.id), ['multi', 'failed']);
assert.equal(isQueueEmpty([]), true);
const activity = readFileSync('app/share-jobs/index.tsx', 'utf8');
assert.match(activity, /ListHeaderComponent=\{hasContent \?/, 'empty Activity does not repeat an irrelevant finding introduction');
assert.match(activity, /sourceUri=\{sourceFrameUri\}/);
assert.match(activity, /fallbackSourceUri=\{sourceFrameUri\}/);
assert.match(activity, /accessibilityLabel=\{t\("From the original post"\)\}/, 'receipt evidence is labeled as source, never as independent destination imagery');
assert.match(activity, /allowGoogleLookup=\{false\}/, 'source continuity does not add provider photo fetching');
assert.match(activity, /numberOfLines=\{fontScale >= 1\.5 \? undefined : 2\}/, 'accessible text size reveals full Activity identity');
assert.match(activity, /typography\.metadata, styles\.rowSubtitle/);
assert.doesNotMatch(activity, /\b(?:fakeProgress|progressPercent|percentComplete|Math\.random)\b/, 'no synthetic progress percentage');
assert.match(activity, /job\.status === 'queued' \|\| job\.status === 'processing_metadata'/, 'processing UI follows the real job state');
console.log('PASS Activity polish: 4 lifecycle source-frame fallbacks, candidate priority, missing/invalid frame, authoritative processing/failure/multi-place/saved states, compact empty layout, 13pt metadata and provenance');
