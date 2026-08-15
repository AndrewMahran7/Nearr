/**
 * Isolated hosted Phase 2 serial-vs-burst replay.
 *
 * Safety:
 * - requires --execute;
 * - creates a fresh confirmed test user per condition;
 * - uses only public URLs already committed in phase2-gold-set.json;
 * - captures results before deleting the test user (FK cascades remove its
 *   share jobs, media tasks/runs, and saved rows);
 * - never touches an existing user's rows.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createShareJob } from '../lib/shareJobClient';

type Condition = 'serial' | 'burst';
type GoldCase = {
  id: string;
  kind: string;
  url: string;
  expectedGooglePlaceId: string;
  expectedName: string;
};

type TimedSubmission = {
  caseId: string;
  jobId: string;
  attemptedAt: string;
  acknowledgedAt: string;
  acknowledgementMs: number;
  duplicate: boolean;
};

const TERMINAL_JOBS = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const TERMINAL_TASKS = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const POLL_MS = 2_000;
const TIMEOUT_MS = 20 * 60_000;
const BURST_INTERVAL_MS = 1_400;

function loadDotEnv(): void {
  for (const filename of ['.env', '.env.local']) {
    const file = path.resolve(filename);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment value (${names.join(' or ')})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoMs(later: string | null | undefined, earlier: string | null | undefined): number | null {
  if (!later || !earlier) return null;
  const value = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(value) ? value : null;
}

function deepHas(value: unknown, predicate: (key: string, value: unknown) => boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => deepHas(entry, predicate));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => predicate(key, entry) || deepHas(entry, predicate),
  );
}

function candidateIds(job: any): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'googlePlaceId' || key === 'google_place_id') && typeof entry === 'string') ids.add(entry);
      visit(entry);
    }
  };
  visit(job.candidate_payload);
  visit(job.extraction_payload);
  return [...ids];
}

async function createIsolatedUser(admin: SupabaseClient, anonKey: string, supabaseUrl: string): Promise<{
  userId: string;
  accessToken: string;
}> {
  const password = `N!${randomUUID()}a8`;
  const email = `phase2-load-${randomUUID()}@nearr.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: 'phase2_serial_burst_replay' },
  });
  if (createError || !created.user) throw new Error(`Could not create isolated user: ${createError?.message}`);
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw new Error(`Could not sign in isolated user: ${signInError?.message}`);
  }
  return { userId: created.user.id, accessToken: signedIn.session.access_token };
}

async function submitOne(
  endpoint: string,
  accessToken: string,
  condition: Condition,
  item: GoldCase,
): Promise<TimedSubmission> {
  const started = Date.now();
  const attemptedAt = new Date(started).toISOString();
  const result = await createShareJob({
    endpoint,
    url: item.url,
    accessToken,
    clientRequestId: `phase2-${condition}-${item.id}-${randomUUID()}`,
    timeoutMs: 15_000,
  });
  if (!result.ok) throw new Error(`${condition}/${item.id} ingress failed: ${result.reason} ${result.httpStatus ?? ''}`);
  return {
    caseId: item.id,
    jobId: result.jobId,
    attemptedAt,
    acknowledgedAt: new Date().toISOString(),
    acknowledgementMs: Date.now() - started,
    duplicate: result.duplicate,
  };
}

async function fetchLifecycle(admin: SupabaseClient, jobIds: string[]): Promise<{ jobs: any[]; tasks: any[] }> {
  const [jobsResult, tasksResult] = await Promise.all([
    admin.from('share_jobs').select('*').in('id', jobIds),
    admin.from('share_media_tasks').select('*').in('share_job_id', jobIds),
  ]);
  if (jobsResult.error) throw new Error(`Job poll failed: ${jobsResult.error.message}`);
  if (tasksResult.error) throw new Error(`Task poll failed: ${tasksResult.error.message}`);
  return { jobs: jobsResult.data ?? [], tasks: tasksResult.data ?? [] };
}

async function waitForFullPipeline(admin: SupabaseClient, jobIds: string[]): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let firstAllJobsTerminalAt: number | null = null;
  while (Date.now() < deadline) {
    const { jobs, tasks } = await fetchLifecycle(admin, jobIds);
    const allJobsTerminal = jobs.length === jobIds.length && jobs.every((job) => TERMINAL_JOBS.has(job.status));
    if (allJobsTerminal && firstAllJobsTerminalAt === null) firstAllJobsTerminalAt = Date.now();
    const tasksTerminal = tasks.every((task) => TERMINAL_TASKS.has(task.status));
    // Five seconds lets post-save enrichment appear after the parent commits.
    if (allJobsTerminal && tasksTerminal && firstAllJobsTerminalAt && Date.now() - firstAllJobsTerminalAt >= 5_000) return;
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${jobIds.length} jobs to finish`);
}

async function materializeResults(
  admin: SupabaseClient,
  gold: GoldCase[],
  submissions: TimedSubmission[],
): Promise<any[]> {
  const jobIds = submissions.map((submission) => submission.jobId);
  const { jobs, tasks } = await fetchLifecycle(admin, jobIds);
  const taskIds = tasks.map((task) => task.id);
  const [runsResult, resultsResult] = await Promise.all([
    taskIds.length
      ? admin.from('share_media_runs').select('*').in('share_media_task_id', taskIds)
      : Promise.resolve({ data: [], error: null } as any),
    admin.from('share_job_place_results').select('*').in('share_job_id', jobIds).is('undone_at', null),
  ]);
  if (runsResult.error) throw new Error(`Run collection failed: ${runsResult.error.message}`);
  if (resultsResult.error) throw new Error(`Result collection failed: ${resultsResult.error.message}`);

  const actualSavedProvider = new Map<string, string>();
  for (const job of jobs) {
    if (!job.saved_place_id) continue;
    const { data: saved } = await admin.from('saved_places').select('place_id').eq('id', job.saved_place_id).maybeSingle();
    if (!saved?.place_id) continue;
    const { data: place } = await admin.from('places').select('google_place_id').eq('id', saved.place_id).maybeSingle();
    if (place?.google_place_id) actualSavedProvider.set(job.id, place.google_place_id);
  }

  return gold.map((item) => {
    const submission = submissions.find((entry) => entry.caseId === item.id)!;
    const job = jobs.find((entry) => entry.id === submission.jobId);
    assert.ok(job, `Missing persisted job ${submission.jobId}`);
    const task = tasks.find((entry) => entry.share_job_id === job.id) ?? null;
    const runs = (runsResult.data ?? []).filter((entry: any) => entry.share_job_id === job.id);
    const placeResults = (resultsResult.data ?? []).filter((entry: any) => entry.share_job_id === job.id);
    const candidates = candidateIds(job);
    for (const result of placeResults) if (result.google_place_id) candidates.push(result.google_place_id);
    const distinctCandidates = [...new Set(candidates)];
    const actualFinalGooglePlaceId = actualSavedProvider.get(job.id) ?? null;
    const latestRun = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
    const queueWaitMs = task ? isoMs(task.locked_at, task.created_at) : null;
    const mediaExecutionMs = task ? isoMs(task.completed_at ?? task.updated_at, task.locked_at) : null;
    const totalCompletionMs = isoMs(job.completed_at ?? job.updated_at, job.created_at);
    const expectedInCandidates = distinctCandidates.includes(item.expectedGooglePlaceId);

    return {
      ...item,
      ...submission,
      finalStatus: job.status,
      finalDecision: job.decision,
      finalReviewReason: job.needs_help_reason ?? job.failure_reason ?? null,
      actualFinalGooglePlaceId,
      correctFinalIdentity: actualFinalGooglePlaceId === item.expectedGooglePlaceId,
      candidateGooglePlaceIds: distinctCandidates,
      expectedInCandidates,
      candidateCount: distinctCandidates.length,
      topScore:
        job.extraction_payload?.plausibleCandidates?.[0]?.matchScore ??
        job.extraction_payload?.rawResolverCandidates?.[0]?.matchScore ??
        null,
      metadataDecision: job.extraction_payload?.autoSaveDecision ?? null,
      mediaFallbackScheduled: !!task,
      mediaFallbackClaimed: !!task?.locked_at,
      mediaFallbackCompleted: !!task && TERMINAL_TASKS.has(task.status),
      mediaStatus: task?.status ?? null,
      queueWaitMs,
      mediaExecutionMs,
      totalCompletionMs,
      retryCount: Math.max(0, (task?.attempts ?? 0) - 1),
      descriptionPresent: deepHas(latestRun?.evidence, (key, value) => key === 'description' && typeof value === 'string' && !!value),
      transcriptPresent: (latestRun?.transcript_segment_count ?? 0) > 0,
      selectedFramesPresent: (latestRun?.frame_count ?? 0) > 0,
      ocrEvidencePresent: (latestRun?.ocr_segment_count ?? 0) > 0,
      llmEvidencePresent: !!latestRun?.evidence,
      providerErrors: latestRun?.errors ?? [],
      warnings: latestRun?.warnings ?? [],
      googlePlacesSuccess: placeResults.some((result: any) => !!result.google_place_id),
      unnecessaryReview:
        job.status === 'needs_help' && distinctCandidates.length === 1 && expectedInCandidates,
    };
  });
}

function percentile(values: Array<number | null>, p: number): number | null {
  const sorted = values.filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function summarize(rows: any[]): Record<string, unknown> {
  const count = rows.length;
  const rate = (predicate: (row: any) => boolean) => Number((rows.filter(predicate).length / count).toFixed(4));
  const scheduled = rows.filter((row) => row.mediaFallbackScheduled);
  return {
    count,
    finalAccuracy: rate((row) => row.correctFinalIdentity),
    candidateRecall: rate((row) => row.expectedInCandidates || row.correctFinalIdentity),
    autoSaveRate: rate((row) => row.finalDecision === 'auto_save'),
    unnecessaryReviewRate: rate((row) => row.unnecessaryReview),
    mediaScheduleRate: rate((row) => row.mediaFallbackScheduled),
    mediaCompletionPopulationRate: rate((row) => row.mediaFallbackScheduled && row.mediaStatus === 'completed'),
    mediaSuccessRate: scheduled.length
      ? Number((scheduled.filter((row) => row.mediaStatus === 'completed').length / scheduled.length).toFixed(4))
      : null,
    queueWaitMs: { p50: percentile(rows.map((row) => row.queueWaitMs), 0.5), p95: percentile(rows.map((row) => row.queueWaitMs), 0.95) },
    mediaExecutionMs: { p50: percentile(rows.map((row) => row.mediaExecutionMs), 0.5), p95: percentile(rows.map((row) => row.mediaExecutionMs), 0.95) },
    totalCompletionMs: { p50: percentile(rows.map((row) => row.totalCompletionMs), 0.5), p95: percentile(rows.map((row) => row.totalCompletionMs), 0.95) },
    acknowledgementMs: { p50: percentile(rows.map((row) => row.acknowledgementMs), 0.5), p95: percentile(rows.map((row) => row.acknowledgementMs), 0.95) },
  };
}

async function runCondition(
  condition: Condition,
  gold: GoldCase[],
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
  endpoint: string,
): Promise<{ condition: Condition; rows: any[]; summary: Record<string, unknown> }> {
  const isolated = await createIsolatedUser(admin, anonKey, supabaseUrl);
  const submissions: TimedSubmission[] = [];
  try {
    if (condition === 'serial') {
      for (const item of gold) {
        const submission = await submitOne(endpoint, isolated.accessToken, condition, item);
        submissions.push(submission);
        await waitForFullPipeline(admin, [submission.jobId]);
        console.log(`[phase2-replay] serial ${submissions.length}/${gold.length} complete`);
      }
    } else {
      for (const item of gold) {
        submissions.push(await submitOne(endpoint, isolated.accessToken, condition, item));
        if (submissions.length < gold.length) await sleep(BURST_INTERVAL_MS);
      }
      await waitForFullPipeline(admin, submissions.map((submission) => submission.jobId));
      console.log(`[phase2-replay] burst ${submissions.length}/${gold.length} complete`);
    }
    const rows = await materializeResults(admin, gold, submissions);
    return { condition, rows, summary: summarize(rows) };
  } finally {
    const { error } = await admin.auth.admin.deleteUser(isolated.userId);
    if (error) console.warn(`[phase2-replay] isolated user cleanup failed: ${error.message}`);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const selected: Condition[] = args.has('--serial-only')
    ? ['serial']
    : args.has('--burst-only')
      ? ['burst']
      : ['serial', 'burst'];
  const fullGold = JSON.parse(fs.readFileSync(path.resolve('scripts/phase2-gold-set.json'), 'utf8')) as GoldCase[];
  assert.ok(fullGold.length >= 20 && fullGold.length <= 30, 'gold set must stay within the diagnostic 20-30 case range');
  assert.equal(new Set(fullGold.map((item) => item.id)).size, fullGold.length, 'gold case IDs must be unique');
  assert.ok(fullGold.every((item) => item.url.startsWith('https://www.instagram.com/')), 'gold inputs must be public Instagram URLs');
  assert.ok(fullGold.every((item) => /^ChIJ[A-Za-z0-9_-]+$/.test(item.expectedGooglePlaceId)), 'every case needs a provider ID');
  if (args.has('--validate')) {
    console.log(`[phase2-replay] valid gold set: ${fullGold.length} cases`);
    return;
  }
  if (!args.has('--execute')) throw new Error('Refusing hosted replay without explicit --execute');
  const limitArg = rawArgs.find((arg) => arg.startsWith('--limit='));
  const caseIdsIndex = rawArgs.findIndex((arg) => arg.startsWith('--case-ids='));
  const caseIdTokens = caseIdsIndex < 0
    ? []
    : [rawArgs[caseIdsIndex].slice('--case-ids='.length)];
  // Railway's Windows CLI expands comma-separated child arguments into
  // adjacent positional tokens, so consume plain tokens until the next flag.
  if (caseIdsIndex >= 0) {
    for (let index = caseIdsIndex + 1; index < rawArgs.length && !rawArgs[index].startsWith('--'); index += 1) {
      caseIdTokens.push(rawArgs[index]);
    }
  }
  const requestedCaseIds = caseIdTokens.length
    ? new Set(caseIdTokens.flatMap((token) => token.split(/[,\s]+/)).filter(Boolean))
    : null;
  const selectedGold = requestedCaseIds
    ? fullGold.filter((item) => requestedCaseIds.has(item.id))
    : fullGold;
  if (requestedCaseIds && selectedGold.length !== requestedCaseIds.size) {
    const known = new Set(fullGold.map((item) => item.id));
    const unknown = [...requestedCaseIds].filter((id) => !known.has(id));
    throw new Error(`One or more --case-ids values are not in the gold set: ${unknown.join(',')}`);
  }
  const requestedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : selectedGold.length;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > selectedGold.length) {
    throw new Error(`Invalid --limit; expected 1-${selectedGold.length}`);
  }
  const gold = selectedGold.slice(0, requestedLimit);

  const supabaseUrl = required('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = required('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/create-share-job`;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const runs = [];
  for (const condition of selected) runs.push(await runCondition(condition, gold, admin, supabaseUrl, anonKey, endpoint));

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    goldSetSize: gold.length,
    burstIntervalMs: BURST_INTERVAL_MS,
    runs,
  };
  fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
  const outputArg = rawArgs.find((arg) => arg.startsWith('--output='));
  const output = path.resolve(outputArg?.slice('--output='.length) || 'artifacts/phase2-serial-vs-burst.json');
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`[phase2-replay] wrote ${output}`);
  for (const run of runs) console.log(`[phase2-replay] ${run.condition} ${JSON.stringify(run.summary)}`);
}

main().catch((error) => {
  console.error(`[phase2-replay] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
