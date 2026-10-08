import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit offline suites omitted from the repository's large prebuild chain.
// Live provider and Development mutation proofs are deliberately excluded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let suites = [
  'test:recognition-geography-state', 'test:recognition-entity-role-latency-state',
  'test:exact-identity-safety', 'test:recognition-cache', 'test:recognition-cache-v2',
  'test:recognition-cache-suspension', 'test:recognition-migrations',
  'test:wrong-place-confirm-replacement', 'test:wrong-place-mutation',
  'test:google-cost-controls-integration', 'test:google-cost-controls-ux',
  'test:named-lead-auto-completion', 'test:auto-completion', 'test:multi-place-review',
  'test:multi-place-progressive-disclosure', 'test:multi-place-browse-v2',
  'test:recognition-regression', 'test:dev-migration-history',
  'test:deployment-guards', 'test:worktree-workflow',
  'test:place-capabilities', 'test:place-photo-contract', 'test:notification-delivery-policy',
];
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).scripts;
const inventoryArg = process.argv.indexOf('--inventory');
if (inventoryArg >= 0) {
  const inventory = JSON.parse(fs.readFileSync(path.resolve(root, process.argv[inventoryArg + 1]), 'utf8'));
  for (const entry of inventory.remainingOfflineSuites) {
    if (scripts[entry.suite] !== entry.command) throw new Error(`inventory_command_changed:${entry.suite}`);
  }
  suites = inventory.remainingOfflineSuites.map((entry) => entry.suite);
}
const onlyArg = process.argv.indexOf('--only');
if (onlyArg >= 0) suites = suites.filter((suite) => process.argv[onlyArg + 1].split(',').includes(suite));
const logArg = process.argv.indexOf('--log-name');
const logName = logArg >= 0 ? process.argv[logArg + 1] : inventoryArg >= 0 ? 'offline-remaining' : 'regression-checks';
if (!/^[a-z0-9_-]+$/.test(logName)) throw new Error('invalid_log_name');
const directory = path.join(root, '.tmp', logName);
fs.mkdirSync(directory, { recursive: true });
const results = [];
for (const suite of suites) {
  if (!scripts[suite]) { results.push({ suite, status: 'missing_command' }); continue; }
  const log = path.join(directory, suite.replaceAll(':', '-') + '.log');
  const fd = fs.openSync(log, 'w');
  const started = Date.now();
  // npm's CLI is invoked directly, avoiding shell quoting and visible windows.
  const npm = process.env.npm_execpath ?? 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npm, 'run', suite], { cwd: root, stdio: ['ignore', fd, fd], windowsHide: true,
      env: { ...process.env, MEDIA_E2E_TESTS: '0', MEDIA_LIVE_TESTS: '0', INSTAGRAM_LIVE_TESTS: '0', NATIVE_VIDEO_LIVE_TESTS: '0' } });
    child.on('error', reject); child.on('exit', resolve);
  });
  fs.closeSync(fd);
  results.push({ suite, status: code === 0 ? 'passed' : 'failed', exitCode: code, elapsedMs: Date.now() - started, log: path.relative(root, log) });
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ results }, null, 2) + '\n');
  console.log(`${suite}: ${code === 0 ? 'PASS' : 'FAIL'}`);
}
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ results }, null, 2) + '\n');
if (results.some((r) => r.status !== 'passed')) process.exitCode = 1;
