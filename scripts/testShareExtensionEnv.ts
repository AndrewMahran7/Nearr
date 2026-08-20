/**
 * scripts/testShareExtensionEnv.ts
 *
 * Environment contract for the iOS Share Extension.
 *
 * WHY THE EXTENSION IS SPECIAL
 * ----------------------------
 * app.json puts BOTH `expo-updates` and `expo-dev-client` in the extension's
 * `excludedPackages`. So, unlike the main app, the extension:
 *
 *   - never receives an EAS Update (a `dev:update` cannot change it), and
 *   - never attaches to Metro (a dev client cannot serve it either).
 *
 * Whatever was inlined when the binary was BUILT is what it runs forever. That
 * makes it the one surface where the app and its extension can silently
 * disagree about which backend they point at — the app can be OTA'd onto
 * Nearr-Dev while the extension still holds whatever it was built with.
 *
 * The safety invariant this protects is:
 *
 *   A development share must never create a production job.
 *
 * It is enforced by the extension stating its lane and refusing to submit when
 * lib/appEnvironmentCore reports a BLOCKING violation, checked before the
 * network call rather than after.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testShareExtensionEnv.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  blockingViolations,
  NEARR_DEV_SUPABASE_REF,
  NEARR_PRODUCTION_SUPABASE_REF,
  validateEnvironment,
} from '../lib/appEnvironmentCore';

const REPO_ROOT = path.resolve(__dirname, '..');
const EXTENSION = readFileSync(path.join(REPO_ROOT, 'ShareExtension.tsx'), 'utf8');
const APP_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8'));

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

const extensionCode = code(EXTENSION);

// ---- The build-time-only assumption this contract rests on ------------------

const sharePlugin = (APP_JSON.expo.plugins as unknown[]).find(
  (entry): entry is [string, { excludedPackages?: string[] }] =>
    Array.isArray(entry) && entry[0] === 'expo-share-extension',
);
check('the expo-share-extension plugin is configured', !!sharePlugin);
const excluded = sharePlugin?.[1]?.excludedPackages ?? [];
check(
  'expo-updates is excluded from the extension (so an OTA cannot change it)',
  excluded.includes('expo-updates'),
  'if this changes, the "rebuild required" rule in docs/DEVELOPMENT_WORKFLOW.md is wrong',
);
check(
  'expo-dev-client is excluded from the extension (so Metro cannot serve it)',
  excluded.includes('expo-dev-client'),
);

// ---- The extension must declare its lane and fail closed -------------------

check(
  'the extension reads the canonical environment declaration',
  /from '\.\/lib\/appEnvironment'/.test(extensionCode),
);
check(
  'the extension checks BLOCKING environment violations',
  /getBlockingEnvironmentViolations\s*\(/.test(extensionCode),
);
check(
  'the extension logs a non-secret environment identity',
  /describeEnvironment\s*\(/.test(extensionCode),
);
check(
  'a misconfigured extension refuses instead of submitting',
  /kind: 'config_error'/.test(extensionCode),
);

// The check must happen BEFORE the job is created, or the guarantee is void.
const guardIndex = extensionCode.indexOf('getBlockingEnvironmentViolations');
const submitIndex = extensionCode.indexOf('await createShareJob(');
check(
  'the environment guard runs BEFORE createShareJob',
  guardIndex > -1 && submitIndex > -1 && guardIndex < submitIndex,
  `guard@${guardIndex} submit@${submitIndex}`,
);

// ---- No endpoint may be baked in --------------------------------------------

check(
  'the extension resolves its endpoint rather than hardcoding one',
  /resolveCreateShareJobUrl\s*\(/.test(extensionCode),
);
check(
  'no Supabase project URL is hardcoded in the extension',
  !/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(extensionCode),
  'endpoints must come from the environment so a lane cannot be baked in',
);

// ---- Nothing secret may be logged -------------------------------------------

// Interpolating a credential's VALUE is the hazard. Logging its presence
// (`!!token`) or its length is fine and is what the extension already does, so
// only a bare `${token}` / `${accessToken}` is rejected.
const BARE_CREDENTIAL = /\$\{\s*(accessToken|token|apiKey|anonKey)\s*\}/g;
const loggedCredentials: string[] = [];
for (const line of extensionCode.split('\n')) {
  if (!/console\.(log|warn|error)/.test(line)) continue;
  for (const match of line.matchAll(BARE_CREDENTIAL)) loggedCredentials.push(match[0]);
}
check(
  'the extension never interpolates a credential value into a log',
  loggedCredentials.length === 0,
  `found ${JSON.stringify(loggedCredentials)}`,
);
check(
  'presence-only token logging is what it does instead',
  /auth_token_present=\$\{!!/.test(extensionCode),
);
for (const secretName of ['ANON_KEY', 'SERVICE_ROLE_KEY', 'GEMINI_API_KEY']) {
  check(
    `no ${secretName} appears in the extension at all`,
    !extensionCode.includes(secretName),
    'the extension must never carry server-side credentials',
  );
}

// ---- The rules themselves: a dev app pointed at production must be blocking --
// This is the behaviour the extension relies on, asserted directly so the
// guard cannot be weakened out from under it.

const devAppProdBackend = blockingViolations(
  validateEnvironment({
    appEnv: 'development',
    backendEnv: 'production',
    supabaseUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co`,
    createShareJobUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co/functions/v1/create-share-job`,
  }),
).map((violation) => violation.code);
check(
  'a development lane on a production backend is BLOCKING',
  devAppProdBackend.includes('DEV_APP_PROD_BACKEND'),
  `got ${JSON.stringify(devAppProdBackend)}`,
);

const splitBrain = blockingViolations(
  validateEnvironment({
    appEnv: 'development',
    backendEnv: 'development',
    supabaseUrl: `https://${NEARR_DEV_SUPABASE_REF}.supabase.co`,
    createShareJobUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co/functions/v1/create-share-job`,
  }),
).map((violation) => violation.code);
check(
  'an extension whose job endpoint drifted to another host is BLOCKING',
  splitBrain.includes('BACKEND_HOST_MISMATCH'),
  `got ${JSON.stringify(splitBrain)}`,
);

const coherentDev = blockingViolations(
  validateEnvironment({
    appEnv: 'development',
    backendEnv: 'development',
    supabaseUrl: `https://${NEARR_DEV_SUPABASE_REF}.supabase.co`,
    processShareLinkUrl: `https://${NEARR_DEV_SUPABASE_REF}.supabase.co/functions/v1/process-share-link`,
    createShareJobUrl: `https://${NEARR_DEV_SUPABASE_REF}.supabase.co/functions/v1/create-share-job`,
  }),
);
check('a coherent development extension is allowed to submit', coherentDev.length === 0);

const lyingButConsistentDev = blockingViolations(
  validateEnvironment({
    appEnv: 'development',
    backendEnv: 'development',
    supabaseUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co`,
    processShareLinkUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co/functions/v1/process-share-link`,
    createShareJobUrl: `https://${NEARR_PRODUCTION_SUPABASE_REF}.supabase.co/functions/v1/create-share-job`,
    allowProductionBackend: 'true',
  }),
).map((violation) => violation.code);
check(
  'consistent production URLs cannot masquerade as development',
  lyingButConsistentDev.includes('SUPABASE_PROJECT_MISMATCH') &&
    lyingButConsistentDev.includes('PRODUCTION_BACKEND_OVERRIDE_FORBIDDEN'),
  `got ${JSON.stringify(lyingButConsistentDev)}`,
);

if (failures > 0) {
  console.error(`\n${failures} share-extension environment test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-extension environment tests passed.');
