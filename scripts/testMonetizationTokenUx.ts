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
const paywall = source('app/plus.tsx');
const plusClient = source('lib/plusClient.ts');
const plusHook = source('hooks/usePlus.ts');
const premiumAvailability = source('lib/premiumRequests.ts');
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

test('Settings does not advertise the retired token storefront', () => {
  assert.equal(fs.existsSync('app/monetization.tsx'), false);
  assert.doesNotMatch(settings, /Open token store|Token balance|Used for Premium Requests/);
  assert.doesNotMatch(settings, /per shared video/i);
});

test('legacy balance remains intact but is absent from Settings', () => {
  assert.doesNotMatch(settings, /<PlaceFindBalance/);
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

test('legacy Explorer recommendation is preserved but not offered in Plus', () => {
  assert.equal(tokenPackPresentation(30).recommended, true);
  assert.doesNotMatch(paywall, /recommendedProduct|BEST VALUE|packSelected/);
  assert.match(paywall, /plus\.canOffer && plus\.offer/);
});

test('Dev mock price mapping matches Premium Request V2', () => {
  assert.deepEqual(
    PLACE_FIND_DEV_PACKS.map(({ uses, mockDisplayPrice, mockPriceCents }) => [uses, mockDisplayPrice, mockPriceCents]),
    [[10, '$7.99', 799], [30, '$20.99', 2099], [75, '$44.99', 4499]],
  );
});

test('Plus CTA requires a qualified offer and uses its localized store price', () => {
  assert.doesNotMatch(paywall, /setSelectedProductId|selectedPack/);
  assert.match(paywall, /t\('Subscribe for \{\{price\}\} \/ month', \{ price: plus\.offer\.price \}\)/);
  assert.match(paywall, /disabled=\{busy \|\| plus\.loading\}/);
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

test('Plus success requires verification, never a local token increment', () => {
  assert.match(paywall, /result\.outcome === 'verified'/);
  assert.match(paywall, /Your subscription is verified\./);
  assert.match(plusClient, /hasVerifiedPlusAccess\(verified\.entitlement\) \? 'verified' : 'pending'/);
  assert.doesNotMatch(paywall, /tokens added|successBalanceNumber|TokenSymbol/);
  assert.doesNotMatch(paywall, /new balance[\s\S]{0,80}left/i);
});

test('legacy exact-job resume is retained server-side but unavailable in Plus', () => {
  assert.doesNotMatch(paywall, /pendingPremiumRequestJobId|premiumJobId/);
  assert.match(monetizationEdge, /premium_resume_after_purchase_failed/);
  assert.match(monetizationEdge, /request_premium_recognition/);
  assert.match(monetizationClient, /if \(!premiumRequestsEnabled\(\)\) throw new Error\(PREMIUM_REQUESTS_SUSPENDED_REASON\)/);
});

test('zero balance cannot trigger a storefront and existing saves stay accessible', () => {
  assert.match(premiumAvailability, /export function premiumRequestsEnabled\(\): boolean \{\s*return false;/);
  assert.match(paywall, /Your saved places stay yours, with or without a subscription\./);
  assert.doesNotMatch(paywall, /pendingNeedsTokens|resume this Premium Request/);
  assert.doesNotMatch(extension, /out of tokens|purchase_required|monetization\?jobId/i);
});

test('server balance remains authoritative', () => {
  assert.match(monetizationClient, /supabase\.functions\.invoke<BalanceResponse>\('monetization'/);
  assert.match(monetizationClient, /available: safeCount\(data\.balance\.available\)/);
  assert.match(plusClient, /const verified = await fetchPlusStatus\(userId, 'sync'\)/);
  assert.doesNotMatch(monetizationClient, /available\s*\+\s*args|available\s*\+\s*uses/);
});

test('Plus has localized loading, restore, alerts and accessible shared buttons', () => {
  assert.match(paywall, /accessibilityLabel=\{t\('Loading subscription'\)\}/);
  assert.match(paywall, /title=\{t\('Restore Purchases'\)\}/);
  assert.match(paywall, /accessibilityRole="alert" accessibilityLiveRegion="polite"/);
  assert.match(source('components/Button.tsx'), /accessibilityRole="button"/);
});

test('Plus never exposes mock pricing; legacy mock mode remains Development-only', () => {
  assert.doesNotMatch(paywall, /dev_mock|Dev pricing preview/);
  assert.match(plusHook, /canOffer: !!offer && status\?\.salesEnabled === true/);
  assert.match(monetizationClient, /areDeveloperToolsVisible\(\) \? 'dev_mock' : 'disabled'/);
});

test('responsive Plus uses scrolling without retired fixed pack rows', () => {
  assert.match(paywall, /<ScrollView/);
  assert.match(paywall, /contentContainerStyle=\{\{ gap: 20, paddingBottom: 36 \}\}/);
  assert.doesNotMatch(paywall, /packCopy|packName/);
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
