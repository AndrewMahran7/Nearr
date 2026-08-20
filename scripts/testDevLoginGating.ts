/**
 * scripts/testDevLoginGating.ts
 *
 * The developer-login panel must be reachable ONLY in an explicitly declared
 * development/preview lane, and must be impossible in production.
 *
 * WHY IT CHANGED
 * --------------
 * The panel used to be gated on `__DEV__ && EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN`.
 * `__DEV__` is true only while Metro is serving the JS: an installed EAS
 * development build running a PUBLISHED update executes a production-mode
 * bundle, so `__DEV__` is false there. That is why the developer credentials
 * "didn't work" on the first physical development build even though the flag
 * was set — the panel was never rendered.
 *
 * It is now gated on `areDeveloperToolsVisible()`, which requires an EXPLICIT
 * development/preview `EXPO_PUBLIC_APP_ENV`. That fails CLOSED: a build that
 * never declared a lane (including the current App Store binary, whose
 * environment predates the declaration) cannot expose it.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testDevLoginGating.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  blockingViolations,
  resolveEnvironment,
  validateEnvironment,
} from '../lib/appEnvironmentCore';

const REPO_ROOT = path.resolve(__dirname, '..');
const ACCOUNT_SCREEN = path.join(REPO_ROOT, 'app', '(onboarding)', 'account.tsx');

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const account = code(readFileSync(ACCOUNT_SCREEN, 'utf8'));

// ---- The gate itself --------------------------------------------------------

const gate = /const DEV_PASSWORD_LOGIN_ENABLED =([\s\S]*?);/.exec(account)?.[1] ?? '';
check('the developer-login gate exists', gate.length > 0);
check(
  'the gate uses the canonical environment abstraction',
  /areDeveloperToolsVisible\s*\(\s*\)/.test(gate),
  'gating on __DEV__ hides the panel in exactly the OTA case it is needed for',
);
check(
  'the gate no longer depends on __DEV__',
  !/__DEV__/.test(gate),
  `gate is: ${gate.trim()}`,
);
check(
  'the explicit opt-in flag is still required on top of the lane',
  /EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN/.test(gate),
  'the lane alone must not be enough to expose a credential panel',
);
check(
  'the gate is a conjunction, not an either/or',
  /&&/.test(gate) && !/\|\|/.test(gate),
);

// ---- No credentials may be committed ---------------------------------------

check(
  'no developer password literal is committed',
  !/developerPassword\s*=\s*['"][^'"]+['"]/.test(account),
);
check(
  'the developer password is never logged',
  !/console\.(log|warn|error)\([^)]*developerPassword/.test(account),
);

// ---- Production safety, asserted against the real rules ---------------------
//
// areDeveloperToolsVisible() is `!appEnvWasDefaulted && appEnv !== 'production'`.
// Reproduced here through resolveEnvironment so the property is checked against
// the shipped logic rather than restated.

function toolsVisible(appEnv: unknown): boolean {
  const resolved = resolveEnvironment({ appEnv, backendEnv: 'development' });
  return !resolved.appEnvWasDefaulted && resolved.appEnv !== 'production';
}

check('production hides developer tools', toolsVisible('production') === false);
check('an UNDECLARED lane hides developer tools', toolsVisible(undefined) === false);
check('a garbage lane hides developer tools', toolsVisible('prod') === false);
check('development shows developer tools', toolsVisible('development') === true);
check('preview shows developer tools', toolsVisible('preview') === true);

// And the flag itself can never ride along into a production build.
const prodWithFlag = blockingViolations(
  validateEnvironment({
    appEnv: 'production',
    backendEnv: 'production',
    supabaseUrl: 'https://prod.supabase.co',
    devPasswordLogin: 'true',
  }),
).map((violation) => violation.code);
check(
  'the dev-login flag in a production build is a BLOCKING violation',
  prodWithFlag.includes('PROD_DEV_PASSWORD_LOGIN'),
  `got ${JSON.stringify(prodWithFlag)}`,
);

if (failures > 0) {
  console.error(`\n${failures} developer-login gating test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll developer-login gating tests passed.');
