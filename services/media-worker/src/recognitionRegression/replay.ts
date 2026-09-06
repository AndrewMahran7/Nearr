import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RankedCandidate, RegressionAttempt, RegressionCorpusCase, SafetyDecision } from './types.js';
import type { PersistedModelAttempt, SolDestination } from '../solParity/types.js';

type RuntimeLine = {
  attempt_id: string;
  execution?: {
    destinations?: Array<{
      decision?: string;
      hypotheses?: Array<{
        name?: string; entityType?: string; city?: string | null; region?: string | null; country?: string | null;
        evidenceBasis?: string; canonicalStatus?: string; canonical?: { latitude?: number; longitude?: number } | null;
      }>;
    }>;
    telemetry?: { engineVersion?: string; evidenceVersion?: string; placesRequests?: number };
  };
};

async function jsonLines<T>(filePath: string): Promise<T[]> {
  try { return (await readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

function specificity(entityType: string): RankedCandidate['specificity'] {
  if (entityType === 'ADMIN_AREA') return 'ADMIN_AREA';
  if (entityType === 'BROAD_AREA') return 'BROAD_AREA';
  if (entityType === 'UNKNOWN') return 'UNKNOWN';
  return 'SPECIFIC_PHYSICAL_PLACE';
}

function alternateAsDestination(alternative: SolDestination['alternatives'][number], parent: SolDestination): SolDestination {
  return { ...alternative, confidence: parent.confidence, alternatives: [], supporting_clues: parent.supporting_clues, contradictions: parent.contradictions, web_research_used: parent.web_research_used };
}

function rankedCandidate(destination: SolDestination, rank: number, runtime?: RuntimeLine): RankedCandidate {
  const hypothesis = runtime?.execution?.destinations?.[0]?.hypotheses?.[rank - 1];
  const entityType = hypothesis?.entityType ?? destination.entity_type;
  return {
    rank,
    name: hypothesis?.name ?? destination.name,
    identityType: entityType,
    locality: [hypothesis?.city ?? destination.city, hypothesis?.region ?? destination.region].filter(Boolean).join(', ') || null,
    country: hypothesis?.country ?? destination.country,
    latitude: hypothesis?.canonical?.latitude ?? null,
    longitude: hypothesis?.canonical?.longitude ?? null,
    evidenceType: hypothesis?.evidenceBasis ?? 'MODEL_REPLAY',
    canonicalizationStatus: hypothesis?.canonicalStatus ?? null,
    specificity: specificity(entityType),
  };
}

function safety(value: string | undefined): SafetyDecision {
  if (value === 'AUTO_SAVE') return 'AUTO_SAVE';
  if (value === 'REVIEW' || value === 'NAMED_LEAD') return 'REVIEW';
  return 'MANUAL_FALLBACK';
}

export async function replayCurrentRuntime(repoRoot: string, corpus: RegressionCorpusCase[], runId: string): Promise<RegressionAttempt[]> {
  const runBase = path.join(repoRoot, 'artifacts', 'sol-parity', 'runs', 'premium-runtime-f1-m1-paid-20260904');
  const attempts = await jsonLines<PersistedModelAttempt>(path.join(runBase, 'model-attempts.jsonl'));
  const runtimes = await jsonLines<RuntimeLine>(path.join(runBase, 'local-runtime.jsonl'));
  const attemptById = new Map(attempts.map((item) => [item.case_id, item]));
  const runtimeByAttempt = new Map(runtimes.map((item) => [item.attempt_id, item]));
  const contractRaw = JSON.parse(await readFile(path.join(repoRoot, 'artifacts', 'recognition-regression', 'contract-replay.json'), 'utf8')) as {
    results: Array<{ caseId: string; candidates: Array<Record<string, unknown>>; safetyDecision: SafetyDecision }>;
  };
  const contractById = new Map(contractRaw.results.map((item) => [item.caseId, item]));
  return corpus.map((item) => {
    const contract = contractById.get(item.caseId);
    if (contract) return {
      schemaVersion: 2, runId, caseId: item.caseId, category: item.category, sourceUrl: item.sourceUrl,
      recognitionVersion: 'deterministic-contract.v1', evidenceVersion: 'contract-evidence.v1', modelPath: 'deterministic-contract-control',
      acquisitionStatus: 'EVIDENCE_REPLAY', status: 'COMPLETED',
      candidates: contract.candidates.map((value): RankedCandidate => ({
        rank: Number(value.rank), name: String(value.name), identityType: String(value.identityType ?? 'UNKNOWN'),
        locality: [value.locality, value.region].filter(Boolean).join(', ') || null, country: typeof value.country === 'string' ? value.country : null,
        latitude: typeof value.latitude === 'number' ? value.latitude : null, longitude: typeof value.longitude === 'number' ? value.longitude : null,
        evidenceType: typeof value.evidenceType === 'string' ? value.evidenceType : 'CONTRACT_CONTROL',
        canonicalizationStatus: typeof value.canonicalizationStatus === 'string' ? value.canonicalizationStatus : null,
        specificity: value.identityType === 'ADMIN_AREA' ? 'ADMIN_AREA' : value.identityType === 'BROAD_AREA' ? 'BROAD_AREA' : value.identityType === 'GENERIC_TYPE' ? 'GENERIC_TYPE' : 'SPECIFIC_PHYSICAL_PLACE',
      })),
      safetyDecision: contract.safetyDecision, frameManifest: [], placesCallCount: 0, cacheReadUsed: false,
      modelRequests: 0, apiRequests: 0, costUsd: 0, latencyMs: 0, failureCode: null, persistedAt: new Date().toISOString(),
    };
    const attempt = item.sourceCaseId ? attemptById.get(item.sourceCaseId) : undefined;
    if (!attempt) return {
      schemaVersion: 2, runId, caseId: item.caseId, category: item.category, sourceUrl: item.sourceUrl,
      recognitionVersion: 'simple-sol-premium.v2', evidenceVersion: item.evidenceFixture ? 'premium-evidence-2026-09-05.v1' : 'unacquired.v1', modelPath: 'frozen-current-runtime-replay',
      acquisitionStatus: 'ACQUISITION_BLOCKED', status: item.researchOnly ? 'COMPLETED' : 'TECHNICAL_FAILURE',
      candidates: [], safetyDecision: 'MANUAL_FALLBACK', frameManifest: [], placesCallCount: 0, cacheReadUsed: false,
      modelRequests: 0, apiRequests: 0, costUsd: null, latencyMs: 0,
      failureCode: item.researchOnly ? null : 'RECORDED_LIVE_ATTEMPT_MISSING', persistedAt: new Date().toISOString(),
    };
    const runtime = runtimeByAttempt.get(attempt.attempt_id);
    const primary = attempt.payload?.results[0];
    const hypotheses = primary ? [primary, ...primary.alternatives.slice(0, 2).map((value) => alternateAsDestination(value, primary))] : [];
    return {
      schemaVersion: 2, runId, caseId: item.caseId, category: item.category, sourceUrl: item.sourceUrl,
      recognitionVersion: runtime?.execution?.telemetry?.engineVersion ?? 'simple-sol-premium.v2',
      evidenceVersion: runtime?.execution?.telemetry?.evidenceVersion ?? 'premium-evidence-2026-09-05.v1',
      modelPath: `${attempt.model}/${attempt.frame_arm}:${attempt.model_arm}/frozen-current-runtime-replay`,
      acquisitionStatus: 'EVIDENCE_REPLAY', status: attempt.failure ? 'TECHNICAL_FAILURE' : 'COMPLETED',
      candidates: hypotheses.slice(0, 3).map((value, index) => rankedCandidate(value, index + 1, runtime)),
      safetyDecision: safety(runtime?.execution?.destinations?.[0]?.decision),
      frameManifest: attempt.input_manifest.frames.map((frame) => ({ timestampSeconds: frame.timestamp_seconds, sha256: frame.sha256 })),
      placesCallCount: runtime?.execution?.telemetry?.placesRequests ?? 0, cacheReadUsed: false,
      modelRequests: 1, apiRequests: 1 + (runtime?.execution?.telemetry?.placesRequests ?? 0), costUsd: attempt.estimated_model_cost_usd,
      latencyMs: attempt.timings_ms.total, failureCode: attempt.failure?.code ?? null, persistedAt: new Date().toISOString(),
    };
  });
}
