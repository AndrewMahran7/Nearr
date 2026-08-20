#!/usr/bin/env node
/** Fixed-channel EAS Update rollback. Caller cannot retarget the lane. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalBin, runCli } from './lib/cliRunner.js';
import { assertProductionSource } from './lib/productionSource.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANES = new Set(['development', 'preview', 'production']);
const [lane, ...argv] = process.argv.slice(2);
function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
if (!LANES.has(lane)) fail('Expected rollback lane: development | preview | production.');
const confirmed = argv.includes('--yes');
if (argv.some((arg) => arg !== '--yes')) fail('Rollback targeting flags are owned by this wrapper.');
if (lane === 'production') {
  assertProductionSource({ repoRoot: ROOT, onFail: fail });
  if (!confirmed) fail('Production rollback requires: npm run prod:rollback -- --yes');
}

const tsNodeBin = resolveLocalBin('ts-node/dist/bin.js');
if (!tsNodeBin) fail('Could not resolve ts-node. Run npm install first.');
const check = runCli(
  process.execPath,
  [tsNodeBin, '-P', 'scripts/tsconfig.json', 'scripts/checkEnvironment.ts', '--eas-environment', lane, '--expect', lane],
  { cwd: ROOT },
);
if (check !== 0) fail(`The EAS ${lane} environment failed verification; no rollback started.`);

const args = ['update:rollback', '--channel', lane];
console.log(`\n$ eas ${args.join(' ')}\n`);
process.exit(runCli('eas', args, { cwd: ROOT }));
