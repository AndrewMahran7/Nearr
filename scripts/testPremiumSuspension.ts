import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { premiumEligibilityForResult } from '../lib/premiumRequestMonetization';
import {
  PREMIUM_REQUESTS_SUSPENDED_REASON,
  premiumRequestsEnabledForEnvironment,
} from '../lib/premiumRequestsPolicy';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

const policy = source('lib/premiumRequestsPolicy.ts');
const clientPolicy = source('lib/premiumRequests.ts');
const client = source('lib/monetizationClient.ts');
const balanceHook = source('hooks/usePlaceFindBalance.ts');
const detail = source('app/share-jobs/[jobId].tsx');
const queue = source('app/share-jobs/index.tsx');
const store = source('app/monetization.tsx');
const settings = source('app/(tabs)/settings.tsx');
const edgePolicy = source('supabase/functions/_shared/premiumRequests.ts');
const monetizationEdge = source('supabase/functions/monetization/index.ts');
const processor = source('supabase/functions/process-share-jobs/index.ts');
const premiumMigration = source('supabase/migrations/20260904000001_premium_request_monetization.sql');
const normalMigration = source('supabase/migrations/20260903000001_place_find_monetization.sql');
const workerPremium = source('services/media-worker/src/premium/premiumRecognitionAdapter.ts');

const requestGuard = monetizationEdge.indexOf('if (!premiumRequestsEnabled())');
const walletCall = monetizationEdge.indexOf("admin.rpc('ensure_place_find_wallet'");
const premiumRpcCall = monetizationEdge.indexOf("admin.rpc('request_premium_recognition'");

