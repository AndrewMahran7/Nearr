/** Regression contracts for build/backend deployment wrappers. No deploy runs. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}
function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

check('dev build uses the fixed-lane wrapper', pkg.scripts['dev:build'] === 'node scripts/buildApp.mjs development');
check('preview build uses the fixed-lane wrapper', pkg.scripts['preview:build'] === 'node scripts/buildApp.mjs preview');
check('dev worker uses the fixed-lane wrapper', pkg.scripts['dev:worker'] === 'node scripts/deployWorker.mjs development');
for (const name of ['prod:update', 'prod:rollback', 'prod:build', 'prod:functions', 'prod:db', 'prod:worker']) {
  check(`${name} has an explicit guarded command`, typeof pkg.scripts[name] === 'string');
}

const buildRetarget = run('buildApp.mjs', ['development', '--profile', 'production']);
check('dev build rejects caller targeting flags', buildRetarget.status !== 0 && /owned by this wrapper/.test(buildRetarget.out));
check('rejected dev build never reaches EAS', !/\$ eas build/.test(buildRetarget.out));

const workerUnconfirmed = run('deployWorker.mjs', ['development']);
check('dev worker requires explicit deployment ownership', workerUnconfirmed.status !== 0 && /--yes/.test(workerUnconfirmed.out));
check('unconfirmed dev worker never reaches Railway', !/\$ railway up/.test(workerUnconfirmed.out));

const rollbackRetarget = run('rollbackUpdate.mjs', ['development', '--channel', 'production']);
check('dev rollback rejects caller targeting flags', rollbackRetarget.status !== 0 && /owned by this wrapper/.test(rollbackRetarget.out));
check('rejected dev rollback never reaches EAS', !/\$ eas update:rollback/.test(rollbackRetarget.out));

for (const [label, script, args, marker] of [
  ['production build', 'buildApp.mjs', ['production'], '$ eas build'],
  ['production worker', 'deployWorker.mjs', ['production'], '$ railway up'],
  ['production functions', 'deployFunctions.mjs', ['--production'], '$ supabase functions deploy'],
  ['production database', 'pushDevDatabase.mjs', ['--production'], '$ supabase db push'],
] as const) {
  const result = run(script, [...args]);
  check(`${label} refuses this non-main/dirty checkout`, result.status !== 0, result.out);
  check(`${label} refusal occurs before deployment`, !result.out.includes(marker), result.out);
}

const buildSource = readFileSync(path.join(ROOT, 'scripts', 'buildApp.mjs'), 'utf8');
check(
  'build verifies the environment before invoking EAS',
  buildSource.indexOf('scripts/checkEnvironment.ts') < buildSource.indexOf("const args = ['build'"),
);
const workerSource = readFileSync(path.join(ROOT, 'scripts', 'deployWorker.mjs'), 'utf8');
check(
  'worker verifies Railway SUPABASE_URL before railway up',
  workerSource.indexOf("'SUPABASE_URL'") < workerSource.indexOf("'up',"),
);
check('worker has no shell interpolation', !/shell\s*:/.test(workerSource));

if (failures) {
  console.error(`\n${failures} deployment-guard test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll deployment-guard tests passed.');
