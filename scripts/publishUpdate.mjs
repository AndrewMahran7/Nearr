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

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalBin, runCli } from './lib/cliRunner.js';
import { LANES, buildUpdateArgs, parseUpdateArgs } from './lib/updateArgs.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Run a CLI with an argv ARRAY and no shell (scripts/lib/cliRunner.js).
 *
 * The previous `shell: process.platform === 'win32'` joined argv into one
 * unquoted command line, which is what destroyed `-m "a message with spaces"`
 * and what Node's DEP0190 warning was pointing at.
 */
function run(command, args) {
  try {
    return runCli(command, args, { cwd: REPO_ROOT });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const [lane, ...rest] = process.argv.slice(2);
const target = LANES[lane];
if (!target) {
  fail(
    `Unknown lane "${lane ?? ''}". Expected one of: ${Object.keys(LANES).join(', ')}.\n` +
      'Use npm run dev:update / preview:update / prod:update.',
  );
}

const { message, passthrough, confirmed } = parseUpdateArgs(rest);
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
// ts-node is a devDependency here, so run it from this repo's node_modules
// with `process.execPath` rather than shelling out through `npx` (which is
// itself a .cmd shim on Windows and would drag the shell back in).
const tsNodeBin = resolveLocalBin('ts-node/dist/bin.js');
if (!tsNodeBin) {
  fail('Could not resolve ts-node from node_modules. Run `npm install` first.');
}
const envCheck = runCli(
  process.execPath,
  [
    tsNodeBin,
    '-P',
    'scripts/tsconfig.json',
    'scripts/checkEnvironment.ts',
    '--eas-environment',
    target.environment,
    '--expect',
    target.appEnv,
  ],
  { cwd: REPO_ROOT },
);
if (envCheck !== 0) {
  fail(
    `The EAS \`${target.environment}\` environment is not safe to publish from.\n` +
      'See docs/DEVELOPMENT_WORKFLOW.md → Environment variables for the one-time setup.',
  );
}

// --- Publish ---------------------------------------------------------------

// buildUpdateArgs owns the targeting flags and REFUSES any caller argument that
// would retarget the lane. Previously passthrough was appended after the
// wrapper's own --channel and EAS honours the last occurrence, so
// `npm run dev:update -- -m "x" --channel production` published to production
// from the development wrapper.
let args;
try {
  args = buildUpdateArgs(lane, passthrough);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

// Display only. The real call passes this array to a shell-free spawn, so a
// message containing spaces or shell metacharacters stays a single argument.
console.log(
  `\n$ eas ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`,
);
process.exit(run('eas', args));
