import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Args = { parity: string; live: string; out: string };
function args(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--parity') out.parity = argv[++index];
    else if (key === '--live') out.live = argv[++index];
    else if (key === '--out') out.out = argv[++index];
    else throw new Error('unknown_argument:' + key);
  }
  if (!out.parity || !out.live || !out.out) throw new Error('required: --parity DIR --live FILE --out FILE');
  return out as Args;
}

function jsonLines(file: string): any[] {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function at(value: any, dotted: string): unknown {
  return dotted.split('.').reduce((current, key) => current?.[key], value);
}

const INPUT_PATHS = [
  'sourceIdentity.platform',
  'sourceIdentity.canonicalContentIdHash',
  'sourceIdentity.canonicalUrlHash',
  'prompt.promptVersion',
  'prompt.promptHash',
  'prompt.schemaVersion',
  'prompt.schemaHash',
  'prompt.model',
  'prompt.reasoningConfig',
  'frames',
  'sourceContext.captionHash',
  'sourceContext.captionLength',
  'sourceContext.transcriptHash',
  'sourceContext.transcriptLength',
  'sourceContext.ocrHash',
  'sourceContext.ocrLength',
  'sourceContext.sourceLocationHash',
  'sourceContext.sourceLocationLength',
  'sourceContext.sourceLocationPresent',
  'sourceContext.creatorHash',
  'sourceContext.creatorLength',
  'request.imageCount',
  'request.inputTextHash',
  'request.requestPayloadHash',
];

function firstDifference(left: any, right: any): { field: string; left: unknown; right: unknown } | null {
  if (!left || !right) return { field: 'fingerprint_presence', left: !!left, right: !!right };
  for (const field of INPUT_PATHS) {
    const a = at(left, field);
    const b = at(right, field);
    if (JSON.stringify(a) !== JSON.stringify(b)) return { field, left: a, right: b };
  }
  return null;
}

function boundary(diag: any) {
  return {
    fingerprint: diag?.inferenceFingerprint ?? null,
    sol: diag?.solBoundary ?? null,
    canonical: diag?.canonicalizationFingerprint ?? null,
    final: diag?.finalFingerprint ?? null,
  };
}

function compare(left: ReturnType<typeof boundary>, right: ReturnType<typeof boundary>) {
  const request = firstDifference(left.fingerprint, right.fingerprint);
  if (request) return { boundary: 'request', ...request };
  if (left.sol?.structuredResultHash !== right.sol?.structuredResultHash) {
    return {
      boundary: 'sol_response',
      field: 'structuredResultHash',
      left: left.sol?.structuredResultHash ?? null,
      right: right.sol?.structuredResultHash ?? null,
    };
  }
  if (left.canonical?.hash !== right.canonical?.hash) {
    return {
      boundary: 'canonicalization',
      field: 'canonicalizationFingerprint.hash',
      left: left.canonical?.hash ?? null,
      right: right.canonical?.hash ?? null,
    };
  }
  if (left.final?.hash !== right.final?.hash) {
    return {
      boundary: 'finalization',
      field: 'finalFingerprint.hash',
      left: left.final?.hash ?? null,
      right: right.final?.hash ?? null,
    };
  }
  return null;
}

const parsed = args(process.argv.slice(2));
const attempts = jsonLines(path.join(parsed.parity, 'model-attempts.jsonl'));
const local = jsonLines(path.join(parsed.parity, 'local-runtime.jsonl'));
const liveArtifact = JSON.parse(readFileSync(parsed.live, 'utf8'));
const liveCases = Array.isArray(liveArtifact.cases) ? liveArtifact.cases : [];
const caseIds = [...new Set(attempts.map((attempt) => attempt.case_id))];
const comparisons = caseIds.map((caseId) => {
  const parityAttempt = attempts.find((attempt) => attempt.case_id === caseId);
  const localAttempt = local.find((attempt) => attempt.case_id === caseId);
  const live = liveCases.find((candidate: any) => candidate.caseId === caseId);
  const parityBoundary = {
    fingerprint: parityAttempt?.inference_fingerprint ?? null,
    sol: localAttempt?.execution?.telemetry?.solBoundary ?? null,
    canonical: localAttempt?.execution?.telemetry?.canonicalizationFingerprint ?? null,
    final: localAttempt?.execution?.telemetry?.finalFingerprint ?? null,
  };
  const localBoundary = boundary(localAttempt?.execution?.telemetry);
  const liveBoundary = boundary(
    live?.costs?.parityDiagnostics ?? live?.mediaRun?.evidence?.premiumDiagnostics,
  );
  return {
    caseId,
    parity: parityBoundary,
    local: localBoundary,
    live: liveBoundary,
    parityToLocalFirstDivergence: compare(parityBoundary, localBoundary),
    localToLiveFirstDivergence: compare(localBoundary, liveBoundary),
    effectiveRequestIdentical: !firstDifference(localBoundary.fingerprint, liveBoundary.fingerprint),
  };
});
const artifact = {
  schemaVersion: 1,
  comparedAt: new Date().toISOString(),
  parityDirectory: parsed.parity,
  liveArtifact: parsed.live,
  comparisons,
};
mkdirSync(path.dirname(parsed.out), { recursive: true });
writeFileSync(parsed.out, JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify(comparisons.map((item) => ({
  caseId: item.caseId,
  requestIdentical: item.effectiveRequestIdentical,
  firstDivergence: item.localToLiveFirstDivergence,
})), null, 2));
