// Offline prebuild-equivalent validation plus the October 15 runtime regressions.
// No expo prebuild, remote proofs, deployment, migration or live mutation commands.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const names = [...new Set([pkg.scripts['pretest:prebuild'], pkg.scripts['test:prebuild']].flatMap(command => [...command.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1])))];
const commands = names.map(name => ({ name, executable: 'npm', args: ['run', name] }));
for (const file of ['testFieldnotesSearchRuntime', 'testFieldnotesSettingsRuntime']) commands.push({ name: file, executable: 'npx', args: ['ts-node', '-P', 'scripts/tsconfig.json', `scripts/${file}.ts`] });
const output = path.join(root, 'artifacts/fieldnotes-oct15/validation');
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const sourceCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const requested = process.argv.slice(2);
const pending = requested.length ? commands.filter(command => requested.includes(command.name)) : commands;
const results = [];
async function worker() {
  while (pending.length) {
    const command = pending.shift();
    const began = Date.now();
    const logName = command.name.replaceAll(':', '-') + '.log';
    const stream = fs.createWriteStream(path.join(output, logName));
    const exitCode = await new Promise(resolve => {
      const child = cp.spawn(process.platform === 'win32' ? command.executable + '.cmd' : command.executable, command.args, { cwd: root, shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
      child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      child.on('error', error => { stream.write(String(error)); resolve(-1); });
      child.on('close', code => resolve(code ?? -1));
    });
    await new Promise(resolve => stream.end(resolve));
    const result = { name: command.name, command: [command.executable, ...command.args].join(' '), exitCode, seconds: Number(((Date.now() - began) / 1000).toFixed(2)), log: logName };
    results.push(result);
    fs.writeFileSync(path.join(output, requested.length ? 'retry-progress.json' : 'progress.json'), JSON.stringify({ startedAt, sourceCommit, completed: results.length, remaining: pending.length, results }, null, 2) + '\n');
    console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${command.name} (${result.seconds}s)`);
  }
}
(async () => {
  await Promise.all([worker(), worker(), worker()]);
  const summary = { startedAt, completedAt: new Date().toISOString(), sourceCommit, source: 'Exact unique npm commands from pretest:prebuild and test:prebuild; each retains lifecycle; plus October 15 search/settings runtime tests. Sources include concurrent uncommitted changes; failed modified modules rerun after stabilization.', concurrency: 3, passed: results.filter(result => result.exitCode === 0).length, failed: results.filter(result => result.exitCode !== 0).length, results };
  fs.writeFileSync(path.join(output, requested.length ? 'retry-results.json' : 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed ? 1 : 0;
})();
