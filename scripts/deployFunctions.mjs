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

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { runCli } from './lib/cliRunner.js';
import { assertProductionSource } from './lib/productionSource.mjs';
import { PRODUCTION_REF, REPO_ROOT, describeRef, resolveDevProjectRef } from './devTarget.mjs';

const FUNCTIONS_DIR = path.join(REPO_ROOT, 'supabase', 'functions');

/**
 * Functions that intentionally receive unauthenticated requests. The runtime
 * handlers either authenticate the caller themselves or, for the development
 * fixture, hard-refuse every non-development Supabase deployment.
 * Anything absent here keeps Supabase's default JWT verification.
 */
const NO_VERIFY_JWT = new Set(['e2e-place-fixture', 'process-share-jobs', 'process-share-link']);
const DEVELOPMENT_ONLY_FUNCTIONS = new Set(['e2e-place-fixture']);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const production = argv.includes('--production');
const refFlagIndex = argv.indexOf('--project-ref');
const explicitRef = refFlagIndex >= 0 ? argv[refFlagIndex + 1] : undefined;
const selected = argv.filter(
  (a, i) => !a.startsWith('--') && !(refFlagIndex >= 0 && i === refFlagIndex + 1),
);

// Target resolution and the production refusal live in scripts/devTarget.mjs so
// this script and `npm run dev:db` cannot drift apart. Reading .env.local there
// also closes a real gap: Node does not load .env files and neither does npm,
// so the previous process.env-only lookup never saw NEARR_DEV_SUPABASE_REF.
if (production && explicitRef) fail('Production target is owned by the wrapper; do not pass --project-ref.');
if (production) assertProductionSource({ repoRoot: REPO_ROOT, onFail: fail });
const projectRef = production
  ? PRODUCTION_REF
  : resolveDevProjectRef({ explicitRef, onFail: fail });

const available = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

const targets = selected.length > 0
  ? selected
  : production
    ? available.filter((name) => !DEVELOPMENT_ONLY_FUNCTIONS.has(name))
    : available;
for (const name of targets) {
  if (!available.includes(name)) {
    fail(`Unknown function "${name}". Available: ${available.join(', ')}.`);
  }
  if (production && DEVELOPMENT_ONLY_FUNCTIONS.has(name)) {
    fail(`Function "${name}" is development-only and cannot be deployed to production.`);
  }
}

console.log(`Deploying Supabase Edge Functions (${production ? 'PRODUCTION' : 'development'})`);
console.log(`  project ref  ${describeRef(projectRef)}`);
console.log(`  functions    ${targets.join(', ')}`);
for (const name of targets) {
  if (NO_VERIFY_JWT.has(name)) console.log(`               ${name} -> --no-verify-jwt`);
}

if (!confirmed) {
  fail(
    `This deploys to project ${projectRef}. Confirm the target and deployment ownership,\n` +
      'then re-run with --yes:\n' +
      `  npm run ${production ? 'prod' : 'dev'}:functions -- ${targets.join(' ')} --yes`,
  );
}

for (const name of targets) {
  const args = ['functions', 'deploy', name, '--project-ref', projectRef];
  if (NO_VERIFY_JWT.has(name)) args.push('--no-verify-jwt');
  console.log(`\n$ supabase ${args.join(' ')}\n`);
  // Argv array, no shell — see scripts/lib/cliRunner.js.
  const result = { status: runCli('supabase', args, { cwd: REPO_ROOT }) };
  if ((result.status ?? 1) !== 0) {
    fail(`Deploy of ${name} failed. Remaining functions were not deployed.`);
  }
}

console.log('\nAll selected functions deployed.');
