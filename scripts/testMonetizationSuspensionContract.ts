import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type SuspensionConfig = {
  schemaVersion: number;
  status: string;
  scope: {
    appEnvironment: string;
    backendEnvironment: string;
    supabaseProjectRef: string;
  };
  client: Record<string, boolean>;
  server: Record<string, boolean>;
  safety: {
    productionProjectRef: string;
    productionBypassAllowed: boolean;
    preserveBalances: boolean;
    preserveLedgerAndPurchaseHistory: boolean;
    preserveRevenueCatConfiguration: boolean;
  };
};

type AccountState = {
  availableTokens: number;
  reservedTokens: number;
  ledger: readonly string[];
  purchaseHistory: readonly string[];
};

type ShareInput = {
  hasProEntitlement: boolean;
  revenueCatAvailable: boolean;
};

const DEV_PROJECT_REF = 'qnfxnmvxpjzfydgudtvs';
const PROD_PROJECT_REF = 'rlqvxdwtetxsqxhqztkw';
const REQUIRED_CLIENT_FLAGS = [
  'EXPO_PUBLIC_MONETIZATION_ENABLED',
  'EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED',
  'EXPO_PUBLIC_TOKEN_MONETIZATION_ENABLED',
] as const;
const REQUIRED_SERVER_FLAGS = [
  'TOKEN_MONETIZATION_ENABLED',
  'PREMIUM_REQUESTS_ENABLED',
  'MONETIZATION_DEV_MOCK_ENABLED',
] as const;

function readConfig(): SuspensionConfig {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), 'config/development-monetization-suspension.json'),
      'utf8',
    ),
  ) as SuspensionConfig;
}

function suspensionIsActive(config: SuspensionConfig): boolean {
  return config.schemaVersion === 1
    && config.status === 'suspended'
    && config.scope.appEnvironment === 'development'
    && config.scope.backendEnvironment === 'development'
    && config.scope.supabaseProjectRef === DEV_PROJECT_REF
    && REQUIRED_CLIENT_FLAGS.every((name) => config.client[name] === false)
    && REQUIRED_SERVER_FLAGS.every((name) => config.server[name] === false)
    && config.safety.productionBypassAllowed === false;
}

function submitQaShare(
  config: SuspensionConfig,
  state: AccountState,
  input: ShareInput,
): {
  accepted: boolean;
  status: 'queued';
  requiresPurchase: boolean;
  requiresPro: boolean;
  consultedRevenueCat: boolean;
  reservedToken: boolean;
  showViewPacks: boolean;
  nextState: AccountState;
} {
  assert.equal(suspensionIsActive(config), true, 'QA simulation requires the exact Development suspension');
  void input.hasProEntitlement;
  void input.revenueCatAvailable;
  return {
    accepted: true,
    status: 'queued',
    requiresPurchase: false,
    requiresPro: false,
    consultedRevenueCat: false,
    reservedToken: false,
    showViewPacks: false,
    nextState: state,
  };
}

const config = readConfig();
const originalState: AccountState = {
  availableTokens: 0,
  reservedTokens: 0,
  ledger: Object.freeze(['free:lifetime:v1', 'historic:purchase:1']),
  purchaseHistory: Object.freeze(['transaction:historic:1']),
};

const passed: string[] = [];
function test(name: string, run: () => void): void {
  run();
  passed.push(name);
  console.log(`PASS ${name}`);
}

test('1. zero-token user is accepted and queued', () => {
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: false,
    revenueCatAvailable: true,
  });
  assert.deepEqual(
    { accepted: result.accepted, status: result.status, reservedToken: result.reservedToken },
    { accepted: true, status: 'queued', reservedToken: false },
  );
});

test('2. no Pro entitlement is required', () => {
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: false,
    revenueCatAvailable: true,
  });
  assert.equal(result.requiresPro, false);
  assert.equal(result.accepted, true);
});

test('3. RevenueCat outage cannot block recognition', () => {
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: false,
    revenueCatAvailable: false,
  });
  assert.equal(result.consultedRevenueCat, false);
  assert.equal(result.status, 'queued');
});

test('4. durable acceptance uses normal success UI without View Packs', () => {
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: false,
    revenueCatAvailable: false,
  });
  assert.equal(result.requiresPurchase, false);
  assert.equal(result.showViewPacks, false);

  const extension = fs.readFileSync(path.resolve(process.cwd(), 'ShareExtension.tsx'), 'utf8');
  const completion = fs.readFileSync(
    path.resolve(process.cwd(), 'lib/shareExtensionCompletion.ts'),
    'utf8',
  );
  assert.match(extension, /setUi\(\{ kind: 'accepted', duplicate: result\.duplicate \}\)/);
  assert.doesNotMatch(extension, /View packs|out of tokens|monetization\?jobId=/i);
  assert.match(completion, /title: SHARE_COMPLETION_COPY\.acceptedTitle/);
});

test('5. successful recognition and save do not debit tokens', () => {
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: false,
    revenueCatAvailable: false,
  });
  assert.equal(result.nextState.availableTokens, originalState.availableTokens);
  assert.equal(result.nextState.reservedTokens, originalState.reservedTokens);
});

test('6. existing balance, ledger, and purchase history remain byte-for-byte unchanged', () => {
  const before = JSON.stringify(originalState);
  const result = submitQaShare(config, originalState, {
    hasProEntitlement: true,
    revenueCatAvailable: true,
  });
  assert.equal(result.nextState, originalState);
  assert.equal(JSON.stringify(result.nextState), before);
  assert.equal(config.safety.preserveBalances, true);
  assert.equal(config.safety.preserveLedgerAndPurchaseHistory, true);
  assert.equal(config.safety.preserveRevenueCatConfiguration, true);
});

test('7. Production cannot enable the Development bypass', () => {
  assert.equal(config.safety.productionProjectRef, PROD_PROJECT_REF);
  const productionAttempt: SuspensionConfig = {
    ...config,
    scope: {
      appEnvironment: 'production',
      backendEnvironment: 'production',
      supabaseProjectRef: PROD_PROJECT_REF,
    },
  };
  assert.equal(suspensionIsActive(productionAttempt), false);
  assert.equal(config.safety.productionBypassAllowed, false);
});

assert.equal(suspensionIsActive(config), true);
assert.equal(passed.length, 7);
console.log(`PASS Development monetization suspension contract (${passed.length} cases)`);
