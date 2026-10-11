/** Immutable source-only snapshot for inference while the research branch changes. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyRuntimeSnapshot } from './paidBatch.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), opts = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--dependencies'].includes(args[i]) || !args[i + 1] || opts[args[i]]) throw new Error('invalid_snapshot_arguments');
  opts[args[i]] = args[i + 1];
}
if (!opts['--out'] || !opts['--dependencies']) throw new Error('snapshot_out_and_dependencies_required');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(opts['--out']), dependencies = fs.realpathSync(opts['--dependencies']);
const files = [];
function walk(relative) {
  for (const entry of fs.readdirSync(path.join(repo, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)) files.push(file);
  }
}
for (const dir of ['services/media-worker/src', 'lib', 'supabase/functions/process-share-jobs', 'supabase/functions/process-share-link']) walk(dir);
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'services/media-worker/package.json', 'services/media-worker/package-lock.json', 'services/media-worker/tsconfig.json']) if (fs.existsSync(path.join(repo, file))) files.push(file);
for (const dir of ['node_modules', 'services/media-worker/node_modules']) if (!fs.statSync(path.join(dependencies, dir)).isDirectory()) throw new Error('existing_dependency_tree_required');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
const records = [];
for (const file of files.sort()) {
  const bytes = fs.readFileSync(path.join(repo, file)), target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
  records.push({ path: file, sha256: sha(bytes) });
}
for (const file of records) if (sha(fs.readFileSync(path.join(repo, file.path))) !== file.sha256) throw new Error('source_changed_during_snapshot');
for (const dir of ['node_modules', 'services/media-worker/node_modules']) fs.symlinkSync(path.join(dependencies, dir), path.join(out, dir), 'junction');
const receipt = { version: 1, purpose: 'immutable code-only inference runtime snapshot', created_at: new Date().toISOString(), files: records,
  dependency_installation: 'Existing local node_modules junctions; copied lockfiles are hash-bound. Installed dependency bytes are not copied or claimed immutable.',
  source_git_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim() };
fs.writeFileSync(path.join(out, 'runtime-snapshot.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ out, files: records.length, receipt_sha256: verifyRuntimeSnapshot(out) }));
