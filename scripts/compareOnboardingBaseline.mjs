import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const output = path.join(root, 'artifacts/global-release/onboarding-integration/tests');
const initial = readFileSync(path.join(output, 'results.json'), 'utf8');
writeFileSync(path.join(output, 'initial-results.json'), initial);
mkdirSync(path.join(output, 'baseline'), { recursive: true });
const results = [];
for (const test of JSON.parse(initial).results.filter(t => t.exit !== 0)) {
  const result = spawnSync(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', test.name], { cwd: 'C:/Users/andre/Desktop/Nearr/.tmp/nearr-global-integration-recovered', encoding: 'utf8', windowsHide: true, maxBuffer: 30 * 1024 * 1024 });
  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  writeFileSync(path.join(output, 'baseline', test.name.replaceAll(':', '-') + '.log'), log);
  results.push({ name: test.name, baselineExit: result.status, integrationExit: test.exit, firstError: log.match(/(?:AssertionError[^\n]*|Error: [^\n]*)/)?.[0] });
  console.log(test.name, result.status);
}
writeFileSync(path.join(output, 'baseline-comparison.json'), JSON.stringify({ baselineSha: '6e4096a34bb4a09b66227474659d753670d3764f', results }, null, 2) + '\n');