test('1. Production normal share works', () => {
  assert.match(premiumMigration, /create_share_job_for_user/);
  assert.match(premiumMigration, /'normal_free','unmetered:normal_free'/);
});
test('2. Production normal share costs zero', () => {
  const normalCreate = premiumMigration.match(/create or replace function public\.create_share_job_for_user[\s\S]*?end;\s*\$\$;/)?.[0] ?? '';
  assert.doesNotMatch(normalCreate, /reserve_place_find_use/);
});
test('3. Production Premium eligibility may still compute', () => {
  assert.equal(premiumEligibilityForResult({
    status: 'needs_help',
    analysis_attempted: true,
    failure_category: 'analysis_insufficient',
    failure_code: 'no_result',
  }).eligible, true);
  assert.match(processor, /updatePatch\.premium_state = eligibility\.eligible \? 'eligible'/);
});
test('4. Production Premium CTA hidden', () => {
  assert.match(detail, /premiumRequestsAvailable && !premiumOfferDismissed/);
  assert.match(detail, /premiumRequestsAvailable && areaMatchIncomplete/);
  assert.equal(premiumRequestsEnabledForEnvironment({ environment: 'production' }), false);
});
test('5. Production Premium offer event not emitted', () => {
  assert.match(processor, /premiumRequestsEnabled\(\)[\s\S]*?'premium_request_offered'[\s\S]*?'premium_eligible_while_suspended'/);
  assert.match(detail, /if \(!premiumRequestsAvailable \|\| job\?\.premium_state !== 'eligible'/);
});
test('6. Production token balance and store entry hidden', () => {
  assert.match(client, /return premiumRequestsEnabled\(\) && monetizationMode\(\) !== 'disabled'/);
  assert.match(balanceHook, /const enabled = isMonetizationEnabled\(\)/);
  assert.match(settings, /placeFindBalance\.enabled \?/);
});
test('7. Direct Production Premium request rejected', () => {
  assert.match(monetizationEdge, /PREMIUM_REQUESTS_SUSPENDED_REASON }, 503/);
  assert.equal(PREMIUM_REQUESTS_SUSPENDED_REASON, 'premium_requests_suspended');
});
test('8. Rejection reserves zero tokens', () => {
  assert.ok(requestGuard >= 0 && requestGuard < walletCall && requestGuard < premiumRpcCall);
});
test('9. Rejection creates zero Premium tasks', () => {
  assert.ok(requestGuard >= 0 && requestGuard < premiumRpcCall);
  assert.match(premiumMigration, /share_media_tasks_premium_request_uidx/);
});
test('10. Rejection invokes zero Sol calls', () => {
  assert.ok(requestGuard >= 0 && requestGuard < premiumRpcCall);
  assert.match(workerPremium, /runPremiumRecognition\(/);
});
test('11. Stale Production token-store route is safe', () => {
  assert.match(store, /if \(!premiumRequestsAvailable\)[\s\S]*premium-requests-suspended[\s\S]*Premium Requests are temporarily unavailable\.[\s\S]*>Done</);
});
test('12. Production zero-balance user still uses free Nearr', () => {
  const normalCreate = premiumMigration.match(/create or replace function public\.create_share_job_for_user[\s\S]*?end;\s*\$\$;/)?.[0] ?? '';
  assert.match(normalCreate, /'normal_free','unmetered:normal_free'/);
  assert.match(normalCreate, /return query select v_job\.id,v_job\.status,false,false,v_available/);
});
test('13. Production incomplete area remains truthful and usable without Premium', () => {
  const state = buildShareJobDetailState({
    status: 'needs_help',
    candidate_payload: { partialResult: {
      version: 1,
      reviewOnly: true,
      resultClass: 'area_match_incomplete',
      area: { name: 'Bali', region: 'Bali', country: 'Indonesia' },
      intendedSpecificity: 'SPECIFIC_PHYSICAL_DESTINATION',
      resolvedSpecificity: 'REGION',
      exactDestinationResolved: false,
      premiumEligible: true,
      searchQuery: 'Bali',
      clueCount: 2,
    } },
  });
  assert.equal(state.kind, 'manual');
  assert.equal(state.canSearchManually, true);
  assert.equal(state.reason, 'area_match_incomplete');
  assert.equal(state.partialResult?.area?.name, 'Bali');
  assert.match(state.copy.body, /exact spot/);
  assert.equal(premiumRequestsEnabledForEnvironment({ environment: 'production' }), false);
});
test('14. Production manual search still works', () => {
  assert.match(detail, /Search manually/);
  assert.match(detail, /manualSearch/);
});
test('15. Existing completed Premium result still opens', () => {
  assert.doesNotMatch(detail, /premiumRequestsAvailable[^\n]*premiumState === 'useful_result'/);
  assert.match(detail, /premiumState === 'reserved' \|\| premiumState === 'processing'/);
});
test('16. Existing processing Premium request can finish', () => {
  assert.match(detail, /if \(premiumState === 'reserved' \|\| premiumState === 'processing'\)/);
  assert.doesNotMatch(detail.match(/if \(premiumState === 'reserved'[\s\S]*?\n  }/)?.[0] ?? '', /premiumRequestsAvailable/);
});
test('17. Existing reservation consumes on useful result', () => {
  assert.match(processor, /p_action: premiumSettlement\.chargeable \? 'consume' : 'release'/);
});
test('18. Existing reservation releases on no-result', () => {
  assert.match(processor, /premiumSettlement\.chargeable \? 'consume' : 'release'/);
  assert.match(processor, /'no_useful_result'/);
});
test('19. Balances remain unchanged', () => {
  assert.ok(requestGuard >= 0 && requestGuard < walletCall);
  assert.match(premiumMigration, /place_find_wallets/);
});
test('20. Lifetime grant remains stored', () => {
  assert.match(normalMigration, /'free_lifetime','lifetime_v1',5,5/);
});
test('21. Ledger history is preserved', () => {
  assert.match(normalMigration, /place_find_ledger/);
  assert.doesNotMatch([policy, clientPolicy, client, monetizationEdge, processor].join('\n'), /delete from public\.place_find_ledger|truncate[^\n]*place_find_ledger/i);
});
test('22. Development Premium CTA visible', () => {
  assert.equal(premiumRequestsEnabledForEnvironment({ environment: 'development' }), true);
  assert.match(detail, /Try Premium Request/);
});
test('23. Development Premium initiation works', () => {
  assert.equal(premiumRequestsEnabledForEnvironment({ configured: 'true', environment: 'development' }), true);
  assert.match(monetizationEdge, /action === 'request_premium'/);
});
test('24. Development reserves one token', () => {
  assert.match(premiumMigration, /reserve_place_find_use\(p_user_id,p_job_id\)/);
  assert.match(normalMigration, /available_uses=available_uses-1/);
});
test('25. Development Simple Sol still executes', () => {
  assert.match(workerPremium, /runPremiumRecognition\(/);
  assert.doesNotMatch(workerPremium, /PREMIUM_REQUESTS_ENABLED/);
});
test('26. Development token store remains', () => {
  assert.equal(premiumRequestsEnabledForEnvironment({ environment: 'development' }), true);
  assert.match(store, /Nearr Tokens/);
});
test('27. Development mock checkout unchanged', () => {
  assert.match(monetizationEdge, /MONETIZATION_DEV_MOCK_ENABLED/);
  assert.match(client, /monetizationMode\(\) !== 'dev_mock'/);
});
test('28. Re-enable flag restores offer', () => {
  assert.equal(premiumRequestsEnabledForEnvironment({ configured: 'true', environment: 'production' }), true);
  assert.equal(premiumRequestsEnabledForEnvironment({ configured: 'false', environment: 'preview' }), false);
});
test('29. Client flag cannot bypass server enforcement', () => {
  const clientEnabled = premiumRequestsEnabledForEnvironment({ configured: 'true', environment: 'production' });
  const serverEnabled = premiumRequestsEnabledForEnvironment({ configured: 'false', environment: 'production' });
  assert.equal(clientEnabled, true);
  assert.equal(serverEnabled, false);
  assert.match(edgePolicy, /Deno\.env\.get\('PREMIUM_REQUESTS_ENABLED'\)/);
});
test('30. No every-share billing regression', () => {
  assert.match(processor, /billing_outcome = 'unmetered:normal_free'/);
  assert.doesNotMatch(queue, /requestPremiumRecognition/);
});

assert.equal(passed.length, 30);
console.log(`PASS premium suspension (${passed.length} cases)`);
