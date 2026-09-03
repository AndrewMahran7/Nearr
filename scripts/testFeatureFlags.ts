/**
 * scripts/testFeatureFlags.ts
 *
 * Regression test for the async share-jobs FLAG-OFF contract
 * (lib/featureFlagsCore.ts — the pure core behind lib/featureFlags.ts).
 *
 * Locks down: the flag is OFF by default and turns ON only for an explicit
 * truthy string, with the build-time env value winning over the `extra`
 * fallback. This is the guard that keeps the current App Store synchronous
 * share flow untouched when nothing is configured.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testFeatureFlags.ts
 */

import { isTruthyFlag, resolveBooleanFlag, resolveOnboardingV2Mode } from '../lib/featureFlagsCore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- Default OFF: nothing configured ---------------------------------------
check('unset env + unset extra => OFF', resolveBooleanFlag(undefined, undefined) === false);
check('empty env + empty extra => OFF', resolveBooleanFlag('', '') === false);
check('null env + null extra => OFF', resolveBooleanFlag(null, null) === false);
check('whitespace env => OFF', resolveBooleanFlag('   ', undefined) === false);

// ---- Explicit falsey strings stay OFF --------------------------------------
check('"false" => OFF', resolveBooleanFlag('false', undefined) === false);
check('"0" => OFF', resolveBooleanFlag('0', undefined) === false);
check('"no" => OFF', resolveBooleanFlag('no', undefined) === false);
check('"off" => OFF', resolveBooleanFlag('off', undefined) === false);
check('garbage => OFF', resolveBooleanFlag('enabled-please', undefined) === false);

// ---- Only explicit truthy strings turn it ON -------------------------------
check('"true" => ON', resolveBooleanFlag('true', undefined) === true);
check('"TRUE" (case) => ON', resolveBooleanFlag('TRUE', undefined) === true);
check('"1" => ON', resolveBooleanFlag('1', undefined) === true);
check('"yes" => ON', resolveBooleanFlag('yes', undefined) === true);
check('"on" => ON', resolveBooleanFlag('on', undefined) === true);
check('" true " (trimmed) => ON', resolveBooleanFlag(' true ', undefined) === true);

// ---- Env precedence over the `extra` fallback ------------------------------
check('env truthy wins over extra unset', resolveBooleanFlag('true', undefined) === true);
check('env truthy wins over extra falsey', resolveBooleanFlag('true', 'false') === true);
check('extra used when env empty', resolveBooleanFlag('', 'true') === true);
check('extra falsey when env empty => OFF', resolveBooleanFlag('', 'false') === false);
// Env present-but-falsey short-circuits BEFORE the extra fallback (so a build
// that explicitly sets the flag to "false" is never re-enabled by `extra`).
check('env "false" short-circuits extra "true" => OFF', resolveBooleanFlag('false', 'true') === false);

// ---- isTruthyFlag direct ---------------------------------------------------
check('isTruthyFlag("true")', isTruthyFlag('true') === true);
check('isTruthyFlag(undefined)', isTruthyFlag(undefined) === false);
check('isTruthyFlag(1 number)', isTruthyFlag(1 as unknown) === false);

// Vayrin Product UI uses the same default-OFF resolver and is surfaced through
// both runtime env and app.config extra. Static checks avoid importing Expo in
// this pure Node contract test.
const featureFlagsSource = readFileSync(join(process.cwd(), 'lib/featureFlags.ts'), 'utf8');
const appConfigSource = readFileSync(join(process.cwd(), 'app.config.js'), 'utf8');
check('Vayrin Product UI flag reads build env', /EXPO_PUBLIC_VAYRIN_PRODUCT_UI_ENABLED/.test(featureFlagsSource));
check('Vayrin Product UI flag has app config fallback', /readExtra\('vayrinProductUiEnabled'\)/.test(featureFlagsSource));
check('app config exposes Vayrin Product UI flag', /vayrinProductUiEnabled/.test(appConfigSource));
check('map clustering bypass reads build env', /EXPO_PUBLIC_MAP_CLUSTERING_ENABLED/.test(featureFlagsSource));
check('map clustering bypass has app config fallback', /readExtra\('mapClusteringEnabled'\)/.test(featureFlagsSource));
check('app config exposes map clustering bypass', /mapClusteringEnabled/.test(appConfigSource));

// Onboarding V2 uses the same resolver and therefore inherits the same
// production-safe default-off behavior.
check('onboarding v2 unset => OFF', resolveBooleanFlag(undefined, undefined) === false);
check('onboarding v2 explicit true => ON', resolveBooleanFlag('true', undefined) === true);
check('phase 1 rollout flag is exposed', /isOnboardingV2Phase1Only/.test(featureFlagsSource));
check('phase 1 rollout defaults safe', /getOnboardingV2Mode\(\) !== 'full'/.test(featureFlagsSource));
check('app config exposes phase 1 boundary', /onboardingV2Phase1Only/.test(appConfigSource));
check(
  'enabled without backend capability falls back to legacy',
  resolveOnboardingV2Mode({ enabled: 'true', phase1Only: 'true', backendReady: '' }) === 'legacy',
);
check(
  'enabled + backend + phase1 boundary selects phase1',
  resolveOnboardingV2Mode({ enabled: 'true', phase1Only: 'true', backendReady: 'true' }) === 'phase1',
);
check(
  'enabled + backend + explicit phase2 selects full',
  resolveOnboardingV2Mode({ enabled: 'true', phase1Only: 'false', backendReady: 'true' }) === 'full',
);
check('app config exposes backend capability', /onboardingV2BackendReady/.test(appConfigSource));

if (failures > 0) {
  console.error(`\n${failures} feature-flag test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll feature-flag tests passed.');
