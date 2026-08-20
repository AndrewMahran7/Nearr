#!/usr/bin/env node
/** Fixed-lane EAS build wrapper. It validates the EAS environment first. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalBin, runCli } from './lib/cliRunner.js';
import { assertProductionSource } from './lib/productionSource.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANES = new Set(['development', 'preview', 'production']);
const [lane, ...argv] = process.argv.slice(2);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!LANES.has(lane)) fail('Expected build lane: development | preview | production.');
const confirmed = argv.includes('--yes');
const unexpected = argv.filter((arg) => arg !== '--yes');
if (unexpected.length > 0) {
  fail(`Targeting/build flags are owned by this wrapper; unexpected: ${unexpected.join(' ')}`);
}
if (lane === 'production') {
  assertProductionSource({ repoRoot: REPO_ROOT, onFail: fail });
  if (!confirmed) fail('Production build requires explicit confirmation: npm run prod:build -- --yes');
}

console.log(`Building app lane=${lane} profile=${lane} platform=ios`);
const tsNodeBin = resolveLocalBin('ts-node/dist/bin.js');
if (!tsNodeBin) fail('Could not resolve ts-node. Run npm install first.');
const check = runCli(
  process.execPath,
  [
    tsNodeBin,
    '-P',
    'scripts/tsconfig.json',
    'scripts/checkEnvironment.ts',
    '--eas-environment',
    lane,
    '--expect',
    lane,
  ],
  { cwd: REPO_ROOT },
);
if (check !== 0) fail(`The EAS ${lane} environment failed verification; no build started.`);

const args = ['build', '--profile', lane, '--platform', 'ios'];
console.log(`\n$ eas ${args.join(' ')}\n`);
process.exit(runCli('eas', args, { cwd: REPO_ROOT }));
