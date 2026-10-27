// Run actual npm entry points, including the complete prebuild lifecycle.
// Extra suites cover the unified Fieldnotes, Plus and deferred Phase 2 contracts.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
const fullMatrix = [
  'test:prebuild', 'test:safe-development', 'test:birthday-onboarding',
  'test:onboarding-native-contract', 'test:localization', 'test:native-localization',
  'test:global-eligibility-db', 'test:global-monetization', 'test:global-monetization-db',
  'test:consent-identity', 'test:recognition-consent', 'test:privacy-policy',
  'test:onboarding-account-transition', 'test:create-map-navigation', 'test:create-map-continue-runtime',
  'test:onboarding-phase2-auth-map-hardening', 'test:onboarding-v2-phase2',
  'test:onboarding-v2-physical-runtime', 'test:onboarding-v2-hands-on-activation',
  'test:onboarding-v2-visual', 'test:onboarding-1259-regressions',
  'test:fieldnotes-oct15', 'test:fieldnotes-oct18', 'test:fieldnotes-physical-ui',
  'test:place-detail-ui', 'test:saved-place-result-ui',
  'test:monetization-token-ux', 'test:monetization-integration',
  'test:monetization-suspension-contract', 'test:premium-request-monetization',
];
const phase = process.argv[2] ?? 'full';
if (!['full', 'ten'].includes(phase)) throw new Error('Expected full or ten');
const original = JSON.parse(readFileSync('artifacts/global-release/onboarding-integration/tests/results.json', 'utf8'));
const scripts = phase === 'ten' ? original.results.filter(r => r.exit !== 0).map(r => r.name) : fullMatrix;
if (scripts.length !== (phase === 'ten' ? 10 : 30)) throw new Error('Original matrix count changed');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of scripts) if (!pkg.scripts[name]) throw new Error(`Unknown script: ${name}`);
const output = `artifacts/global-release/android-qualification/${phase}`;
mkdirSync(output, { recursive: true });
const results = [], startedAt = new Date().toISOString();
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
let next = 0;
async function worker() {
  while (next < scripts.length) {
    const name = scripts[next++], start = Date.now();
    const logfile = path.join(output, name.replaceAll(':', '-') + '.log');
    const stream = createWriteStream(logfile);
    const exit = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli, 'run', name], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
      child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
      child.on('error', reject); child.on('close', code => resolve(code ?? -1));
    });
    await new Promise(resolve => stream.end(resolve));
    results.push({ name, command: `npm run ${name}`, exit, durationMs: Date.now() - start, logfile });
    console.log(`${exit === 0 ? 'PASS' : 'FAIL'} ${name} (${results.length}/${scripts.length})`);
  }
}
// The ten original failures run in isolation, never sharing a process or output.
await Promise.all(phase === 'ten' ? [worker()] : [worker(), worker()]);
writeFileSync(path.join(output, 'results.json'), JSON.stringify({ sourceSha, startedAt, finishedAt: new Date().toISOString(), total: scripts.length, passed: results.filter(r => r.exit === 0).length, failed: results.filter(r => r.exit !== 0).length, results }, null, 2) + '\n');
process.exitCode = results.some(result => result.exit !== 0) ? 1 : 0;
