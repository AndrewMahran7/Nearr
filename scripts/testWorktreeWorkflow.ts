/** Source-level and harmless failure-path checks for task:new. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'newTask.mjs');
const source = readFileSync(SCRIPT, 'utf8');
let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures += 1;
}
const noBase = spawnSync(process.execPath, [SCRIPT, 'worktree-contract-probe'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const output = `${noBase.stdout ?? ''}${noBase.stderr ?? ''}`;
check('task:new requires an explicit starting ref', noBase.status !== 0 && /--base/.test(output));
check('missing-base probe creates no worktree', !/Preparing worktree/.test(output));
check('canonical root is Nearr-worktrees', source.includes("'Nearr-worktrees'"));
check('helper creates a missing worktree root', /mkdirSync\(WORKTREE_ROOT/.test(source));
check('helper uses git worktree add with argv', /execFileSync\('git', \['worktree', 'add'/.test(source));
check('helper never enables a shell', !/shell\s*:/.test(source));
if (failures) process.exit(1);
console.log('\nAll worktree-workflow tests passed.');
