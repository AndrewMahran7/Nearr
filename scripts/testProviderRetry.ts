/**
 * scripts/testProviderRetry.ts
 *
 * The provider-error vs provider-result boundary.
 *
 * A transient dependency failure (Google Places 429/5xx/timeout) must park the
 * job for a bounded retry; a successful provider response that simply found
 * nothing must go to the user. Collapsing those two is what turned a Google
 * outage into "search for the place yourself".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RESOLVER_RETRY_MAX_SECONDS,
  classifyResolverFailure,
  formatResolverRetryLog,
  planResolverRetry,
} from '../supabase/functions/process-share-jobs/providerRetry';

const retryOf = (outcome: Parameters<typeof classifyResolverFailure>[0]) =>
  planResolverRetry({
    failureClass: classifyResolverFailure(outcome),
    attempts: 1,
    maxAttempts: 5,
    retryAfterSeconds: outcome?.retryAfterSeconds ?? null,
    random: () => 0.5,
  });

// --- 1-3. Google Places 429 / 500 / timeout + network -> retry --------------
{
  // googlePlaces maps a non-OK HTTP status to reason 'http_error' and a
  // fetch/timeout rejection to the same, both surfaced as `places_http_error`.
  for (const warning of ['places_http_error', 'places_api_error']) {
    const outcome = { decision: 'failed', failureReason: 'places_error', candidateCount: 0, warnings: [warning] };
    assert.equal(classifyResolverFailure(outcome), 'transient_provider', warning);
    assert.equal(retryOf(outcome).action, 'retry', `${warning} retries`);
  }
  // The failure reason alone is enough even without warnings.
  assert.equal(
    classifyResolverFailure({ failureReason: 'places_error', candidateCount: 0 }),
    'transient_provider',
  );
}

// --- 4. Successful search with zero results -> DO NOT retry -----------------
{
  for (const reason of ['no_candidates', 'no_match', 'no_business_near_address', 'no_candidates_near_address']) {
    const outcome = { decision: 'manual_fallback', failureReason: reason, candidateCount: 0, warnings: [] };
    assert.equal(classifyResolverFailure(outcome), 'deterministic', reason);
    assert.equal(retryOf(outcome).action, 'degrade', `${reason} goes to the user`);
  }
  // A real no-match must not be rescued by an unrelated stale warning.
  assert.equal(
    classifyResolverFailure({ failureReason: 'no_match', candidateCount: 0, warnings: ['places_http_error'] }),
    'deterministic',
    'an explicit no-match reason wins over a stale transient warning',
  );
}

// --- 5-8. Model / transcription providers ----------------------------------
{
  for (const reason of ['model_provider_error', 'extraction_provider_error', 'transcription_provider_error']) {
    assert.equal(classifyResolverFailure({ failureReason: reason, candidateCount: 0 }), 'transient_provider', reason);
  }
  // A model that successfully answered "not enough evidence" is a RESULT.
  for (const reason of ['insufficient_evidence', 'rejected_insufficient_evidence', 'ambiguous', 'name_mismatch']) {
    assert.equal(classifyResolverFailure({ failureReason: reason, candidateCount: 0 }), 'deterministic', reason);
  }
}

// --- 13. Candidates + a real provider fault: preserve AND keep retrying -----
{
  // Address verification hit a provider fault, the resolver fell through to a
  // plain search and produced 2 unverified candidates. Replaying the failed
  // verification can still yield a verified single match, so the job is NOT
  // finalized into a picker yet. Parking finalizes nothing, so the candidates
  // are preserved either way.
  const improvable = {
    decision: 'candidate_picker',
    candidateCount: 2,
    warnings: ['address_verify_provider_error'],
  };
  assert.equal(
    classifyResolverFailure(improvable),
    'transient_provider',
    'candidates do not suppress a retry that could still disambiguate them',
  );
  assert.equal(retryOf(improvable).action, 'retry');

  // ...but a result that is ALREADY auto-savable is the best possible outcome.
  // Retrying would only delay the save.
  const best = {
    decision: 'auto_save',
    candidateCount: 1,
    warnings: ['address_verify_provider_error'],
  };
  assert.equal(classifyResolverFailure(best), 'deterministic', 'never stall an auto-savable result');
  assert.equal(retryOf(best).action, 'degrade');
}

// --- 3. Deterministic ambiguity must not trigger a pointless provider retry -
{
  // Two genuinely plausible places, every provider call succeeded. Replaying
  // the identical successful request returns the identical two candidates.
  const genuineAmbiguity = {
    decision: 'candidate_picker',
    candidateCount: 2,
    warnings: ['address_present_but_no_verified_business'],
  };
  assert.equal(classifyResolverFailure(genuineAmbiguity), 'deterministic');
  assert.equal(retryOf(genuineAmbiguity).action, 'degrade', 'no retry without an actual provider fault');
  assert.equal(classifyResolverFailure({ decision: 'multi_candidate_confirmation', candidateCount: 3 }), 'deterministic');
}

// --- 4. Once candidates exist they are never retried away ------------------
{
  // index.ts floors candidateCount with persistedCandidateCount(job), so a
  // degraded later attempt returning zero cannot restart the retry loop and
  // lose what an earlier attempt already found.
  const floored = Math.max(0, /* persisted */ 2);
  assert.equal(
    classifyResolverFailure({ failureReason: 'places_error', candidateCount: floored }),
    'transient_provider',
    'still retryable while attempts remain',
  );
  const spent = planResolverRetry({
    failureClass: classifyResolverFailure({ failureReason: 'places_error', candidateCount: floored }),
    attempts: 5,
    maxAttempts: 5,
  });
  assert.equal(spent.action, 'degrade', 'exhaustion routes the preserved candidates to the picker');
}

