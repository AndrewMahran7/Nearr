// Execute every existing prebuild/lifecycle command, plus onboarding safety suites.
// Dedicated receipts avoid overwriting the integration release's qualification evidence.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = [...new Set(['pretest:prebuild', 'test:prebuild', 'test:safe-development'].flatMap(name => [...pkg.scripts[name].matchAll(/npm run ([\w:-]+)/g)].map(match => match[1])).concat([
  'test:birthday-onboarding', 'test:global-eligibility-db', 'test:localization', 'test:native-localization', 'test:consent-identity', 'test:recognition-consent', 'test:privacy-policy',
  'test:onboarding-authentic-phase2-auth', 'test:onboarding-install-lifecycle', 'test:onboarding-account-transition', 'test:create-map-navigation', 'test:create-map-continue-runtime',
]))];
const output = 'artifacts/onboarding-birthday-language/validation';
mkdirSync(output, { recursive: true });
const results = [];
const startedAt = new Date().toISOString();
let next = 0;
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
async function worker() {
  while (next < scripts.length) {
    const name = scripts[next++];
    if (!pkg.scripts[name]) throw new Error(`Unknown script: ${name}`);
    const logfile = path.join(output, name.replaceAll(':', '-') + '.log');
    const stream = createWriteStream(logfile);
    const start = Date.now();
    const exit = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli, 'run', name], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
      child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      const timer = setTimeout(() => { child.kill(); }, 300_000);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve(code ?? -1); });
    });
    await new Promise(resolve => stream.end(resolve));
    results.push({ name, exit, durationMs: Date.now() - start, logfile });
    console.log(`${exit === 0 ? 'PASS' : 'FAIL'} ${name} (${results.length}/${scripts.length})`);
  }
}
await Promise.all([worker(), worker()]);
// Write once, after both workers finish, avoiding incremental Windows file contention.
writeFileSync(path.join(output, 'results.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), total: scripts.length, passed: results.filter(r => r.exit === 0).length, failed: results.filter(r => r.exit !== 0).length, results }, null, 2) + '\n');
process.exitCode = results.some(result => result.exit !== 0) ? 1 : 0;
