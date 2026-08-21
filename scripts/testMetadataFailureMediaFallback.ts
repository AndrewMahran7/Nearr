/**
 * scripts/testMetadataFailureMediaFallback.ts
 *
 * P0 regression: Instagram metadata failure was terminal.
 *
 * `processOne` finalized a job to `needs_help / manual_fallback` the moment
 * `fetchPostMetadata` returned `!ok`, pushed "We couldn't quite find this one",
 * and `return`ed BEFORE any media-fallback gate ran — so no `share_media_tasks`
 * row was ever inserted and the video was never analysed. When Instagram
 * tightened unauthenticated metadata access, every affected share died in ~1s
 * with `extraction_payload = { reason: 'metadata_failed' }` and
 * `candidate_payload = { candidates: [] }`.
 *
 * Invariant pinned here:
 *   metadata failure != final place-identification failure, when media
 *   fallback is available for that platform.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMetadataFailureMediaFallback.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shouldRunMediaFallbackForMetadataFailure } from '../supabase/functions/process-share-jobs/mediaFallback';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const ALL_ON = {
  mediaFallbackEnabled: true,
  instagramResolverEnabled: true,
  tiktokResolverEnabled: true,
  youtubeResolverEnabled: true,
  facebookResolverEnabled: true,
  snapchatResolverEnabled: true,
  mediaTaskExists: false,
  jobStatus: 'processing_metadata' as const,
};

// ---------------------------------------------------------------------------
// 1. The exact production shape: Instagram, metadata_failed, flags on
// ---------------------------------------------------------------------------
{
  const decision = shouldRunMediaFallbackForMetadataFailure({ ...ALL_ON, platform: 'instagram' });
  assert.equal(decision.run, true, 'Instagram metadata failure MUST attempt media fallback');
  assert.equal(decision.reason, 'metadata_unavailable_try_media');
}

// TikTok must behave identically — the fix is not Instagram-specific.
{
  const decision = shouldRunMediaFallbackForMetadataFailure({ ...ALL_ON, platform: 'tiktok' });
  assert.equal(decision.run, true, 'TikTok metadata failure also attempts media fallback');
}

// ---------------------------------------------------------------------------
// 2. Every conservative gate still applies — no new bypass was introduced
// ---------------------------------------------------------------------------
{
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      'master flag off',
      { ...ALL_ON, platform: 'instagram', mediaFallbackEnabled: false },
      'media_fallback_disabled',
    ],
    [
      'platform resolver off',
      { ...ALL_ON, platform: 'instagram', instagramResolverEnabled: false },
      'unsupported_platform',
    ],
    [
      'unsupported platform',
      { ...ALL_ON, platform: 'pinterest' },
      'unsupported_platform',
    ],
    [
      'job already terminal',
      { ...ALL_ON, platform: 'instagram', jobStatus: 'needs_help' },
      'job_not_processing',
    ],
    [
      'media task already exists (idempotent)',
      { ...ALL_ON, platform: 'instagram', mediaTaskExists: true },
      'media_task_exists',
    ],
  ];
  for (const [name, ctx, expected] of cases) {
    const decision = shouldRunMediaFallbackForMetadataFailure(ctx as never);
    assert.equal(decision.run, false, `${name} must not enqueue`);
    assert.equal(decision.reason, expected, name);
  }
}

// ---------------------------------------------------------------------------
// 3. Wiring: the branch must enqueue and PARK, never finalize+notify
// ---------------------------------------------------------------------------
{
  const src = read('supabase/functions/process-share-jobs/index.ts');
  const start = src.indexOf('const meta = await fetchPostMetadata(requestUrl, platform);');
  assert.ok(start > -1, 'the metadata fetch branch exists');
  // The branch body up to the end of the `!meta.ok` block.
  const branch = src.slice(start, src.indexOf('const { title, description, html, creatorHandle, postId } = meta.metadata;', start));

  assert.ok(
    branch.includes('shouldRunMediaFallbackForMetadataFailure('),
    'metadata failure consults the media-fallback gate',
  );
  assert.ok(branch.includes('enqueueMediaTask('), 'and enqueues a durable media task');
  assert.ok(branch.includes('mediaTaskExistsFor(admin, job.id)'), 'idempotency is checked');

  // The enqueue must happen BEFORE the terminal finalize, and must return.
  const gateAt = branch.indexOf('shouldRunMediaFallbackForMetadataFailure(');
  const finalizeAt = branch.indexOf('await finalize(');
  assert.ok(gateAt > -1 && finalizeAt > gateAt, 'the gate runs before any finalize');

  // Parking, not finalizing: no premature "We couldn't quite find this one".
  const enqueueBlock = branch.slice(branch.indexOf('if (trigger.run)'), finalizeAt);
  assert.ok(enqueueBlock.includes('parkPatch'), 'the parent is parked, not finalized');
  assert.ok(
    !enqueueBlock.includes('buildNeedsHelpNotification'),
    'no needs_help push while media fallback is still pending',
  );
  assert.ok(!enqueueBlock.includes('await finalize('), 'the job is not made terminal');
  assert.ok(enqueueBlock.includes('return;'), 'and processing stops there');

  // The terminal path still exists for genuinely unsupported cases.
  assert.ok(
    branch.includes("needs_help_reason: 'metadata_unavailable'"),
    'manual fallback still available when media fallback cannot run',
  );
  assert.ok(
    branch.includes('buildNeedsHelpNotification'),
    'and still notifies in that genuinely terminal case',
  );
}

// ---------------------------------------------------------------------------
// 4. Correctness was not loosened to achieve this
// ---------------------------------------------------------------------------
{
  const src = read('supabase/functions/process-share-jobs/index.ts');
  const start = src.indexOf('const meta = await fetchPostMetadata(requestUrl, platform);');
  const successBranch = src.indexOf('title: fetchedTitle,', start);
  assert.ok(start > -1 && successBranch > start, 'metadata failure branch boundaries are present');
  const branch = src.slice(start, successBranch);
  // No candidate is invented, and nothing is auto-saved off a failed fetch.
  assert.ok(branch.includes('candidate_payload: { candidates: [] }'), 'no invented candidates');
  assert.ok(!branch.includes('auto_save'), 'a metadata failure never auto-saves');
  assert.ok(!/searchPlaces|googlePlaceId/.test(branch), 'no provider guessing in this branch');

  // The gate module itself still refuses failures video cannot help.
  const fallback = read('supabase/functions/process-share-jobs/mediaFallback.ts');
  assert.ok(fallback.includes("'places_error'"), 'infra errors still excluded');
  assert.ok(fallback.includes("'roundup_post'"), 'roundups still excluded');
  assert.ok(
    !/NON_MEDIA_FAILURES[\s\S]{0,200}metadata_failed/.test(fallback),
    'metadata_failed is deliberately NOT excluded — video is what can fix it',
  );
}

console.log('PASS metadata failure attempts media fallback before going terminal');
