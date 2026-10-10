import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildShareJobCandidatePayload } from '../lib/shareJobResult';

const beforeRoot = 'C:/Users/andre/Desktop/Nearr-main-dev-build';
const afterRoot = path.resolve(__dirname, '..');
const functionNames = ['safeCandidate', 'premiumRuntimeCandidate', 'premiumRuntimePlan'];

function file(root: string, name: string): string { return path.join(root, name); }
function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function readJson(name: string): any { return JSON.parse(readFileSync(file(afterRoot, name), 'utf8')); }
function jsonLines(name: string): any[] {
  return readFileSync(file(afterRoot, name), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function loadProjection(root: string): { source: string; run: (value: unknown) => unknown } {
  const source = readFileSync(file(root, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const declarations = tree.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && functionNames.includes(statement.name?.text ?? ''));
  assert.equal(declarations.length, functionNames.length, `missing recognition projection in ${root}`);
  const extracted = declarations.map((declaration) => declaration.getText(tree)).join('\n\n');
  const js = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(`${js}\npremiumRuntimePlan`, { buildShareJobCandidatePayload }) as (value: unknown) => unknown;
  return { source: extracted, run };
}

const before = loadProjection(beforeRoot);
const after = loadProjection(afterRoot);
assert.equal(before.source, after.source, 'recognition result-projection functions changed');
const candidateSource = readFileSync(file(afterRoot, 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
const candidateTree = ts.createSourceFile('index.ts', candidateSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
let notificationFinalizeCalls = 0;
function auditFinalizeCalls(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(candidateTree) === 'finalize' && node.arguments.length >= 4
      && node.arguments[3].kind !== ts.SyntaxKind.NullKeyword) {
    notificationFinalizeCalls += 1;
    const patch = node.arguments[2];
    assert.ok(ts.isObjectLiteralExpression(patch), 'notification finalizer patch is not statically inspectable');
    assert.ok(patch.properties.some((property) => ts.isPropertyAssignment(property)
      && property.name.getText(candidateTree) === 'status'), 'notification finalizer lacks terminal status');
  }
  ts.forEachChild(node, auditFinalizeCalls);
}
auditFinalizeCalls(candidateTree);
assert.ok(notificationFinalizeCalls > 0);
for (const dependency of ['lib/shareJobResult.ts', 'lib/placeSelection.ts']) {
  const left = readFileSync(file(beforeRoot, dependency));
  const right = readFileSync(file(afterRoot, dependency));
  assert.equal(sha(left.toString('utf8')), sha(right.toString('utf8')), `${dependency} changed`);
}

const corpus = readJson('artifacts/recognition-regression/corpus.json').cases as any[];
const cliffs = readJson('artifacts/recognition-regression/cliff-corpus.json').cases as any[];
const caseIds = [...corpus.map((item) => item.caseId),
  ...cliffs.filter((item) => !item.existingCaseId).map((item) => item.caseId)];
assert.equal(caseIds.length, 91);
assert.equal(new Set(caseIds).size, 91);
const runtimeLines = jsonLines('artifacts/recognition-regression/runs/current-live-baseline/backend/local-runtime.jsonl');
const runtimeByCase = new Map(runtimeLines.map((line) => [line.case_id, line.execution]));
for (const variant of ['phase1-r01-local', 'failed-set-r02-r06-local']) {
  for (const line of jsonLines(`artifacts/premium-live-parity/runs/${variant}/local-runtime.jsonl`)) {
    if (!runtimeByCase.has(line.case_id)) runtimeByCase.set(line.case_id, line.execution);
  }
}
const cliffRuntimeByAttempt = new Map(['simple-sol', 'simple-sol-b'].flatMap((variant) =>
  jsonLines(`artifacts/cliff-jumping/raw/${variant}/local-runtime.jsonl`)
    .map((line) => [line.attempt_id, line.execution] as const)));
const cliffExecutionByUrl = new Map(['simple-sol', 'simple-sol-b'].flatMap((variant) =>
  jsonLines(`artifacts/cliff-jumping/raw/${variant}/model-attempts.jsonl`)
    .map((line) => [line.source_url, cliffRuntimeByAttempt.get(line.attempt_id)] as const)));
for (const item of cliffs) {
  if (!item.existingCaseId && cliffExecutionByUrl.has(item.sourceUrl)) {
    runtimeByCase.set(item.caseId, cliffExecutionByUrl.get(item.sourceUrl));
  }
}

const recordedRuntimeCases = runtimeByCase.size;
const recoveredProjectionCases: string[] = [];
const paidEvaluation = readJson(
  'artifacts/sol-parity/runs/premium-runtime-f1-m1-paid-20260904/premium-runtime-evaluation.json',
);
for (const execution of paidEvaluation.executions ?? []) {
  if (!caseIds.includes(execution.case_id) || runtimeByCase.has(execution.case_id)) continue;
  // This frozen artifact was written from the exact Premium runtime result. It
  // intentionally omits unrelated telemetry, but preserves every field read by
  // process-share-jobs' result projection. Do not synthesize cases which have
  // only acquisition errors or deterministic contract fixtures.
  runtimeByCase.set(execution.case_id, {
    schemaVersion: 1,
    outcome: execution.outcome,
    chargeability: execution.chargeability,
    destinations: execution.destinations,
    telemetry: {
      placesRequests: execution.places_requests,
      knownModelCostUsd: execution.model_cost_usd,
      timingsMs: {
        sol: execution.sol_latency_ms,
        totalAfterEvidenceReady: execution.total_latency_ms,
      },
    },
  });
  recoveredProjectionCases.push(execution.case_id);
}
assert.deepEqual(
  recoveredProjectionCases.sort(),
  ['C01', 'C04', 'H07', 'R07', 'S02', 'S03', 'S04', 'S05', 'S07'],
  'unexpected frozen Premium projection recovery set',
);

let actualRuntimeCases = 0;
let nonNullProjectedCases = 0;
const differences: string[] = [];
const normalized: Array<{ caseId: string; result: unknown }> = [];
for (const caseId of caseIds) {
  const input = runtimeByCase.get(caseId) ?? null;
  if (input) actualRuntimeCases += 1;
  const left = before.run(input);
  const right = after.run(input);
  if (right !== null) nonNullProjectedCases += 1;
  if (JSON.stringify(left) !== JSON.stringify(right)) differences.push(caseId);
  normalized.push({ caseId, result: right });
}
assert.deepEqual(differences, []);
console.log(JSON.stringify({
  cases: caseIds.length,
  recordedRuntimeInputs: recordedRuntimeCases,
  recoveredFrozenProjectionInputs: recoveredProjectionCases.length,
  recoveredFrozenProjectionCaseIds: recoveredProjectionCases,
  actualRuntimeInputs: actualRuntimeCases,
  nonNullProjectedCases,
  noRuntimeInput: caseIds.length - actualRuntimeCases,
  noRuntimeCaseIds: caseIds.filter((caseId) => !runtimeByCase.get(caseId)),
  recognitionProjectionSourceSha256: sha(before.source),
  notificationFinalizeCallsAudited: notificationFinalizeCalls,
  resultSha256: sha(JSON.stringify(normalized)),
  differences: differences.length,
}));
