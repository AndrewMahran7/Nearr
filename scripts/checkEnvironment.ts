/**
 * scripts/checkEnvironment.ts
 *
 * Build-time enforcement of the environment contract in
 * lib/appEnvironmentCore.ts. Fails BEFORE a build, an export, or an OTA
 * publish rather than crashing real users afterwards (Phase 15/16).
 *
 * Two modes:
 *
 *   Local  — validate the declaration this machine would build with, read
 *            from .env / .env.local / process.env the same way Expo does.
 *
 *              npm run verify:env
 *              npm run verify:env -- --expect production
 *
 *   Remote — validate what an EAS environment would produce, WITHOUT
 *            building anything. This is the check to run before publishing an
 *            update to a channel.
 *
 *              npm run verify:env -- --eas-environment production
 *
 * The remote mode shells out to `eas env:list`, which is read-only. Sensitive
 * values come back masked; we only ever need the non-secret declarations
 * (APP_ENV, BACKEND_ENV and the endpoint hosts), so masked values are ignored
 * rather than misread as garbage.
 *
 * Exit codes: 0 = safe to proceed, 1 = blocking violation, 2 = usage error.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  blockingViolations,
  formatEnvironmentSummary,
  validateEnvironment,
  type EnvironmentInputs,
  type EnvironmentViolation,
} from '../lib/appEnvironmentCore';

const REPO_ROOT = path.resolve(__dirname, '..');

/** Values EAS prints for a secret it will not reveal. */
function isMasked(value: string): boolean {
  return value.startsWith('*****');
}

/**
 * Minimal .env reader. Deliberately not a dependency: this must run before
 * anything is installed or built, and it only needs KEY=value lines.
 */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Same precedence Expo applies: .env.local > .env > process.env. */
function localEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    ...readEnvFile(path.join(REPO_ROOT, '.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.env.local')),
  };
}

function easEnv(environment: string): Record<string, string | undefined> {
  // Windows resolves `eas` to a .cmd shim, which execFileSync can only launch
  // through a shell — so the name is restricted to an identifier rather than
  // being interpolated into a command line unchecked.
  if (!/^[A-Za-z0-9_-]+$/.test(environment)) {
    console.error(`Invalid EAS environment name: ${environment}`);
    process.exit(2);
  }
  let stdout: string;
  try {
    stdout = execFileSync('eas', ['env:list', '--environment', environment], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Could not read the EAS \`${environment}\` environment: ${message}`);
    console.error('Are you logged in (`eas whoami`) and is the project linked?');
    process.exit(2);
  }

  const out: Record<string, string> = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (isMasked(value)) continue; // sensitive: present, but not our business
    out[key] = value;
  }
  return out;
}

function toInputs(env: Record<string, string | undefined>): EnvironmentInputs {
  return {
    appEnv: env.EXPO_PUBLIC_APP_ENV,
    backendEnv: env.EXPO_PUBLIC_BACKEND_ENV,
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL,
    processShareLinkUrl: env.EXPO_PUBLIC_PROCESS_SHARE_LINK_URL,
    createShareJobUrl: env.EXPO_PUBLIC_CREATE_SHARE_JOB_URL,
    allowProductionBackend: env.EXPO_PUBLIC_ALLOW_PRODUCTION_BACKEND,
    demoMode: env.EXPO_PUBLIC_DEMO_MODE,
    devPasswordLogin: env.EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN,
    debugLogs: env.EXPO_PUBLIC_DEBUG_LOGS,
  };
}

function print(label: string, violations: EnvironmentViolation[]): void {
  for (const v of violations) console.log(`  ${label} ${v.code}\n      ${v.message}`);
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const easEnvironment = flag('eas-environment');
const expected = flag('expect');

const source = easEnvironment ? `EAS environment \`${easEnvironment}\`` : 'local .env';
const env = easEnvironment ? easEnv(easEnvironment) : localEnv();
const inputs = toInputs(env);

console.log(`Environment check — source: ${source}`);
console.log(`  ${formatEnvironmentSummary(inputs)}`);

const violations = validateEnvironment(inputs);
const blocking = blockingViolations(violations);
const advisory = violations.filter((v) => !blocking.includes(v));

if (advisory.length > 0) {
  console.log('\nAdvisory:');
  print('•', advisory);
}

let failed = blocking.length > 0;

if (expected) {
  const actual = String(inputs.appEnv ?? '').trim();
  if (actual !== expected) {
    failed = true;
    console.log(
      `\n  BLOCKING EXPECTED_APP_ENV_MISMATCH\n      Expected EXPO_PUBLIC_APP_ENV=${expected} but found ` +
        `${actual || '(unset)'}. Refusing to proceed.`,
    );
  }
}

if (blocking.length > 0) {
  console.log('\nBlocking:');
  print('BLOCKING', blocking);
}

if (failed) {
  console.error('\nEnvironment check FAILED. Fix the configuration before building, exporting or publishing.');
  console.error('See docs/DEVELOPMENT_WORKFLOW.md → Environment variables.');
  process.exit(1);
}

console.log('\nEnvironment check passed.');
