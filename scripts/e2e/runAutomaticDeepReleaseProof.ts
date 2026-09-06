/**
 * Nearr-Dev integrated A/B proof for Automatic Deep Recognition.
 *
 * PRODUCTION_FREE runs the deployed normal worker with automatic deep disabled.
 * AUTO_DEEP_CANDIDATE runs the same sources with the conditional wrapper on.
 * Every observation is persisted before Regression V2 ground truth is loaded.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isCategoryOnlyPlaceName } from '../../services/media-worker/src/vayrin/placeIdentityGuard';
import { loadRegressionCorpus, loadRegressionGroundTruth } from '../../services/media-worker/src/recognitionRegression/fixtures';
import { calculateMetrics, scoreCase } from '../../services/media-worker/src/recognitionRegression/scoring';
import type { RankedCandidate, RegressionAttempt, RegressionCorpusCase } from '../../services/media-worker/src/recognitionRegression/types';
import { readRailwayDevelopmentVars } from './config';
import { correlationKeyFor, openSession, type E2ESession } from './session';
import { sleep } from './poll';

type SystemName = 'PRODUCTION_FREE' | 'AUTO_DEEP_CANDIDATE';
type SuiteName = 'REGRESSION_V2' | 'FOUNDER_12' | 'FOUNDER_4';
type ProofCase = {
  caseId: string;
  suite: SuiteName;
  category: RegressionCorpusCase['category'] | null;
  sourceUrl: string;
  expectedRoute?: 'AUTO_DEEP' | 'NORMAL_ONLY';
  recordedLead?: string | null;
};

const system = process.env.NEARR_AUTO_DEEP_PROOF_SYSTEM as SystemName | undefined;
if (system !== 'PRODUCTION_FREE' && system !== 'AUTO_DEEP_CANDIDATE') {
  throw new Error('NEARR_AUTO_DEEP_PROOF_SYSTEM must be PRODUCTION_FREE or AUTO_DEEP_CANDIDATE');
}
const expectedFlag = system === 'AUTO_DEEP_CANDIDATE' ? 'true' : 'false';
const deployedVariablesAtStart = readRailwayDevelopmentVars();
const automaticDeepFlagKey = ['AUTOMATIC', 'DEEP', 'RECOGNITION', 'ENABLED'].join('_');
const deployedAutomaticDeepFlag = (deployedVariablesAtStart[automaticDeepFlagKey] ?? '').toLowerCase();
if (deployedAutomaticDeepFlag !== expectedFlag) {
  throw new Error(`deployed AUTO_DEEP_RECOGNITION_ENABLED must be explicitly ${expectedFlag}; observed ${JSON.stringify(deployedAutomaticDeepFlag)}`);
}
if ((deployedVariablesAtStart.PREMIUM_REQUESTS_ENABLED ?? 'false').toLowerCase() === 'true') throw new Error('Premium is enabled');
if ((deployedVariablesAtStart.RECOGNITION_CACHE_READS_ENABLED ?? 'false').toLowerCase() === 'true') throw new Error('recognition cache reads are enabled');
const requestedSuites = new Set((process.env.NEARR_AUTO_DEEP_PROOF_SUITES ?? 'REGRESSION_V2')
  .split(',').map((value) => value.trim()).filter(Boolean) as SuiteName[]);
const runId = `automatic-deep-${system.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(process.env.NEARR_AUTO_DEEP_PROOF_OUTPUT ?? path.join('artifacts', 'automatic-deep-recognition', 'runs', runId));
const TERMINAL_JOB_STATUSES = new Set(['saved', 'needs_help', 'failed', 'unavailable']);

function instagramUrl(identity: string): string {
  const shortcode = identity.replace(/^instagram:/, '');
  return `https://www.instagram.com/${shortcode === '5oXehfQxb2' ? 'p' : 'reel'}/${shortcode}/`;
}

async function proofCases(repoRoot: string): Promise<ProofCase[]> {
  const cases: ProofCase[] = [];
  if (requestedSuites.has('REGRESSION_V2')) {
    const regression = (await loadRegressionCorpus(repoRoot))
      .filter((item) => !item.researchOnly && item.fixtureKind !== 'CONTRACT_CONTROL');
    cases.push(...regression.map((item) => ({
      caseId: item.caseId, suite: 'REGRESSION_V2' as const, category: item.category, sourceUrl: item.sourceUrl,
    })));
  }
  for (const [suite, file] of [
    ['FOUNDER_12', 'FOUNDER_12_VIDEO_BURST_AUTO_DEEP_REGRESSION_2026-09-05.json'],
    ['FOUNDER_4', 'RECENT_FOUNDER_4_VIDEO_REGRESSION_2026-09-05.json'],
  ] as const) {
    if (!requestedSuites.has(suite)) continue;
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'artifacts', 'recognition', file), 'utf8')) as {
      cases: Array<{ case_id: string; canonical_source_identity: string; expected_route: 'AUTO_DEEP' | 'NORMAL_ONLY'; recorded_sol_lead?: string; recorded_normal_lead?: string }>;
    };
    cases.push(...manifest.cases.map((item) => ({
      caseId: item.case_id,
      suite,
      category: null,
      sourceUrl: instagramUrl(item.canonical_source_identity),
      expectedRoute: item.expected_route,
      recordedLead: item.recorded_sol_lead ?? item.recorded_normal_lead ?? null,
    })));
  }
  return cases;
}

async function seed(session: E2ESession, spec: ProofCase): Promise<string> {
  if (!session.identity) throw new Error('ephemeral identity unavailable');
  const { data: job, error: jobError } = await session.admin.from('share_jobs').insert({
    user_id: session.identity.userId,
    source_url: spec.sourceUrl,
    canonical_url: spec.sourceUrl,
    source_platform: new URL(spec.sourceUrl).hostname.includes('tiktok') ? 'tiktok'
      : new URL(spec.sourceUrl).hostname.includes('youtube') ? 'youtube'
      : new URL(spec.sourceUrl).hostname.includes('facebook') ? 'facebook' : 'instagram',
    status: 'processing_metadata',
    progress_stage: 'checking_video',
    idempotency_key: correlationKeyFor(session.correlationId, `${spec.suite.toLowerCase()}-${spec.caseId.toLowerCase()}`),
    billing_mode: 'normal_free',
    billing_outcome: 'unmetered:normal_free',
    locked_until: null,
  }).select('id,user_id,source_platform').single();
  if (jobError || !job) throw new Error(`${spec.caseId}: job insert failed: ${jobError?.message ?? 'unknown'}`);
  session.trackedJobIds.push(job.id);
  const { error: taskError } = await session.admin.from('share_media_tasks').insert({
    share_job_id: job.id,
    user_id: job.user_id,
    source_url: spec.sourceUrl,
    canonical_url: spec.sourceUrl,
    platform: job.source_platform,
    status: 'queued',
    progress_stage: 'queued',
    max_attempts: 1,
  });
  if (taskError) throw new Error(`${spec.caseId}: task insert failed: ${taskError.message}`);
  return job.id;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type WalletSnapshot = {
  present: boolean;
  availableUses: number;
  reservedUses: number;
  version: number;
};

async function walletSnapshot(session: E2ESession): Promise<WalletSnapshot> {
  if (!session.identity) throw new Error('ephemeral identity unavailable');
  const { data, error } = await session.admin
    .from('place_find_wallets')
    .select('available_uses,reserved_uses,version')
    .eq('user_id', session.identity.userId)
    .limit(1);
  if (error) throw new Error(`wallet snapshot failed: ${error.message}`);
  const wallet = data?.[0];
  return {
    present: !!wallet,
    availableUses: Number(wallet?.available_uses ?? 0),
    reservedUses: Number(wallet?.reserved_uses ?? 0),
    version: Number(wallet?.version ?? 0),
  };
}

function candidateObjects(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const child of value) candidateObjects(child, out);
    return out;
  }
  const row = object(value);
  if (!row) return out;
  if (typeof row.name === 'string' && row.name.trim()) out.push(row);
  for (const child of Object.values(row)) candidateObjects(child, out);
  return out;
}

function uniqueCandidates(payload: unknown, saved: Record<string, unknown> | null): RankedCandidate[] {
  const rows = [...(saved ? [saved] : []), ...candidateObjects(payload)];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const name = typeof row.name === 'string' ? row.name.replace(/\s+/g, ' ').trim() : '';
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    const entityType = typeof row.entityType === 'string' ? row.entityType
      : typeof row.entity_type === 'string' ? row.entity_type : 'UNKNOWN';
    return [{
      rank: seen.size,
      name,
      identityType: entityType,
      locality: [row.city, row.region].filter((value): value is string => typeof value === 'string' && !!value).join(', ') || null,
      country: typeof row.country === 'string' ? row.country : null,
      latitude: typeof row.latitude === 'number' ? row.latitude : null,
      longitude: typeof row.longitude === 'number' ? row.longitude : null,
      evidenceType: typeof row.evidenceBasis === 'string' ? row.evidenceBasis : null,
      canonicalizationStatus: typeof row.canonicalStatus === 'string' ? row.canonicalStatus : null,
      specificity: isCategoryOnlyPlaceName(name) ? 'GENERIC_TYPE'
        : ['ADMIN_AREA', 'CITY', 'REGION', 'COUNTRY'].includes(entityType) ? 'ADMIN_AREA'
        : entityType === 'BROAD_AREA' ? 'BROAD_AREA'
        : 'SPECIFIC_PHYSICAL_PLACE',
    } satisfies RankedCandidate];
  }).slice(0, 3).map((item, index) => ({ ...item, rank: index + 1 }));
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const cases = await proofCases(repoRoot);
  if (cases.length === 0) throw new Error('no proof cases selected');
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  try {
    await mkdir(outputDir, { recursive: true });
    const startedAt = new Date().toISOString();
    if (!session.identity) throw new Error('ephemeral identity unavailable');
    const walletBefore = await walletSnapshot(session);
    const ids = new Map<string, string>();
    for (const spec of cases) ids.set(`${spec.suite}:${spec.caseId}`, await seed(session, spec));
    let jobs: any[] = [];
    const deadline = Date.now() + 45 * 60_000;
    let previous = '';
    while (Date.now() < deadline) {
      const { data, error } = await session.admin.from('share_jobs').select('*').in('id', [...ids.values()]);
      if (error) throw new Error(`job poll failed: ${error.message}`);
      jobs = data ?? [];
      const counts = jobs.reduce<Record<string, number>>((out, job) => { out[job.status] = (out[job.status] ?? 0) + 1; return out; }, {});
      const summary = Object.entries(counts).sort().map(([key, count]) => `${key}=${count}`).join(' ');
      if (summary !== previous) { console.log(`${system}: ${summary}`); previous = summary; }
      if (jobs.length === cases.length && jobs.every((job) => TERMINAL_JOB_STATUSES.has(job.status))) break;
      await sleep(5_000);
    }
    if (jobs.length !== cases.length || !jobs.every((job) => TERMINAL_JOB_STATUSES.has(job.status))) {
      throw new Error(`proof timed out: ${previous}`);
    }
    const jobIds = [...ids.values()];
    const [{ data: tasks, error: taskError }, { data: runs, error: runError }, { data: reservations, error: reservationError }] = await Promise.all([
      session.admin.from('share_media_tasks').select('*').in('share_job_id', jobIds),
      session.admin.from('share_media_runs').select('*').in('share_job_id', jobIds),
      session.admin.from('place_find_reservations').select('id,share_job_id,status').in('share_job_id', jobIds),
    ]);
    if (taskError || runError || reservationError) throw new Error(taskError?.message ?? runError?.message ?? reservationError?.message);
    const walletAfter = await walletSnapshot(session);
    const walletDelta = {
      availableUses: walletAfter.availableUses - walletBefore.availableUses,
      reservedUses: walletAfter.reservedUses - walletBefore.reservedUses,
      version: walletAfter.version - walletBefore.version,
    };
    const savedIds = jobs.flatMap((job) => typeof job.saved_place_id === 'string' ? [job.saved_place_id] : []);
    const { data: savedPlaces, error: savedError } = savedIds.length
      ? await session.admin.from('saved_places').select('id,name,latitude,longitude').in('id', savedIds)
      : { data: [], error: null };
    if (savedError) throw new Error(`saved place read failed: ${savedError.message}`);
    const taskRows = (tasks ?? []) as Array<Record<string, any>>;
    const savedRows = (savedPlaces ?? []) as Array<Record<string, any>>;
    const byJob = new Map<string, Record<string, any>>(jobs.map((job) => [job.id, job]));
    const byTask = new Map<string, Record<string, any>>(taskRows.map((task) => [task.share_job_id, task]));
    const byRun = new Map<string, Record<string, any>>((runs ?? []).map((run: Record<string, any>) => [run.share_job_id, run]));
    const bySaved = new Map<string, Record<string, unknown>>(savedRows.map((place) => [place.id, place]));
    const observations = cases.map((spec) => {
      const jobId = ids.get(`${spec.suite}:${spec.caseId}`)!;
      const job = byJob.get(jobId)!;
      const task = byTask.get(jobId);
      const run = byRun.get(jobId);
      const diagnostics = object(run?.evidence);
      const automaticDeep = object(diagnostics?.automaticDeep);
      const automaticDeepRecognition = object(diagnostics?.automaticDeepRecognition);
      const normalCandidates = Array.isArray(automaticDeep?.normalCandidates) ? automaticDeep!.normalCandidates : [];
      const candidates = uniqueCandidates(job.candidate_payload, bySaved.get(job.saved_place_id) ?? null);
      return {
        caseId: spec.caseId,
        suite: spec.suite,
        category: spec.category,
        sourceUrl: spec.sourceUrl,
        expectedRoute: spec.expectedRoute ?? null,
        recordedLead: spec.recordedLead ?? null,
        jobId,
        status: job.status,
        decision: job.decision,
        savedPlaceId: job.saved_place_id,
        failureCategory: job.failure_category,
        failureCode: job.failure_code,
        candidates,
        normalCandidates,
        automaticDeep,
        automaticDeepRecognition,
        modelProvider: run?.model_provider ?? null,
        durationMs: run?.duration_ms ?? null,
        taskStatus: task?.status ?? null,
        taskFailureCode: task?.failure_code ?? null,
        diagnostics,
      };
    });
    const observationArtifact = {
      schemaVersion: 1, runId, system, startedAt, completedAt: new Date().toISOString(),
      target: { supabaseRef: session.config.supabaseRef, railwayEnvironment: session.config.railway.environment, railwayService: session.config.railway.service },
      deployedFlags: { automaticDeepRecognitionEnabled: expectedFlag, premiumRequestsEnabled: false, recognitionCacheReadsEnabled: false },
      correlationId: session.correlationId,
      productionRowsMutated: false,
      observations,
      infrastructure: { taskCount: tasks?.length ?? 0, runCount: runs?.length ?? 0, premiumReservations: reservations?.length ?? 0 },
      tokenIsolation: { walletBefore, walletAfter, walletDelta },
    };
    await writeFile(path.join(outputDir, 'observations-before-ground-truth.json'), `${JSON.stringify(observationArtifact, null, 2)}\n`, 'utf8');

    const regressionCases = cases.filter((item): item is ProofCase & { category: RegressionCorpusCase['category'] } => item.suite === 'REGRESSION_V2' && item.category !== null);
    const attempts: RegressionAttempt[] = regressionCases.map((spec) => {
      const observation = observations.find((item) => item.suite === spec.suite && item.caseId === spec.caseId)!;
      const technical = observation.taskStatus === 'failed' || observation.status === 'failed';
      return {
        schemaVersion: 2, runId, caseId: spec.caseId, category: spec.category, sourceUrl: spec.sourceUrl,
        recognitionVersion: system === 'PRODUCTION_FREE' ? 'production-free-normal' : 'automatic-deep-recognition.v2',
        evidenceVersion: 'deployed-integrated-source-evidence', modelPath: observation.modelProvider ?? 'unknown',
        acquisitionStatus: technical ? 'ACQUISITION_BLOCKED' : 'ACQUIRED', status: technical ? 'TECHNICAL_FAILURE' : 'COMPLETED',
        candidates: observation.candidates, safetyDecision: observation.savedPlaceId ? 'AUTO_SAVE' : technical ? 'MANUAL_FALLBACK' : 'REVIEW',
        frameManifest: [], placesCallCount: Number(observation.automaticDeepRecognition?.placesRequests ?? 0),
        cacheReadUsed: false, modelRequests: Number(observation.automaticDeep?.attempts ?? 0) + 1, apiRequests: Number(observation.automaticDeep?.attempts ?? 0) + 1,
        costUsd: typeof observation.automaticDeepRecognition?.knownModelCostUsd === 'number' ? observation.automaticDeepRecognition.knownModelCostUsd as number : null,
        latencyMs: Number(observation.durationMs ?? 0), failureCode: observation.failureCode ?? observation.taskFailureCode ?? null,
        persistedAt: new Date().toISOString(),
      };
    });
    await writeFile(path.join(outputDir, 'attempts-before-ground-truth.json'), `${JSON.stringify(attempts, null, 2)}\n`, 'utf8');

    let regression: unknown = null;
    if (regressionCases.length > 0) {
      const truth = await loadRegressionGroundTruth(repoRoot);
      const truthById = new Map(truth.map((item) => [item.caseId, item]));
      const scores = attempts.map((attempt) => scoreCase(attempt, truthById.get(attempt.caseId)!));
      const metricCorpus: RegressionCorpusCase[] = regressionCases.map((item) => ({
        caseId: item.caseId,
        category: item.category,
        sourceUrl: item.sourceUrl,
        sourceCorpus: 'automatic-deep-integrated-proof',
        sourceCaseId: item.caseId,
        evidenceFixture: null,
        researchOnly: false,
        fixtureKind: 'LIVE_SOURCE',
      }));
      regression = { scores, metrics: calculateMetrics(metricCorpus, attempts, scores) };
    }
    const founder = observations.filter((item) => item.suite !== 'REGRESSION_V2').map((item) => {
      const specific = item.candidates.filter((candidate) => candidate.specificity === 'SPECIFIC_PHYSICAL_PLACE');
      return { caseId: item.caseId, suite: item.suite, expectedRoute: item.expectedRoute, normalCandidates: item.normalCandidates,
        deepInvoked: item.automaticDeep?.invoked === true, attempts: item.automaticDeep?.attempts ?? 0,
        candidates: item.candidates, recovered: item.expectedRoute === 'AUTO_DEEP' ? specific.length > 0 : item.automaticDeep?.invoked !== true,
        wrongAutosave: !!item.savedPlaceId, manualFallback: item.decision === 'manual_fallback', technical: item.status === 'failed' };
    });
    const report = {
      ...observationArtifact,
      regression,
      founder: {
        cases: founder,
        expectedDeep: founder.filter((item) => item.expectedRoute === 'AUTO_DEEP').length,
        recovered: founder.filter((item) => item.expectedRoute === 'AUTO_DEEP' && item.recovered).length,
        manualFallbacks: founder.filter((item) => item.manualFallback).length,
        technicalFailures: founder.filter((item) => item.technical).length,
        wrongAutosaves: founder.filter((item) => item.wrongAutosave).length,
      },
      assertions: {
        allTerminal: true,
        zeroPremiumReservations: (reservations?.length ?? 0) === 0,
        zeroWalletDelta: walletDelta.availableUses === 0 && walletDelta.reservedUses === 0 && walletDelta.version === 0,
        zeroWrongAutosaves: observations.every((item) => !item.savedPlaceId),
        systemIsolation: system === 'PRODUCTION_FREE'
          ? observations.every((item) => item.automaticDeep?.invoked !== true)
          : observations.every((item) => {
              if (item.status === 'failed') return true;
              const providerShowsDeep = typeof item.modelProvider === 'string' && item.modelProvider.includes('simple-sol');
              return providerShowsDeep === (item.automaticDeep?.invoked === true);
            }),
      },
    };
    await writeFile(path.join(outputDir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputDir, system, caseCount: cases.length, regression: (regression as any)?.metrics ?? null, founder: report.founder, assertions: report.assertions }, null, 2));
    if (!report.assertions.zeroPremiumReservations || !report.assertions.zeroWalletDelta || !report.assertions.zeroWrongAutosaves || !report.assertions.systemIsolation) process.exitCode = 1;
  } finally {
    const cleanup = await session.cleanup();
    console.log(JSON.stringify({ cleanup }, null, 2));
    if (!cleanup.userDeleted || cleanup.errors.length > 0) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
