// Read-only EAS inventory with a hard deadline; never echo credentials/config.
const { spawnSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../artifacts/global-release/final-production/store');
mkdirSync(output, { recursive: true });
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'eas build:list --platform ios --limit 5 --non-interactive --json'], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 90000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
});
let receipt = { checkedAt: new Date().toISOString(), readOnly: true, exitCode: result.status, timedOut: result.error?.code === 'ETIMEDOUT' };
try {
  if (result.status !== 0) throw new Error('inventory_failed');
  const builds = JSON.parse(result.stdout);
  receipt = { ...receipt, builds: builds.map(b => Object.fromEntries(
    ['id', 'status', 'distribution', 'buildProfile', 'appVersion', 'appBuildVersion', 'runtimeVersion', 'gitCommitHash', 'createdAt']
      .map(k => [k, b[k] ?? null]))) };
} catch {
  receipt.error = 'EAS inventory did not return a successful JSON result. No build or submission was started.';
  // Retain only generic, non-secret diagnostics, never full CLI output.
  receipt.diagnostics = (result.stderr || '').split(/\r?\n/).filter(l => /Error:|Cannot find module|command failed|request failed|timed out/i.test(l)).map(l => l.slice(0, 240));
}
writeFileSync(path.join(output, 'eas-ios-readback.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (receipt.error) process.exitCode = 1;
