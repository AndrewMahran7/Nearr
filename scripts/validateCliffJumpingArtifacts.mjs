import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'artifacts', 'cliff-jumping');
const required = [
  'ground-truth.json','production-free-results.json','simple-sol-results.json','auto-deep-results.json',
  'plausibility-review.json','case-failure-analysis.json','arm-comparison.json','accuracy-max-results.json','run-ledger.json',
];
const parsed = {};
for (const name of required) parsed[name] = JSON.parse(await readFile(path.join(base,name),'utf8'));

const expected = Array.from({length:42},(_,i)=>`CJ${String(i+1).padStart(3,'0')}`);
const ids = (items) => items.map((item)=>item.caseId);
const assert = (condition,message) => { if (!condition) throw new Error(message); };
assert(JSON.stringify(ids(parsed['ground-truth.json'].destinations))===JSON.stringify(expected),'ground_truth_case_order');
for (const name of ['production-free-results.json','simple-sol-results.json','auto-deep-results.json','case-failure-analysis.json','arm-comparison.json','accuracy-max-results.json']) {
  const rows = parsed[name].results ?? parsed[name].rows;
  assert(Array.isArray(rows)&&rows.length===42,`${name}_case_count`);
  assert(new Set(ids(rows)).size===42,`${name}_unique_cases`);
}
const statuses = new Set(['VERIFIED_EXACT','HIGH_CONFIDENCE_EXACT','PROVISIONAL_BEST_GUESS','UNRESOLVED']);
assert(parsed['ground-truth.json'].destinations.every((item)=>statuses.has(item.groundTruthStatus)),'ground_truth_status');
assert(parsed['production-free-results.json'].results.every((item)=>item.technicalFailure===false),'unexpected_production_technical_failure');
assert(parsed['simple-sol-results.json'].results.every((item)=>item.failure===null),'unexpected_sol_technical_failure');
assert(parsed['run-ledger.json'].productionMutations==='NONE'&&parsed['run-ledger.json'].deployments==='NONE','production_safety_ledger');

const inference = JSON.parse(await readFile(path.join(base,'inference-corpus.json'),'utf8'));
const forbidden = /ground.?truth|expected.?answer|accepted.?alias|latitude|longitude|prior.?hypoth/i;
function assertNoForbiddenKeys(value) {
  if (Array.isArray(value)) return value.forEach(assertNoForbiddenKeys);
  if (!value || typeof value !== 'object') return;
  for (const [key,child] of Object.entries(value)) {
    assert(!forbidden.test(key),`ground_truth_leak_key:${key}`);
    assertNoForbiddenKeys(child);
  }
}
assertNoForbiddenKeys(inference);
for (const dir of ['simple-sol','simple-sol-b','accuracy-max-a','accuracy-max-b']) {
  const manifest = JSON.parse(await readFile(path.join(base,'raw',dir,'run-manifest.json'),'utf8'));
  assert(manifest.ground_truth_loaded_during_inference===false,`${dir}_ground_truth_loaded`);
  assert(manifest.cache_used===false,`${dir}_cache_used`);
  assert(manifest.production_target===false,`${dir}_production_target`);
}

const files = [];
async function walk(dir) { for (const entry of await readdir(dir,{withFileTypes:true})) { const full=path.join(dir,entry.name); if(entry.isDirectory()) await walk(full); else files.push(full); } }
await walk(base);
const secrets = [/sk-[A-Za-z0-9_-]{20,}/,/Bearer\s+[A-Za-z0-9._-]{20,}/i,/(?:service_role|api[_-]?key|secret)\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/i];
for (const file of files) {
  const text = await readFile(file,'utf8');
  assert(!secrets.some((pattern)=>pattern.test(text)),`secret_detected:${path.relative(root,file)}`);
}
console.log(JSON.stringify({validJsonFiles:required.length,cases:42,blindRunManifests:4,secretScanFiles:files.length,status:'PASS'},null,2));
