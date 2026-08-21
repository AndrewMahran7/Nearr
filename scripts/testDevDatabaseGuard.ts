/**
 * scripts/testDevDatabaseGuard.ts
 *
 * Regression test for the development-database guard
 * (scripts/pushDevDatabase.mjs, behind `npm run dev:db`).
 *
 * The 2026-08-19 audit found the Supabase CLI linked to PRODUCTION, which made
 * `supabase db push --linked` — the obvious way to apply a new migration —
 * one habitual command away from altering real user schema. Re-linking fixed
 * that day; this test locks the class of failure shut, because a link can
 * silently change again.
 *
 * Every case here stops the script BEFORE it can invoke the Supabase CLI, so
 * running this test never touches any database.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testDevDatabaseGuard.ts
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'pushDevDatabase.mjs');

const PRODUCTION_REF = 'rlqvxdwtetxsqxhqztkw';
const DEV_REF = 'qnfxnmvxpjzfydgudtvs';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

type Run = { status: number; out: string };

function run(args: string[]): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// ---- The production ref must be refused outright ---------------------------
const prod = run(['--project-ref', PRODUCTION_REF, '--yes']);
check('production ref exits non-zero', prod.status !== 0, `status=${prod.status}`);
check('production ref is named as production', /PRODUCTION/.test(prod.out));
check(
  'production ref never reaches the Supabase CLI',
  !/\$ supabase db push/.test(prod.out),
  'the guard must refuse before invoking the CLI',
);

// ---- An unrecognised ref cannot be proven safe, so it is refused -----------
const unknown = run(['--project-ref', 'aaaaaaaaaaaaaaaaaaaa', '--yes']);
check('unknown ref exits non-zero', unknown.status !== 0, `status=${unknown.status}`);
check(
  'unknown ref explains it cannot be proven safe',
  /neither the production project nor the/.test(unknown.out),
);
check(
  'unknown ref never reaches the Supabase CLI',
  !/\$ supabase db push/.test(unknown.out),
);

// ---- The development ref is accepted, but only dry-runs without --yes ------
const dry = run(['--project-ref', DEV_REF]);
check('development ref is accepted', dry.status === 0, `status=${dry.status}\n${dry.out}`);
check('development ref reports the target', dry.out.includes(DEV_REF));
check('without --yes it is a dry run', /Dry run\. Nothing was applied\./.test(dry.out));
check(
  'without --yes it never reaches the Supabase CLI',
  !/\$ supabase db push/.test(dry.out),
);

// ---- The CLI link must agree with the verified target ----------------------
// Proven indirectly: the dev ref passes only while the CLI is linked to it, so
// a run that succeeds is also evidence the link check ran and agreed.
check(
  'a successful dry run confirms the CLI link agrees',
  dry.out.includes('[agrees]'),
  'expected the link-agreement line in the report',
);

// ---- The Edge Function deploy shares the same guard ------------------------
//
// scripts/deployFunctions.mjs resolves its target through the same
// scripts/devTarget.mjs module. Before 2026-08-19 it accepted ANY well-formed
// ref, so `--project-ref <production>` would have deployed to real users; and
// it read only process.env, so it never saw NEARR_DEV_SUPABASE_REF from
// .env.local. Both are covered here so the two scripts cannot drift apart.

const FUNCTIONS_SCRIPT = path.join(REPO_ROOT, 'scripts', 'deployFunctions.mjs');

function runFunctions(args: string[]): Run {
  const result = spawnSync(process.execPath, [FUNCTIONS_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // Strip the ref from the inherited environment so the .env.local lookup is
    // what is actually being exercised, not a value npm happened to pass down.
    env: { ...process.env, NEARR_DEV_SUPABASE_REF: '' },
  });
  return {
    status: result.status ?? -1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const fnProd = runFunctions(['--project-ref', PRODUCTION_REF, '--yes']);
check('dev:functions refuses the production ref', fnProd.status !== 0);
check('dev:functions names it as production', /PRODUCTION/.test(fnProd.out));
check(
  'dev:functions never reaches the Supabase CLI for production',
  !/\$ supabase functions deploy/.test(fnProd.out),
);

const fnUnknown = runFunctions(['--project-ref', 'bbbbbbbbbbbbbbbbbbbb', '--yes']);
check('dev:functions refuses an unrecognised ref', fnUnknown.status !== 0);

const fnDefault = runFunctions([]);
check(
  'dev:functions reads NEARR_DEV_SUPABASE_REF from .env.local',
  fnDefault.out.includes(DEV_REF),
  'the ref was not resolved from the env file',
);
check(
  'dev:functions requires --yes before deploying',
  fnDefault.status !== 0 && !/\$ supabase functions deploy/.test(fnDefault.out),
);

const fnSelected = runFunctions(['process-share-jobs']);
check(
  'dev:functions preserves the first positional function selector',
  /functions\s+process-share-jobs(?:\r?\n|$)/.test(fnSelected.out),
  'the requested function was not the sole selected deploy target',
);
check(
  'dev:functions does not broaden a selected deploy to unrelated functions',
  !/functions\s+.*create-share-job/.test(fnSelected.out),
  'the selected deploy unexpectedly included another function',
);

if (failures > 0) {
  console.error(`\n${failures} dev-database-guard test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll dev-database-guard tests passed.');
