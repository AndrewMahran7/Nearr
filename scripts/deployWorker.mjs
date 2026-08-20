#!/usr/bin/env node
/** Fixed-lane Railway worker deployment wrapper. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCli, runCli } from './lib/cliRunner.js';
import { assertProductionSource } from './lib/productionSource.mjs';
import { EXPECTED_DEV_REF, PRODUCTION_REF } from './devTarget.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = '4037a3b5-d66f-409e-b734-56c22c244e3e';
const TARGETS = {
  development: { environment: 'development', service: 'media-worker', ref: EXPECTED_DEV_REF },
  production: { environment: 'production', service: 'Nearr', ref: PRODUCTION_REF },
};
const [lane, ...argv] = process.argv.slice(2);
const target = TARGETS[lane];

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!target) fail('Expected Railway lane: development | production.');
const confirmed = argv.includes('--yes');
const unexpected = argv.filter((arg) => arg !== '--yes');
if (unexpected.length > 0) fail(`Railway target flags are owned by this wrapper: ${unexpected.join(' ')}`);
if (lane === 'production') assertProductionSource({ repoRoot: REPO_ROOT, onFail: fail });
if (!confirmed) {
  fail(`Deployment requires explicit ownership confirmation: npm run ${lane === 'production' ? 'prod' : 'dev'}:worker -- --yes`);
}

console.log(
  `Railway deploy lane=${lane} project=${PROJECT} environment=${target.environment} ` +
    `service=${target.service} expectedSupabase=${target.ref}`,
);

let variables;
try {
  variables = JSON.parse(
    captureCli(
      'railway',
      ['variables', '--json', '--project', PROJECT, '--environment', target.environment, '--service', target.service],
      { cwd: REPO_ROOT },
    ),
  );
} catch (err) {
  fail(`Could not verify Railway variables; no deployment started. ${(err instanceof Error && err.message) || err}`);
}

function findValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === 'string') return value[key];
  for (const child of Object.values(value)) {
    const found = findValue(child, key);
    if (found) return found;
  }
  return undefined;
}

const supabaseUrl = findValue(variables, 'SUPABASE_URL') || '';
let ref = '';
try {
  ref = new URL(supabaseUrl).hostname.split('.')[0].toLowerCase();
} catch {
  // Refuse below.
}
if (ref !== target.ref) {
  fail(`Railway ${lane} resolves to Supabase ref ${ref || '(missing/invalid)'}, expected ${target.ref}.`);
}

const args = [
  'up',
  'services/media-worker',
  '--path-as-root',
  '--project',
  PROJECT,
  '--environment',
  target.environment,
  '--service',
  target.service,
];
console.log(`\n$ railway ${args.join(' ')}\n`);
process.exit(runCli('railway', args, { cwd: REPO_ROOT }));
