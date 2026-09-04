import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { applyPlaceFindPurchase, emptyPlaceFindLedger } from '../lib/placeFindLedger';
import {
  PLACE_FIND_DEV_PACKS,
  placeFindBalanceLabel,
  tokenPackPresentation,
} from '../lib/placeFindConfig';

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}
function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

const settings = source('app/(tabs)/settings.tsx');
const paywall = source('app/monetization.tsx');
const balance = source('components/PlaceFindBalance.tsx');
const tokenSymbol = source('components/TokenSymbol.tsx');
const map = source('app/(tabs)/map.tsx');
const extension = source('ShareExtension.tsx');
const handoff = source('components/ShareJobHandoff.tsx');
const queue = source('app/share-jobs/index.tsx');
const jobDetailState = source('lib/shareJobDetailState.ts');
const monetizationClient = source('lib/monetizationClient.ts');
const monetizationEdge = source('supabase/functions/monetization/index.ts');
const migration = source('supabase/migrations/20260903000001_place_find_monetization.sql');
const packMigration = source('supabase/migrations/20260903000004_dev_token_pack_quantities.sql');
const premiumMigration = source('supabase/migrations/20260904000001_premium_request_monetization.sql');
const userFacingMonetization = [settings, paywall, balance, extension, handoff, queue, jobDetailState].join('\n');

test('Settings displays token terminology', () => {
  assert.match(settings, />Tokens</);
  assert.match(settings, />Token balance</);
  assert.match(settings, /Used for Premium Requests/);
  assert.doesNotMatch(settings, /per shared video/i);
});

test('Settings displays a numeric balance with the token symbol', () => {
  assert.match(settings, /<PlaceFindBalance/);
  assert.match(balance, /<Text[\s\S]*styles\.number/);
  assert.match(balance, /<TokenSymbol size=\{16\}/);
  assert.match(tokenSymbol, /styles\.diamond/);
});

test('user-facing monetization copy never says tokens left', () => {
  assert.doesNotMatch(userFacingMonetization, /tokens? left/i);
  assert.equal(placeFindBalanceLabel(14), '14 tokens');
});

test('user-facing monetization copy has no stale place-find wording', () => {
  assert.doesNotMatch(userFacingMonetization, /place finds?|place-find balance|finds left/i);
  assert.doesNotMatch(userFacingMonetization, /credits? left/i);
});

test('map has no monetization balance UI', () => {
  assert.doesNotMatch(map, /PlaceFindBalance|usePlaceFindBalance|monetization|token balance|credit balance|place-find balance/i);
});

test('Starter Pack is 10 tokens at the Premium Request Dev price', () => {
  const pack = PLACE_FIND_DEV_PACKS[0];
  assert.deepEqual([tokenPackPresentation(pack.uses).name, pack.uses, pack.mockDisplayPrice], ['Starter Pack', 10, '$7.99']);
});

test('Explorer Pack is 30 tokens at the existing Dev price', () => {
  const pack = PLACE_FIND_DEV_PACKS[1];
  assert.deepEqual([tokenPackPresentation(pack.uses).name, pack.uses, pack.mockDisplayPrice], ['Explorer Pack', 30, '$20.99']);
});

test('Treasure Pack is 75 tokens at the existing Dev price', () => {
  const pack = PLACE_FIND_DEV_PACKS[2];
  assert.deepEqual([tokenPackPresentation(pack.uses).name, pack.uses, pack.mockDisplayPrice], ['Treasure Pack', 75, '$44.99']);
});

test('Explorer is the default recommended pack with BEST VALUE treatment', () => {
  assert.equal(tokenPackPresentation(30).recommended, true);
  assert.match(paywall, /recommendedProduct/);
  assert.match(paywall, />BEST VALUE</);
  assert.match(paywall, /packSelected[\s\S]*borderColor: ORANGE/);
});

test('Dev mock price mapping matches Premium Request V2', () => {
  assert.deepEqual(
    PLACE_FIND_DEV_PACKS.map(({ uses, mockDisplayPrice, mockPriceCents }) => [uses, mockDisplayPrice, mockPriceCents]),
    [[10, '$7.99', 799], [30, '$20.99', 2099], [75, '$44.99', 4499]],
  );
});

test('pack selection drives the explicit token CTA', () => {
  assert.match(paywall, /setSelectedProductId\(pack\.productId\)/);
  assert.match(paywall, /Get \{selectedPack\.uses\} tokens/);
  assert.match(paywall, /accessibilityState=\{\{ disabled, selected \}\}/);
});