// --- Unknown reasons default to asking the user, never to a retry loop ------
{
  assert.equal(classifyResolverFailure({ failureReason: 'brand_new_reason', candidateCount: 0 }), 'deterministic');
  assert.equal(classifyResolverFailure({}), 'deterministic');
  assert.equal(classifyResolverFailure(null), 'deterministic');
  assert.equal(classifyResolverFailure(undefined), 'deterministic');
}

// --- 14-15. Exhaustion -----------------------------------------------------
{
  const transient = { failureClass: 'transient_provider' as const, random: () => 0.5 };
  // One claim must remain, otherwise the job parks where claim_share_jobs
  // (attempts < max_attempts) can never pick it up again.
  assert.equal(planResolverRetry({ ...transient, attempts: 4, maxAttempts: 5 }).action, 'retry');
  const spent = planResolverRetry({ ...transient, attempts: 5, maxAttempts: 5 });
  assert.equal(spent.action, 'degrade');
  assert.equal(spent.action === 'degrade' && spent.reason, 'attempts_exhausted');
  assert.equal(planResolverRetry({ ...transient, attempts: 9, maxAttempts: 5 }).action, 'degrade');
  // Deterministic failures never retry regardless of budget.
  const det = planResolverRetry({ failureClass: 'deterministic', attempts: 1, maxAttempts: 5 });
  assert.equal(det.action === 'degrade' && det.reason, 'not_transient');
}

// --- Backoff shape: bounded, growing, jittered, Retry-After aware ----------
{
  const base = { failureClass: 'transient_provider' as const, maxAttempts: 99, random: () => 0.5 };
  const d1 = planResolverRetry({ ...base, attempts: 1 });
  const d2 = planResolverRetry({ ...base, attempts: 2 });
  const d3 = planResolverRetry({ ...base, attempts: 3 });
  assert.ok(d1.action === 'retry' && d2.action === 'retry' && d3.action === 'retry');
  assert.ok(d2.delaySeconds > d1.delaySeconds, 'backoff grows');
  assert.ok(d3.delaySeconds > d2.delaySeconds);
  // Bounded, and never zero (a zero delay would be a retry storm).
  for (let attempt = 1; attempt < 40; attempt += 1) {
    for (const random of [0, 0.5, 0.999]) {
      const plan = planResolverRetry({ ...base, attempts: attempt, random: () => random });
      assert.ok(plan.action === 'retry');
      assert.ok(plan.delaySeconds >= 1, 'never schedules an immediate retry');
      assert.ok(plan.delaySeconds <= RESOLVER_RETRY_MAX_SECONDS, 'always capped');
    }
  }
  // Jitter actually varies the delay.
  const low = planResolverRetry({ ...base, attempts: 3, random: () => 0 });
  const high = planResolverRetry({ ...base, attempts: 3, random: () => 0.999 });
  assert.ok(low.action === 'retry' && high.action === 'retry' && high.delaySeconds > low.delaySeconds);

  // A provider Retry-After is honored, but a hostile one cannot park a job.
  const honored = planResolverRetry({ ...base, attempts: 1, retryAfterSeconds: 120 });
  assert.ok(honored.action === 'retry' && honored.delaySeconds >= 120);
  const hostile = planResolverRetry({ ...base, attempts: 1, retryAfterSeconds: 999_999 });
  assert.ok(hostile.action === 'retry' && hostile.delaySeconds <= RESOLVER_RETRY_MAX_SECONDS);
  // Garbage values fall back to the computed backoff.
  for (const bad of [Number.NaN, -5, 0, null, undefined]) {
    const plan = planResolverRetry({ ...base, attempts: 1, retryAfterSeconds: bad as number });
    assert.ok(plan.action === 'retry' && plan.delaySeconds >= 1);
  }
}

