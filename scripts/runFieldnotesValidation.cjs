const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const commands = [...new Set([pkg.scripts['pretest:prebuild'], pkg.scripts['test:prebuild']].flatMap(command => [...command.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1])))];
const output = path.join(root, 'artifacts/fieldnotes-implementation/validation');
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];
const sourceCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const requested = process.argv.slice(2);
const pending = requested.length ? commands.filter(command => requested.includes(command)) : commands;
async function worker() {
  while (pending.length) {
    const command = pending.shift();
    const began = Date.now();
    const logName = command.replaceAll(':', '-') + '.log';
    const stream = fs.createWriteStream(path.join(output, logName));
    const exitCode = await new Promise(resolve => {
      const child = cp.spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command], { cwd: root, shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
      child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      child.on('error', () => resolve(-1)); child.on('close', code => resolve(code ?? -1));
    });
    stream.end();
    const result = { command: `npm run ${command}`, exitCode, seconds: Number(((Date.now() - began) / 1000).toFixed(2)), log: logName };
    results.push(result);
    fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ startedAt, sourceCommit, completed: results.length, remaining: pending.length, results }, null, 2) + '\n');
    console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${command} (${result.seconds}s)`);
  }
}
(async () => {
  await Promise.all([worker(), worker(), worker()]);
  const summary = { startedAt, completedAt: new Date().toISOString(), sourceCommit, source: 'Exact unique npm commands from pretest:prebuild and test:prebuild; each command keeps its own lifecycle', concurrency: 3, passed: results.filter(result => result.exitCode === 0).length, failed: results.filter(result => result.exitCode !== 0).length, results };
  fs.writeFileSync(path.join(output, requested.length ? 'retry-results.json' : 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed ? 1 : 0;
})();
