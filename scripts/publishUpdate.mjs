#!/usr/bin/env node
/**
 * scripts/publishUpdate.mjs
 *
 * The only supported way to publish an EAS Update. Every lane goes through
 * here so the dangerous argument combination cannot be typed by accident.
 *
 *   npm run dev:update -- -m "Shazam V2 test"
 *   npm run preview:update -- -m "integration/pre-shazam combined build"
 *   npm run prod:update -- -m "..." --yes
 *
 * On 2026-08-18 an update was published to the `production` channel from a
 * feature branch with a dirty working tree. Nothing warned, because
 * `eas update` with no channel argument goes straight to real users. This
 * script is the missing brake:
 *
 *   every lane      channel and environment are always passed explicitly
 *                   the target environment is validated first (checkEnvironment)
 *   production only branch must be `main`
 *                   working tree must be clean
 *                   HEAD must match origin/main
 *                   requires an explicit --yes
 *
 * It never falls back to a default channel: if the lane is unknown it exits.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** lane -> the channel and EAS environment it is allowed to touch. */
const LANES = {
  development: { channel: 'development', environment: 'development', appEnv: 'development' },
  preview: { channel: 'preview', environment: 'preview', appEnv: 'preview' },
  production: { channel: 'production', environment: 'production', appEnv: 'production' },
};

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
}

const [lane, ...rest] = process.argv.slice(2);
const target = LANES[lane];
if (!target) {
  fail(
    `Unknown lane "${lane ?? ''}". Expected one of: ${Object.keys(LANES).join(', ')}.\n` +
      'Use npm run dev:update / preview:update / prod:update.',
  );
}

const confirmed = rest.includes('--yes');
const passthrough = rest.filter((a) => a !== '--yes');

let message = '';
for (let i = 0; i < passthrough.length; i += 1) {
  if (passthrough[i] === '-m' || passthrough[i] === '--message') {
    message = passthrough[i + 1] ?? '';
  }
}
if (!message) {
  fail(
    'A message is required so the update is identifiable later.\n' +
      `  npm run ${lane === 'production' ? 'prod' : lane === 'preview' ? 'preview' : 'dev'}:update -- -m "what changed"`,
  );
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const head = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']) !== '';

console.log(`Publishing an EAS Update`);
console.log(`  lane         ${lane}`);
console.log(`  channel      ${target.channel}`);
console.log(`  environment  ${target.environment}`);
console.log(`  branch       ${branch} @ ${head.slice(0, 8)}${dirty ? ' (DIRTY)' : ''}`);
console.log(`  message      ${message}`);

// --- Production is held to a much higher bar -------------------------------

if (lane === 'production') {
  if (branch !== 'main') {
    fail(
      `Refusing to publish to production from "${branch}".\n` +
        'Production updates originate only from an approved `main`.\n' +
        'Merge the integration branch first (docs/DEVELOPMENT_WORKFLOW.md → Promotion).',
    );
  }
  if (dirty) {
    fail(
      'Refusing to publish to production with a dirty working tree.\n' +
        'The published bundle would not match any commit. Commit or clean first.\n' +
        `${git(['status', '--short'])}`,
    );
  }
  let remoteHead = '';
  try {
    execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: REPO_ROOT });
    remoteHead = git(['rev-parse', 'origin/main']);
  } catch {
    fail('Could not reach origin to confirm main is pushed. Resolve that before publishing.');
  }
  if (remoteHead !== head) {
    fail(
      'Local main does not match origin/main.\n' +
        `  local  ${head.slice(0, 8)}\n  origin ${remoteHead.slice(0, 8)}\n` +
        'Push (or pull) first so the published update is traceable to a commit others can see.',
    );
  }
  if (!confirmed) {
    fail(
      'This publishes to REAL USERS on the production channel.\n' +
        'Re-run with --yes once you have completed the production promotion checklist:\n' +
        '  npm run prod:update -- -m "..." --yes',
    );
  }
}

// --- Validate the target environment before touching anything --------------

console.log(`\nValidating the EAS \`${target.environment}\` environment...`);
const envCheck = run('npx', [
  'ts-node',
  '-P',
  'scripts/tsconfig.json',
  'scripts/checkEnvironment.ts',
  '--eas-environment',
  target.environment,
  '--expect',
  target.appEnv,
]);
if (envCheck !== 0) {
  fail(
    `The EAS \`${target.environment}\` environment is not safe to publish from.\n` +
      'See docs/DEVELOPMENT_WORKFLOW.md → Environment variables for the one-time setup.',
  );
}

// --- Publish ---------------------------------------------------------------

const args = [
  'update',
  '--channel',
  target.channel,
  '--environment',
  target.environment,
  ...passthrough,
];
console.log(`\n$ eas ${args.join(' ')}\n`);
process.exit(run('eas', args));
