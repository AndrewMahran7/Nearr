#!/usr/bin/env node
/**
 * scripts/pushDevDatabase.mjs
 *
 * Apply supabase/migrations/ to the DEVELOPMENT database, and only ever there.
 *
 *   npm run dev:db            # show what would be applied
 *   npm run dev:db -- --yes   # apply
 *
 * WHY THIS EXISTS
 * ---------------
 * `eas update` and Edge Function deploys were already guarded, but
 * `supabase db push --linked` was not: it targets whatever project the CLI
 * happens to be linked to. The 2026-08-19 audit found the CLI linked to
 * PRODUCTION, which made "apply the new Shazam migration to dev" one habitual
 * command away from altering real user schema. Re-linking fixes today; this
 * script fixes the class, because the link can silently change again.
 *
 * The target is proven from an explicit ref, never inherited:
 *
 *   1. NEARR_DEV_SUPABASE_REF must be set (.env.local).
 *   2. It must not be the known production ref.
 *   3. It must match the expected Nearr-Dev ref compiled in below.
 *   4. The CLI's currently-linked project must agree with it.
 *
 * Any doubt and it refuses. There is deliberately no generic `db:push` script:
 * a production migration is typed by hand, with the ref visible in the command
 * (docs/DEVELOPMENT_WORKFLOW.md -> Production promotion).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_DEV_REF,
  REPO_ROOT,
  describeRef,
  linkedProjectRef,
  resolveDevProjectRef,
} from './devTarget.mjs';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const refFlagIndex = argv.indexOf('--project-ref');
const explicitRef = refFlagIndex >= 0 ? argv[refFlagIndex + 1] : undefined;

// ---- Gates 1-3: the ref must exist, not be production, and be recognised ---

const projectRef = resolveDevProjectRef({ explicitRef, onFail: fail });

// ---- Gate 4: the CLI link must agree --------------------------------------
//
// `supabase db push` uses the LINKED project, so a mismatch between the ref we
// just verified and the ref the CLI would actually use is the exact failure
// this script exists to prevent. Refuse rather than re-link silently — a script
// that quietly repoints the CLI is indistinguishable from the bug.

const linkedRef = linkedProjectRef();

if (!linkedRef) {
  fail(
    'The Supabase CLI is not linked to any project, so `db push` has no target.\n' +
      `Run:  supabase link --project-ref ${EXPECTED_DEV_REF}`,
  );
}
if (linkedRef !== projectRef) {
  fail(
    'REFUSING: the CLI is linked to a different project than the verified target.\n' +
      `  verified target : ${describeRef(projectRef)}\n` +
      `  CLI linked to   : ${describeRef(linkedRef)}\n\n` +
      `Re-link before continuing:  supabase link --project-ref ${projectRef}`,
  );
}

// ---- Report, then apply ---------------------------------------------------

const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log('Development database push');
console.log(`  target ref   ${describeRef(projectRef)}`);
console.log(`  CLI linked   ${linkedRef}  [agrees]`);
console.log(`  migrations   ${migrations.length} file(s) in supabase/migrations/`);
console.log(`  newest       ${migrations[migrations.length - 1] ?? '(none)'}`);

if (!confirmed) {
  console.log(
    '\nDry run. Nothing was applied. Re-run with --yes to push:\n' +
      '  npm run dev:db -- --yes',
  );
  process.exit(0);
}

const args = ['db', 'push', '--linked', ...argv.filter((a) => a !== '--yes')];
console.log(`\n$ supabase ${args.join(' ')}\n`);
const result = spawnSync('supabase', args, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