test('mock purchases credit the configured quantity exactly once', () => {
  const first = applyPlaceFindPurchase(emptyPlaceFindLedger(), 'explorer-purchase', 30);
  const replay = applyPlaceFindPurchase(first.state, 'explorer-purchase', 30);
  assert.equal(first.state.available, 30);
  assert.equal(replay.state.available, 30);
  assert.equal(replay.replayed, true);
  assert.match(packMigration, /set use_count = 30/);
  assert.match(packMigration, /set use_count = 75/);
});

test('success shows tokens added and a numeric balance with the symbol', () => {
  assert.match(paywall, /tokens added/);
  assert.match(paywall, /styles\.successBalanceNumber/);
  assert.match(paywall, /<TokenSymbol size=\{26\}/);
  assert.match(paywall, />Your new balance</);
  assert.doesNotMatch(paywall, /new balance[\s\S]{0,80}left/i);
});

test('a purchase resumes the exact pending Premium Request without reshare', () => {
  assert.match(paywall, /premiumJobId: pendingPremiumRequestJobId/);
  assert.match(monetizationEdge, /premium_resume_after_purchase_failed/);
  assert.match(monetizationEdge, /request_premium_recognition/);
  assert.match(paywall, /resumed automatically on the original post/);
});

test('zero balance preserves and continues only the pending Premium Request', () => {
  assert.match(paywall, /pendingNeedsTokens/);
  assert.match(paywall, /original post is safe/);
  assert.match(paywall, /resume this Premium Request automatically/);
  assert.doesNotMatch(extension, /out of tokens|purchase_required|monetization\?jobId/i);
});

test('server balance remains authoritative', () => {
  assert.match(monetizationClient, /supabase\.functions\.invoke<BalanceResponse>\('monetization'/);
  assert.match(monetizationClient, /available: safeCount\(data\.balance\.available\)/);
  assert.match(paywall, /available: result\.available/);
  assert.doesNotMatch(monetizationClient, /available\s*\+\s*args|available\s*\+\s*uses/);
});

test('token balance and every pack have complete accessibility labels', () => {
  assert.match(settings, /Open token store/);
  assert.match(paywall, /presentation\.name,[\s\S]*`\$\{pack\.uses\} tokens`[\s\S]*pack\.displayPrice/);
  assert.match(paywall, /presentation\.recommended \? 'best value'/);
  assert.match(paywall, /accessibilityRole="radio"/);
  assert.match(paywall, /minHeight: 44/);
});

test('Dev pricing badge is gated away from Production mode', () => {
  assert.match(paywall, /snapshot\?\.mode === 'dev_mock' \? \(/);
  assert.match(paywall, /Dev pricing preview/);
  assert.match(monetizationClient, /areDeveloperToolsVisible\(\) \? 'dev_mock' : 'disabled'/);
});

test('responsive paywall uses scrolling and flexible non-overlapping pack copy', () => {
  assert.match(paywall, /<ScrollView/);
  assert.match(paywall, /packCopy: \{ flex: 1, minWidth: 0/);
  assert.match(paywall, /packName:[\s\S]*flexShrink: 1/);
  assert.match(paywall, /content: \{ paddingHorizontal: 18/);
});

test('monetization surfaces contain no user-facing Vayrin branding', () => {
  assert.doesNotMatch([paywall, balance, tokenSymbol].join('\n'), /Vayrin/i);
});

test('wallet, reserve, consume, release, and free-grant contracts are unchanged', () => {
  assert.match(migration, /available_uses integer not null default 0/);
  assert.match(migration, /reserved_uses integer not null default 0/);
  assert.match(migration, /'free_lifetime','lifetime_v1',5,5/);
  assert.match(migration, /create or replace function public\.reserve_place_find_use/);
  assert.match(migration, /create or replace function public\.settle_place_find_use/);
  assert.doesNotMatch(packMigration, /(update|alter|insert into|delete from) public\.(place_find_wallets|place_find_ledger|place_find_reservations)/i);
  assert.match(premiumMigration, /'free_lifetime','lifetime_v1',5,5|ensure_place_find_wallet/);
});

const outputDir = path.resolve(process.cwd(), 'artifacts/monetization');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'monetization-token-ux-test-results.json'), `${JSON.stringify({
  suite: 'monetization-token-ux',
  passed: passed.length,
  failed: 0,
  cases: passed,
}, null, 2)}\n`);
console.log(`PASS wrote artifacts/monetization/monetization-token-ux-test-results.json (${passed.length} cases)`);
