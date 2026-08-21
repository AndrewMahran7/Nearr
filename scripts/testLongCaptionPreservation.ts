import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  normalizeSourceDescription,
  SOURCE_DESCRIPTION_RETENTION_MAX,
} from '../lib/sourceDescription';
import {
  cleanDescription,
  cleanIngestionCaption,
  SOURCE_DESCRIPTION_RETENTION_MAX as EDGE_SOURCE_DESCRIPTION_RETENTION_MAX,
} from '../supabase/functions/process-share-link/metadata/normalizeText';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import {
  mergeRetainedSourceMetadata,
  parseMediaSourceMetadata,
  sourceMetadataFromExtractionPayload,
  withRetainedSourceMetadata,
} from '../supabase/functions/process-share-jobs/mediaSourceMetadata';

assert.equal(
  EDGE_SOURCE_DESCRIPTION_RETENTION_MAX,
  SOURCE_DESCRIPTION_RETENTION_MAX,
  'host and Edge source-retention bounds agree',
);

const longNormal = [
  'A creator-written guide to neighborhood restaurants.',
  '#BestPizzaNYC #LowerEastSide',
  'Useful context. '.repeat(150).trimEnd(),
].join('\n');
assert.ok(longNormal.length > 2_000);
assert.equal(normalizeSourceDescription(longNormal), longNormal);
assert.equal(cleanIngestionCaption(longNormal), longNormal);
assert.ok((cleanDescription(longNormal)?.length ?? 0) <= 240, 'legacy preview remains bounded');

for (const length of [240, 4_000, 10_000]) {
  const input = 'ø'.repeat(length);
  assert.equal(normalizeSourceDescription(input)?.length, length, `${length} characters are retained`);
  assert.equal(cleanIngestionCaption(input)?.length, length, `${length} characters survive ingestion`);
}
assert.equal(
  cleanIngestionCaption('λ'.repeat(10_001))?.length,
  10_000,
  'source text over 10k is bounded at the retention limit',
);

const overLimit = `${'x'.repeat(SOURCE_DESCRIPTION_RETENTION_MAX - 1)}😀tail`;
const bounded = normalizeSourceDescription(overLimit)!;
assert.ok(bounded.length <= SOURCE_DESCRIPTION_RETENTION_MAX);
assert.ok(!/[\uD800-\uDBFF]$/.test(bounded), 'retention bound never splits a surrogate pair');
assert.equal(normalizeSourceDescription(bounded), bounded, 'source normalization is idempotent');

const roundup = [
  '5 places you need to try in LA',
  'Creator commentary. '.repeat(20),
  '1. Restaurant A — West Hollywood',
  '2. Restaurant B — Santa Monica',
  '3. Restaurant C — Koreatown',
  '4. Restaurant D — Silver Lake',
  '5. Restaurant E — Venice',
].join('\n');
assert.ok(roundup.indexOf('Restaurant E') > 240, 'fixture catches the former preview cap');
const normalizedRoundup = cleanIngestionCaption(roundup)!;
const handles = extractHandles({
  platform: 'instagram',
  title: null,
  description: normalizedRoundup,
  html: null,
});
const evidence = extractEvidence({
  platform: 'instagram',
  title: null,
  description: normalizedRoundup,
  handles,
  taggedLocation: null,
});
assert.match(evidence.captionText, /Restaurant E — Venice/);

const parsed = parseMediaSourceMetadata({
  title: 'LA roundup',
  description: roundup,
  creatorHandle: 'creator',
});
assert.equal(parsed?.description, roundup, 'worker callback preserves line structure');

const richer = parseMediaSourceMetadata({
  title: 'Five-place guide',
  description: `start\n${'z'.repeat(8_500)}\nlate clue`,
  creatorHandle: 'guide.author',
  postId: '7433811014237326622',
  sourceId: 'source-abc',
  creatorName: 'Guide Author',
  creatorId: 'creator-abc',
  location: 'Los Angeles, California',
});
const shorterRetry = parseMediaSourceMetadata({
  description: 'start\nshort retry',
  creatorHandle: 'guide.author',
});
const replayed = mergeRetainedSourceMetadata(richer, shorterRetry);
assert.equal(replayed?.description, richer?.description, 'retry keeps the richer retained source');
assert.deepEqual(mergeRetainedSourceMetadata(replayed, shorterRetry), replayed, 'replayed merge is idempotent');
assert.deepEqual(
  replayed && {
    title: replayed.title,
    creatorHandle: replayed.creatorHandle,
    postId: replayed.postId,
    sourceId: replayed.sourceId,
    creatorName: replayed.creatorName,
    creatorId: replayed.creatorId,
    location: replayed.location,
  },
  {
    title: 'Five-place guide',
    creatorHandle: 'guide.author',
    postId: '7433811014237326622',
    sourceId: 'source-abc',
    creatorName: 'Guide Author',
    creatorId: 'creator-abc',
    location: 'Los Angeles, California',
  },
  'replay retains title, creator, post/source identity, and location metadata',
);

const payload = withRetainedSourceMetadata(
  { title: 'old title', description: longNormal, confidence: 'medium' },
  { platform: 'instagram', via: 'media' },
  parsed,
);
assert.equal(payload.description, undefined, 'large description is not duplicated at top level');
assert.equal(sourceMetadataFromExtractionPayload(payload)?.description, roundup);
assert.equal(payload.confidence, 'medium', 'non-caption diagnostics survive finalization');

const fetchMetadata = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-link/metadata/fetchMetadata.ts'),
  'utf8',
);
assert.doesNotMatch(fetchMetadata, /cleanDescription\(/, 'metadata ingestion never calls the preview cleaner');
assert.match(fetchMetadata, /cleanIngestionCaption\(/);

const finalizer = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
assert.match(finalizer, /withRetainedSourceMetadata\(/, 'media finalization stores source metadata');
assert.match(finalizer, /finalizeParentManual\(admin, job, \{[\s\S]{0,600}\}, sourceMetadata\);/,
  'insufficient-evidence finalization also stores the caption');
assert.match(finalizer, /metadataSourceMetadata = mergeRetainedSourceMetadata\(/,
  'metadata retries retain and reuse the richer caption');
assert.match(finalizer, /metadataSourceMetadata,\s*\n\s*\);/,
  'metadata finalization durably stores the canonical source block');

const synchronousRouter = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-link/index.ts'),
  'utf8',
);
assert.match(synchronousRouter, /persistSourceEvidenceSnapshot\(/,
  'legacy synchronous extraction reuses share_jobs as durable evidence storage');
assert.match(synchronousRouter, /await persistSourceEvidence\(saved\.savedPlaceId\)/,
  'direct synchronous saves associate the durable snapshot with the saved place');
assert.match(synchronousRouter, /idempotencyKey = `source-evidence:\$\{args\.canonicalUrl\}`/,
  'synchronous retries update one canonical source snapshot');

console.log('PASS long caption retention, roundup evidence, replay, and durable media payload contracts');