// --- Diagnostics are low-cardinality and secret-free ------------------------
{
  const line = formatResolverRetryLog({
    jobId: 'job-1',
    step: 'metadata_places',
    failureClass: 'transient_provider',
    failureCode: 'places_error',
    plan: { action: 'retry', delaySeconds: 20, attempt: 1 },
    attempts: 1,
    maxAttempts: 5,
  });
  assert.match(line, /class=transient_provider/);
  assert.match(line, /attempts=1\/5/);
  assert.match(line, /retry_in_s=20/);
  assert.doesNotMatch(line, /key=|token|Bearer|https?:\/\//i, 'never logs secrets or URLs');
}

// --- Source contracts -------------------------------------------------------
const places = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-link/places/googlePlaces.ts'),
  'utf8',
);
// The address verifier must no longer report transport failures as a no-match.
assert.doesNotMatch(
  places,
  /if \(!res\.ok\) \{\s*\n\s*return \{ status: 'failed', reason: 'no_business_near_address'/,
  'an HTTP failure is no longer reported as "no business near address"',
);
assert.match(places, /reason: 'provider_error'/, 'provider faults have their own reason');
assert.match(places, /status !== 'OK' && status !== 'ZERO_RESULTS'/, 'ZERO_RESULTS stays a real answer');

const job = readFileSync(
  join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
assert.match(job, /classifyResolverFailure\(\{/, 'the metadata path classifies before routing');
assert.ok(
  job.indexOf('classifyResolverFailure({') < job.indexOf('const plan = planFromResolverDecision({\n    decision: metadataResult.decision'),
  'classification happens BEFORE the job is routed to the user',
);
// 16. Cancellation safety + 17. no duplicate finalize: the retry park is
// guarded on the row still being in processing_metadata.
assert.match(
  job,
  /locked_until: addSecondsIso\(retryPlan\.delaySeconds\)[\s\S]{0,900}\.eq\('status', 'processing_metadata'\)/,
  'a retry can never resurrect a cancelled or already-terminal job',
);
// Candidates found on an earlier attempt are parked on the row so a degraded
// later attempt cannot erase them, and floor the classifier's candidate count.
assert.match(job, /candidate_payload: buildCandidateReviewSnapshot\(/, 'park preserves candidates');
assert.match(
  job,
  /Math\.max\(metadataResult\.candidates\.length, alreadyPersistedCandidates\)/,
  'once candidates exist they are never retried away',
);

// --- Concern 2: the persisted lease is what actually gates the reclaim ------
const claimSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260731000001_share_jobs.sql'),
  'utf8',
);
// The park writes now + the CALCULATED delay, not a fixed generic lease.
assert.match(
  job,
  /locked_until: addSecondsIso\(retryPlan\.delaySeconds\)/,
  'locked_until is the calculated backoff, not a constant',
);
assert.doesNotMatch(
  job,
  /locked_until: addSecondsIso\((?:120|300|600)\)/,
  'no generic multi-minute lease overrides the calculated delay',
);
// claim_share_jobs re-claims a processing_metadata row the moment its lease
// expires, so a shorter locked_until genuinely pulls the retry earlier.
assert.match(
  claimSql,
  /c\.status = 'processing_metadata' and c\.locked_until is not null and c\.locked_until < now\(\)/,
  'an expired lease on a processing row is reclaimable',
);
// attempts advance on claim, and the claim refuses once the budget is spent.
assert.match(claimSql, /attempts = sj\.attempts \+ 1/, 'attempts advance on every claim');
assert.match(claimSql, /where c\.attempts < c\.max_attempts/, 'max attempts stops the reclaim');
// The sweep cadence is the real quantization on the schedule.
const workerSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260731000003_share_jobs_worker.sql'),
  'utf8',
);
assert.match(
  workerSql,
  /'process-share-jobs-sweep',[\s\S]{0,40}'\* \* \* \* \*'/,
  'sweep runs every minute — the real quantization on the retry schedule',
);

console.log('PASS provider failure classification, bounded retry, and metadata-path wiring');
