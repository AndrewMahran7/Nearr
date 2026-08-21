import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCOUNT_TRANSFER_TTL_MINUTES,
  ABANDONED_ANONYMOUS_TTL_DAYS,
  isAnonymousCleanupEligible,
  isAnonymousSupabaseUser,
  parseAccountTransitionResult,
} from '../lib/anonymousOnboardingCore';

assert.equal(isAnonymousSupabaseUser({ is_anonymous: true }), true);
assert.equal(isAnonymousSupabaseUser({ is_anonymous: false }), false);
assert.equal(ACCOUNT_TRANSFER_TTL_MINUTES, 24 * 60);
assert.equal(ABANDONED_ANONYMOUS_TTL_DAYS, 30);
assert.equal(isAnonymousCleanupEligible({
  isAnonymous: true,
  lifecycle: 'anonymous_active',
  lastActivityAt: '2026-07-01T00:00:00.000Z',
  now: '2026-08-19T00:00:00.000Z',
}), true);
assert.equal(isAnonymousCleanupEligible({
  isAnonymous: false,
  lifecycle: 'permanent_account',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  upgradedAt: '2026-01-01T00:00:00.000Z',
  now: '2026-08-19T00:00:00.000Z',
}), false, 'permanent users are never anonymous cleanup candidates');

assert.deepEqual(parseAccountTransitionResult({
  permanent_user_id: 'dest',
  destination_was_established: true,
  tutorial_saved_place_id: 'saved',
  replayed: true,
}), {
  permanentUserId: 'dest',
  destinationWasEstablished: true,
  tutorialSavedPlaceId: 'saved',
  replayed: true,
});

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260822000001_anonymous_onboarding_v2.sql'), 'utf8');
assert.match(migration, /auth\.jwt\(\) ->> 'is_anonymous'/);
assert.match(migration, /digest\(p_transfer_secret, 'sha256'\)/);
assert.match(migration, /for update/);
assert.match(migration, /destination_was_established/);
assert.match(migration, /update public\.analytics_events set converted_user_id/);
assert.match(migration, /converted_user_id is null or converted_user_id = auth\.uid\(\)/);
assert.match(migration, /revoke all on function public\.list_anonymous_onboarding_cleanup_candidates[\s\S]*authenticated/);
assert.doesNotMatch(migration, /grant execute on function public\.list_anonymous_onboarding_cleanup_candidates[\s\S]*authenticated/);

const runtime = readFileSync(join(process.cwd(), 'lib/anonymousOnboarding.ts'), 'utf8');
assert.match(runtime, /signInAnonymously/);
assert.match(runtime, /begin_onboarding_account_transfer/);
assert.match(runtime, /complete_onboarding_account_transfer/);
assert.doesNotMatch(runtime, /service[_-]?role/i, 'client runtime contains no service-role path');

const bridge = readFileSync(join(process.cwd(), 'lib/supabase.ts'), 'utf8');
assert.match(bridge, /session\?\.access_token/);
assert.match(bridge, /sharedAuth\.setToken/);

const createJob = readFileSync(join(process.cwd(), 'supabase/functions/create-share-job/index.ts'), 'utf8');
assert.match(createJob, /admin\.auth\.getUser\(accessToken\)/);
assert.doesNotMatch(createJob, /userData\.user\.is_anonymous[^\n]*(reject|return)/i);

const cleanup = readFileSync(join(process.cwd(), 'supabase/functions/cleanup-anonymous-onboarding/index.ts'), 'utf8');
assert.match(cleanup, /ANONYMOUS_CLEANUP_WORKER_SECRET/);
assert.match(cleanup, /user\.is_anonymous !== true/);
assert.doesNotMatch(cleanup, /from\('analytics_events'\)\.delete/);

console.log('PASS anonymous creation/resume contract');
console.log('PASS same-user and cross-user conversion contracts');
console.log('PASS transfer authorization/idempotency/analytics contracts');
console.log('PASS anonymous cleanup eligibility and retention contracts');
console.log('All anonymous Onboarding V2 tests passed.');
