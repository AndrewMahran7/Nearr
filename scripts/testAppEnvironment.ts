/**
 * scripts/testAppEnvironment.ts
 *
 * Regression test for the environment-safety contract
 * (lib/appEnvironmentCore.ts — the pure core behind lib/appEnvironment.ts and
 * scripts/checkEnvironment.ts).
 *
 * Locks down the two rules that exist to stop the 2026-08-18 class of
 * incident: a development build must not silently reach the production
 * backend, and a production build must not ship development endpoints. Also
 * locks the deliberately asymmetric defaults, so that FORGETTING to declare an
 * environment fails the build rather than defaulting into the production lane.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testAppEnvironment.ts
 */

import {
  blockingViolations,
  formatEnvironmentSummary,
  hostOf,
  NEARR_DEV_SUPABASE_REF,
  NEARR_PRODUCTION_SUPABASE_REF,
  resolveEnvironment,
  supabaseProjectRefOfHost,
  validateEnvironment,
  type EnvironmentInputs,
} from '../lib/appEnvironmentCore';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const PROD_HOST = `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co`;
const DEV_HOST = `https://${NEARR_DEV_SUPABASE_REF}.supabase.co`;

/** A fully-declared, internally consistent production configuration. */
const PRODUCTION: EnvironmentInputs = {
  appEnv: 'production',
  backendEnv: 'production',
  supabaseUrl: PROD_HOST,
  processShareLinkUrl: `${PROD_HOST}/functions/v1/process-share-link`,
  createShareJobUrl: `${PROD_HOST}/functions/v1/create-share-job`,
};

/** A fully-declared, internally consistent development configuration. */
const DEVELOPMENT: EnvironmentInputs = {
  appEnv: 'development',
  backendEnv: 'development',
  supabaseUrl: DEV_HOST,
  processShareLinkUrl: `${DEV_HOST}/functions/v1/process-share-link`,
  createShareJobUrl: `${DEV_HOST}/functions/v1/create-share-job`,
};

function codes(inputs: EnvironmentInputs): string[] {
  return validateEnvironment(inputs).map((v) => v.code);
}

function blockingCodes(inputs: EnvironmentInputs): string[] {
  return blockingViolations(validateEnvironment(inputs)).map((v) => v.code);
}

// ---- Happy paths: correctly declared lanes are clean ------------------------
check('production/production is clean', codes(PRODUCTION).length === 0, codes(PRODUCTION).join(','));
check(
  'development/development is clean',
  codes(DEVELOPMENT).length === 0,
  codes(DEVELOPMENT).join(','),
);
check(
  'preview/development is clean',
  codes({ ...DEVELOPMENT, appEnv: 'preview' }).length === 0,
);

// ---- Rule 2: production app + development backend (Phase 16) ---------------
const prodAppDevBackend: EnvironmentInputs = { ...DEVELOPMENT, appEnv: 'production' };
check(
  'prod app + dev backend is flagged',
  codes(prodAppDevBackend).includes('PROD_APP_DEV_BACKEND'),
);
check(
  'prod app + dev backend BLOCKS the build',
  blockingCodes(prodAppDevBackend).includes('PROD_APP_DEV_BACKEND'),
);

// ---- Rule 3: development app + production backend (Phase 15) ---------------
const devAppProdBackend: EnvironmentInputs = { ...PRODUCTION, appEnv: 'development' };
check(
  'dev app + prod backend is flagged',
  codes(devAppProdBackend).includes('DEV_APP_PROD_BACKEND'),
);
check(
  'dev app + prod backend BLOCKS the build',
  blockingCodes(devAppProdBackend).includes('DEV_APP_PROD_BACKEND'),
);
check(
  'preview app + prod backend is flagged too',
  codes({ ...PRODUCTION, appEnv: 'preview' }).includes('DEV_APP_PROD_BACKEND'),
);

// The old escape hatch is retired now that Nearr-Dev exists.
const acknowledged: EnvironmentInputs = {
  ...devAppProdBackend,
  allowProductionBackend: 'true',
};
check(
  'ALLOW_PRODUCTION_BACKEND cannot clear the dev->prod rule',
  codes(acknowledged).includes('DEV_APP_PROD_BACKEND'),
);
check(
  'ALLOW_PRODUCTION_BACKEND is itself a blocking retired override',
  blockingCodes(acknowledged).includes('PRODUCTION_BACKEND_OVERRIDE_FORBIDDEN'),
);
check(
  'ALLOW_PRODUCTION_BACKEND does NOT excuse a prod app on a dev backend',
  blockingCodes({ ...prodAppDevBackend, allowProductionBackend: 'true' }).includes(
    'PROD_APP_DEV_BACKEND',
  ),
);
check(
  'a falsey acknowledgement does not clear the rule',
  codes({ ...devAppProdBackend, allowProductionBackend: 'false' }).includes(
    'DEV_APP_PROD_BACKEND',
  ),
);

// ---- Asymmetric defaults: forgetting to declare must fail safe -------------
const undeclared: EnvironmentInputs = { supabaseUrl: PROD_HOST };
const undeclaredResolved = resolveEnvironment(undeclared);
check('undeclared APP_ENV defaults to development', undeclaredResolved.appEnv === 'development');
check('undeclared BACKEND_ENV defaults to production', undeclaredResolved.backendEnv === 'production');
check('undeclared reports APP_ENV_MISSING', codes(undeclared).includes('APP_ENV_MISSING'));
check('undeclared reports BACKEND_ENV_MISSING', codes(undeclared).includes('BACKEND_ENV_MISSING'));
// The whole point: a completely unconfigured build is NOT quietly accepted.
check(
  'a completely undeclared build BLOCKS (dev app reaching prod backend)',
  blockingCodes(undeclared).includes('DEV_APP_PROD_BACKEND'),
);
check(
  'a garbage APP_ENV is treated as undeclared, not as production',
  resolveEnvironment({ appEnv: 'prod' }).appEnv === 'development',
);

