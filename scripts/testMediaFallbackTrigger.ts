/**
 * scripts/testMediaFallbackTrigger.ts
 *
 * Unit tests for the Phase 2 media-fallback trigger
 * (supabase/functions/process-share-jobs/mediaFallback.ts). Pure module, no
 * Deno/IO, so it runs under ts-node.
 *
 * Proves: flags default OFF => never runs (Phase 1 unchanged); every documented
 * trigger and non-trigger condition; conservative-by-construction ordering.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMediaFallbackTrigger.ts
 */

import {
  shouldRunMediaFallback,
  isSupportedMediaPlatform,
  type MediaFallbackInput,
  type MediaFallbackContext,
} from '../supabase/functions/process-share-jobs/mediaFallback';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// Fully-enabled Instagram context (the only supported platform in Phase 2).
function ctx(over: Partial<MediaFallbackContext> = {}): MediaFallbackContext {
  return {
    platform: 'instagram',
    mediaFallbackEnabled: true,
    instagramResolverEnabled: true,
    mediaTaskExists: false,
    jobStatus: 'processing_metadata',
    ...over,
  };
}

function input(over: Partial<MediaFallbackInput> = {}): MediaFallbackInput {
  return {
    decision: 'manual_fallback',
    safeToAutoSave: false,
    hasPrimaryCandidate: false,
    candidateCount: 0,
    evidenceUsed: [],
    warnings: [],
    addressesCount: 0,
    failureReason: null,
    ...over,
  };
}

// ---- Flags default OFF => Phase 1 unchanged --------------------------------

{
  const r = shouldRunMediaFallback(input(), ctx({ mediaFallbackEnabled: false }));
  check('master flag off => no run', !r.run && r.reason === 'media_fallback_disabled', JSON.stringify(r));
}
{
  const r = shouldRunMediaFallback(input(), ctx({ instagramResolverEnabled: false }));
  check('IG resolver flag off => no run', !r.run && r.reason === 'unsupported_platform', JSON.stringify(r));
}
{
  // The realistic prod default: BOTH flags off.
  const r = shouldRunMediaFallback(
    input({ decision: 'manual_fallback' }),
    ctx({ mediaFallbackEnabled: false, instagramResolverEnabled: false }),
  );
  check('both flags off => no run (default prod state)', !r.run);
}

// ---- Unsupported platforms -------------------------------------------------

for (const platform of ['tiktok', 'facebook', 'youtube', 'twitter', 'genericWeb', 'unknown']) {
  const r = shouldRunMediaFallback(input(), ctx({ platform }));
  check(`platform ${platform} => no run (only Instagram in Phase 2)`, !r.run && r.reason === 'unsupported_platform');
}
{
  check('isSupportedMediaPlatform instagram+flag => true', isSupportedMediaPlatform(ctx()));
  check('isSupportedMediaPlatform instagram no-flag => false', !isSupportedMediaPlatform(ctx({ instagramResolverEnabled: false })));
  check('isSupportedMediaPlatform tiktok => false', !isSupportedMediaPlatform(ctx({ platform: 'tiktok' })));
}

// ---- Non-trigger guards ----------------------------------------------------

{
  const r = shouldRunMediaFallback(input(), ctx({ jobStatus: 'cancelled' }));
  check('cancelled job => no run', !r.run && r.reason === 'job_not_processing');
}
{
  const r = shouldRunMediaFallback(input(), ctx({ jobStatus: 'completed' }));
  check('terminal job => no run', !r.run && r.reason === 'job_not_processing');
}
{
  const r = shouldRunMediaFallback(input(), ctx({ mediaTaskExists: true }));
  check('media task already exists => no run', !r.run && r.reason === 'media_task_exists');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'auto_save', safeToAutoSave: true, hasPrimaryCandidate: true, candidateCount: 1 }),
    ctx(),
  );
  check('metadata safe auto-save => no run', !r.run && r.reason === 'metadata_auto_saved');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'multi_candidate_confirmation', candidateCount: 3 }),
    ctx(),
  );
  check('multi-candidate resolved => no run (do not delay)', !r.run && r.reason === 'multi_place_resolved');
}
{
  const r = shouldRunMediaFallback(input({ addressesCount: 2 }), ctx());
  check('two explicit addresses => no run (multi-address intent)', !r.run && r.reason === 'multi_address_evidence');
}
{
  const r = shouldRunMediaFallback(input({ decision: 'failed', failureReason: 'places_error' }), ctx());
  check('places_error => no run (infra, not media)', !r.run && r.reason === 'unrelated_failure');
}
{
  const r = shouldRunMediaFallback(input({ decision: 'manual_fallback', failureReason: 'roundup_post' }), ctx());
  check('roundup_post => no run (video cannot disambiguate)', !r.run && r.reason === 'unrelated_failure');
}
{
  // Address-verified single candidate is already strong — video adds nothing.
  const r = shouldRunMediaFallback(
    input({ decision: 'candidate_confirmation', hasPrimaryCandidate: true, candidateCount: 1, evidenceUsed: ['places_address_verified'] }),
    ctx(),
  );
  check('address-verified candidate => no run', !r.run && r.reason === 'candidate_address_verified');
}

// ---- Positive triggers -----------------------------------------------------

{
  const r = shouldRunMediaFallback(input({ decision: 'manual_fallback' }), ctx());
  check('manual_fallback => RUN', r.run && r.reason === 'manual_fallback');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'manual_fallback', failureReason: 'manual_fallback_no_explicit_place_evidence' }),
    ctx(),
  );
  check('generic caption blocked (no explicit evidence) => RUN', r.run);
}
{
  const r = shouldRunMediaFallback(input({ decision: 'failed', failureReason: 'no_candidates' }), ctx());
  check('resolver failed (recoverable) => RUN', r.run && r.reason === 'resolver_failed_media_recoverable');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'candidate_confirmation', hasPrimaryCandidate: true, candidateCount: 1, evidenceUsed: ['places_weak_match'] }),
    ctx(),
  );
  check('weak candidate_confirmation => RUN', r.run && r.reason === 'weak_candidate_confirmation');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'candidate_picker', hasPrimaryCandidate: true, candidateCount: 2 }),
    ctx(),
  );
  check('candidate_picker (weak) => RUN', r.run && r.reason === 'weak_candidate_confirmation');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'auto_save', safeToAutoSave: false, hasPrimaryCandidate: true, candidateCount: 1 }),
    ctx(),
  );
  check('auto_save that failed safety gate => RUN', r.run && r.reason === 'auto_save_gate_blocked');
}
{
  const r = shouldRunMediaFallback(
    input({ decision: 'multi_candidate_confirmation', candidateCount: 1 }),
    ctx(),
  );
  check('degenerate multi (<=1 candidate) => RUN as manual', r.run && r.reason === 'multi_degenerate_manual');
}

// ---- Ordering: safe auto-save wins even if other positive signals present --
{
  const r = shouldRunMediaFallback(
    input({ decision: 'auto_save', safeToAutoSave: true, hasPrimaryCandidate: true, candidateCount: 1, addressesCount: 0 }),
    ctx(),
  );
  check('auto-save guard precedes any positive trigger', !r.run);
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\nALL MEDIA FALLBACK TRIGGER TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
