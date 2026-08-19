#!/usr/bin/env node
/**
 * scripts/deployFunctions.mjs
 *
 * Deploy Supabase Edge Functions to an EXPLICITLY NAMED project.
 *
 *   npm run dev:functions                      # all functions -> $NEARR_DEV_SUPABASE_REF
 *   npm run dev:functions -- process-share-jobs
 *
 * Two things this exists to prevent:
 *
 * 1. An ambiguous target. `supabase functions deploy` with no --project-ref
 *    silently uses whatever project is linked — which is production. This
 *    script has NO default: the ref comes from --project-ref or from
 *    NEARR_DEV_SUPABASE_REF, and it refuses to run without one.
 *
 * 2. Forgetting --no-verify-jwt. `process-share-jobs` and `process-share-link`
 *    are invoked by the worker and the share extension with their own secrets
 *    rather than a user JWT, and have historically broken when redeployed
 *    without the flag. The per-function requirement is encoded below and
 *    mirrors the live production configuration.
 *
 * Production Edge Function deploys are NOT wired into package.json. That is
 * deliberate — see docs/DEVELOPMENT_WORKFLOW.md → Production promotion for the
 * explicit command.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = path.join(REPO_ROOT, 'supabase', 'functions');

/**
 * Functions that must be deployed with --no-verify-jwt because they
 * authenticate the caller themselves. Anything absent here keeps Supabase's
 * default JWT verification.
 */
const NO_VERIFY_JWT = new Set(['process-share-jobs', 'process-share-link']);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const refFlagIndex = argv.indexOf('--project-ref');
const explicitRef = refFlagIndex >= 0 ? argv[refFlagIndex + 1] : undefined;
const selected = argv.filter(
  (a, i) => !a.startsWith('--') && i !== refFlagIndex + 1,
);

const projectRef = (explicitRef || process.env.NEARR_DEV_SUPABASE_REF || '').trim();
if (!projectRef) {
  fail(
    'No target project.\n' +
      'Set NEARR_DEV_SUPABASE_REF in .env.local (the development Supabase project ref),\n' +
      'or pass --project-ref <ref> explicitly.\n' +
      'This script never falls back to the linked project, because that is production.',
  );
}
if (!/^[a-z]{20}$/.test(projectRef)) {
  fail(`"${projectRef}" does not look like a Supabase project ref (20 lowercase letters).`);
}

const available = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const targets = selected.length > 0 ? selected : available;
for (const name of targets) {
  if (!available.includes(name)) {
    fail(`Unknown function "${name}". Available: ${available.join(', ')}.`);
  }
}

console.log('Deploying Supabase Edge Functions');
console.log(`  project ref  ${projectRef}`);
console.log(`  functions    ${targets.join(', ')}`);
for (const name of targets) {
  if (NO_VERIFY_JWT.has(name)) console.log(`               ${name} -> --no-verify-jwt`);
}

if (!confirmed) {
  fail(
    `This deploys to project ${projectRef}. Confirm the ref is your DEVELOPMENT project,\n` +
      'then re-run with --yes:\n' +
      `  npm run dev:functions -- ${targets.join(' ')} --yes`,
  );
}

for (const name of targets) {
  const args = ['functions', 'deploy', name, '--project-ref', projectRef];
  if (NO_VERIFY_JWT.has(name)) args.push('--no-verify-jwt');
  console.log(`\n$ supabase ${args.join(' ')}\n`);
  const result = spawnSync('supabase', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    fail(`Deploy of ${name} failed. Remaining functions were not deployed.`);
  }
}

console.log('\nAll selected functions deployed.');