// A missing declaration alone is advisory — it must not break a local
// `expo start` against a dev backend, or nobody would keep the guard.
check(
  'missing APP_ENV on a dev backend is advisory, not blocking',
  blockingCodes({ backendEnv: 'development', supabaseUrl: DEV_HOST }).length === 0,
);

// ---- Rule 4: half-repointed environments -----------------------------------
const mixed: EnvironmentInputs = {
  ...DEVELOPMENT,
  createShareJobUrl: `${PROD_HOST}/functions/v1/create-share-job`,
};
check('mismatched backend hosts are flagged', codes(mixed).includes('BACKEND_HOST_MISMATCH'));
check('mismatched backend hosts BLOCK', blockingCodes(mixed).includes('BACKEND_HOST_MISMATCH'));
check(
  'partially configured hosts (some unset) do not false-positive',
  !codes({ appEnv: 'development', backendEnv: 'development', supabaseUrl: DEV_HOST }).includes(
    'BACKEND_HOST_MISMATCH',
  ),
);

// ---- Rule 5: exact hosted project identity ---------------------------------
check(
  'any declared lane without a Supabase URL is blocked',
  blockingCodes({ appEnv: 'development', backendEnv: 'development' }).includes('SUPABASE_MISSING'),
);
check(
  'development label with production project is blocked even when labels agree',
  blockingCodes({
    ...DEVELOPMENT,
    supabaseUrl: PROD_HOST,
    processShareLinkUrl: `${PROD_HOST}/functions/v1/process-share-link`,
    createShareJobUrl: `${PROD_HOST}/functions/v1/create-share-job`,
  }).includes('SUPABASE_PROJECT_MISMATCH'),
);
check(
  'production label with development project is blocked even when labels agree',
  blockingCodes({
    ...PRODUCTION,
    supabaseUrl: DEV_HOST,
    processShareLinkUrl: `${DEV_HOST}/functions/v1/process-share-link`,
    createShareJobUrl: `${DEV_HOST}/functions/v1/create-share-job`,
  }).includes('SUPABASE_PROJECT_MISMATCH'),
);
check(
  'a custom/unrecognised hosted project cannot masquerade as Nearr-Dev',
  blockingCodes({
    ...DEVELOPMENT,
    supabaseUrl: 'https://other-project.supabase.co',
    processShareLinkUrl: 'https://other-project.supabase.co/functions/v1/process-share-link',
    createShareJobUrl: 'https://other-project.supabase.co/functions/v1/create-share-job',
  }).includes('SUPABASE_PROJECT_MISMATCH'),
);

// ---- Rule 6: production-only guards ---------------------------------------
check(
  'demo mode in production is flagged',
  codes({ ...PRODUCTION, demoMode: 'true' }).includes('PROD_DEMO_MODE'),
);
check(
  'dev password login in production is flagged',
  codes({ ...PRODUCTION, devPasswordLogin: 'true' }).includes('PROD_DEV_PASSWORD_LOGIN'),
);
check(
  'debug logs in production is flagged',
  codes({ ...PRODUCTION, debugLogs: 'true' }).includes('PROD_DEBUG_LOGS'),
);
check(
  'dev mock monetization in production is blocked',
  blockingCodes({ ...PRODUCTION, monetizationMode: 'dev_mock' }).includes(
    'PROD_DEV_MOCK_MONETIZATION',
  ),
);
check(
  'the same dev switches are fine in development',
  codes({ ...DEVELOPMENT, demoMode: 'true', debugLogs: 'true', devPasswordLogin: 'true' })
    .length === 0,
);

// ---- hostOf ----------------------------------------------------------------
check('hostOf strips path', hostOf('https://a.supabase.co/functions/v1/x') === 'a.supabase.co');
check('hostOf strips port', hostOf('http://192.168.1.5:54321') === '192.168.1.5');
check('hostOf lowercases', hostOf('https://A.Supabase.CO') === 'a.supabase.co');
check('hostOf strips userinfo', hostOf('https://user:pw@a.supabase.co/x') === 'a.supabase.co');
check('hostOf of empty is null', hostOf('') === null);
check('hostOf of garbage is null', hostOf('not-a-url') === null);
check('hostOf of non-string is null', hostOf(42 as unknown) === null);
check(
  'supabaseProjectRefOfHost extracts a standard project ref',
  supabaseProjectRefOfHost(`${NEARR_DEV_SUPABASE_REF}.supabase.co`) === NEARR_DEV_SUPABASE_REF,
);
check('supabaseProjectRefOfHost rejects a custom host', supabaseProjectRefOfHost('db.example.com') === null);
check(
  'summary identifies Nearr-Dev without exposing configuration values',
  formatEnvironmentSummary(DEVELOPMENT).includes('supabase=Nearr-Dev('),
);

// ---- Purity ----------------------------------------------------------------
const frozen: EnvironmentInputs = { ...PRODUCTION };
validateEnvironment(frozen);
check(
  'validateEnvironment does not mutate its input',
  JSON.stringify(frozen) === JSON.stringify(PRODUCTION),
);

if (failures > 0) {
  console.error(`\n${failures} app-environment test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll app-environment tests passed.');
