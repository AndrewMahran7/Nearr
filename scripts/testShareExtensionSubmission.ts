import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CreateShareJobResult } from '../lib/shareJobClient';
import {
  shareJobResultDetail,
  shareSourceIdentity,
  shouldRecoverShareJobSubmission,
  submitShareJobWithRecovery,
} from '../lib/shareExtensionSubmission';

async function main() {
  assert.equal(
    shareSourceIdentity('https://www.instagram.com/reel/DUWyZkfgbT4/?utm_source=test'),
    'instagram:duwyzkfgbt4',
  );
  assert.equal(shareSourceIdentity('https://example.com/private/path'), 'host:example.com');

  const definite: CreateShareJobResult[] = [
    { ok: false, reason: 'invalid_url', httpStatus: 400 },
    { ok: false, reason: 'unauthorized', httpStatus: 401 },
    { ok: false, reason: 'missing_auth' },
    { ok: false, reason: 'no_endpoint' },
  ];
  for (const result of definite) assert.equal(shouldRecoverShareJobSubmission(result), false);
  for (const result of [
    { ok: false, reason: 'timeout' },
    { ok: false, reason: 'network' },
    { ok: false, reason: 'invalid_response', httpStatus: 200 },
    { ok: false, reason: 'http_error', httpStatus: 500 },
    { ok: false, reason: 'http_error', httpStatus: 429 },
  ] as CreateShareJobResult[]) assert.equal(shouldRecoverShareJobSubmission(result), true);

  const calls: string[] = [];
  const traces: string[] = [];
  const stableSubmissionId = 's_physical_recovery_1234';
  const recovered = await submitShareJobWithRecovery({
    submit: async () => {
      calls.push(stableSubmissionId);
      if (calls.length === 1) return { ok: false, reason: 'timeout' };
      return {
        ok: true, jobId: 'durable-job', status: 'queued', duplicate: true,
        requiresPurchase: false, availableUses: null,
      };
    },
    onTrace: (trace) => traces.push(`${trace.event}:${trace.detail}`),
  });
  assert.deepEqual(calls, [stableSubmissionId, stableSubmissionId]);
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.result.ok, true);
  assert.deepEqual(traces.map((trace) => trace.split(':')[0]), [
    'submit_attempt', 'submit_result', 'recovery_started', 'recovery_result',
  ]);

  let unauthorizedCalls = 0;
  const unauthorized = await submitShareJobWithRecovery({
    submit: async () => {
      unauthorizedCalls += 1;
      return { ok: false, reason: 'unauthorized', httpStatus: 401 };
    },
  });
  assert.equal(unauthorizedCalls, 1);
  assert.equal(unauthorized.attempts, 1);
  assert.equal(shareJobResultDetail(unauthorized.result), 'unauthorized:401:none');

  const extension = readFileSync(join(process.cwd(), 'ShareExtension.tsx'), 'utf8');
  assert.match(extension, /submissionPath:\s*'share_extension'/);
  assert.match(extension, /submitShareJobWithRecovery/);
  assert.match(extension, /durable_job_accepted/);
  assert.match(extension, /source_extracted/);
  assert.match(extension, /environment_checked/);
  assert.match(extension, /extension_auth_checked/);
  assert.match(extension, /Development diagnostic:/);
  assert.doesNotMatch(extension, /purchase_required|token pack|RevenueCat/i,
    'clean onboarding share extension remains free of monetization UI');

  const coach = readFileSync(
    join(process.cwd(), 'components/onboarding/v2/OnboardingV2MapCoachmark.tsx'),
    'utf8',
  );
  const map = readFileSync(join(process.cwd(), 'app/(tabs)/map.tsx'), 'utf8');
  assert.match(coach, /AppState\.addEventListener[\s\S]{0,700}void refresh\(\)/,
    'returning to the foreground refreshes the durable queue');
  assert.match(coach, /isShareJobForTutorialFixture[\s\S]{0,700}observeOnboardingV2ShareReceived/,
    'only the exact practice fixture advances receipt');
  assert.match(map, /reconcileOnboardingV2SavedPlaces\(places\)/,
    'the host reconciles saved places after the user returns');

  console.log('PASS share extension exact ingress, safe recovery, diagnostics, and no duplicate job contract');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
