import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { NEARR_DEV_SUPABASE_REF } from '../lib/appEnvironmentCore';
import {
  buildShareJobRequest,
  classifyRecognition,
  loadTutorialCorpus,
  qualificationInfrastructureFailure,
  recordFreshQualificationJob,
  tutorialEntries,
  validateTutorialCorpus,
  type RecognitionObservation,
  type TutorialCorpusEntry,
  type TutorialMetadata,
} from './tutorialRecognitionCorpus';

type QualifiedEntry = TutorialCorpusEntry & { tutorial: TutorialMetadata };
type JobRow = {
  id: string;
  canonical_url: string | null;
  source_platform: string | null;
  status: string;
  progress_stage: string | null;
  decision: string | null;
  saved_place_id: string | null;
  candidate_payload: unknown;
  extraction_payload: unknown;
  needs_help_reason: string | null;
  failure_reason: string | null;
  failure_code: string | null;
  failure_category: string | null;
  recognition_run_mode: string;
  created_at: string;
  completed_at: string | null;
};

type ResultRow = {
  google_place_id: string | null;
  saved_place_id: string | null;
  outcome: string;
  origin: string;
  confidence_score: number | null;
  rule_version: string;
  reason_codes: unknown;
};

const JOB_COLUMNS =
  'id, canonical_url, source_platform, status, progress_stage, decision, saved_place_id, candidate_payload, extraction_payload, needs_help_reason, failure_reason, failure_code, failure_category, recognition_run_mode, created_at, completed_at';
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_required_env:${name}`);
  return value;
}

function exactDevGuard(): { supabaseUrl: string; anonKey: string; endpoint: string } {
  if (process.env.RUN_LIVE_TUTORIAL_QUALIFICATION !== '1') {
    throw new Error('live_qualification_not_opted_in:set_RUN_LIVE_TUTORIAL_QUALIFICATION=1');
  }
  if (required('EXPO_PUBLIC_APP_ENV') !== 'development' || required('EXPO_PUBLIC_BACKEND_ENV') !== 'development') {
    throw new Error('environment_guard_failed:app_and_backend_must_both_be_development');
  }
  const supabaseUrl = required('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = required('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const endpoint = required('EXPO_PUBLIC_CREATE_SHARE_JOB_URL');
  const expectedHost = `${NEARR_DEV_SUPABASE_REF}.supabase.co`;
  if (new URL(supabaseUrl).hostname !== expectedHost || new URL(endpoint).hostname !== expectedHost) {
    throw new Error(`environment_guard_failed:both_hosts_must_equal_${expectedHost}`);
  }
  if (!new URL(endpoint).pathname.endsWith('/functions/v1/create-share-job')) {
    throw new Error('environment_guard_failed:unexpected_create_share_job_path');
  }
  return { supabaseUrl, anonKey, endpoint };
}

async function authenticatedClient(supabaseUrl: string, anonKey: string): Promise<{ client: SupabaseClient; token: string; identityUserId: string }> {
  const preset = process.env.NEARR_TEST_ACCESS_TOKEN?.trim();
  if (preset) {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${preset}` } },
    });
    const { data, error } = await client.auth.getUser(preset);
    if (error || !data.user?.id) throw new Error(`dev_test_token_validation_failed:${error?.message ?? 'no_user'}`);
    return {
      client,
      token: preset,
      identityUserId: data.user.id,
    };
  }
  const email = process.env.NEARR_TEST_EMAIL?.trim();
  const password = process.env.NEARR_TEST_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error('missing_dev_test_identity:set_NEARR_TEST_ACCESS_TOKEN_or_both_NEARR_TEST_EMAIL_and_NEARR_TEST_PASSWORD');
  }
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error(`dev_test_login_failed:${error?.message ?? 'no_session'}`);
  return { client, token: data.session.access_token, identityUserId: data.user.id };
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function collectGoogleIds(value: unknown, output = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const item of value) collectGoogleIds(item, output);
    return output;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'google_place_id' || key === 'googlePlaceId' || key === 'providerId') && typeof item === 'string' && item.trim()) {
      output.add(item.trim());
    }
    collectGoogleIds(item, output);
  }
  return output;
}

function sourceWasAvailable(job: JobRow): boolean {
  const detail = `${job.failure_reason ?? ''} ${job.needs_help_reason ?? ''}`.toLowerCase();
  return !/(source[_ ]?unavailable|private|deleted|login.wall|provider.page|interstitial|not.found|http[_ ]?404)/.test(detail);
}

async function submit(
  endpoint: string,
  token: string,
  entry: QualifiedEntry,
  requestId: string,
  seenJobIds: Set<string>,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildShareJobRequest(entry.url, requestId)),
  });
  const raw = await response.text();
  let parsed: { jobId?: string; duplicate?: boolean; recognitionRunMode?: string; error?: string } = {};
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { /* reported below without dumping secrets */ }
  if (!response.ok || !parsed.jobId) throw new Error(`create_share_job_failed:http_${response.status}:${parsed.error ?? 'invalid_response'}`);
  if (parsed.recognitionRunMode !== 'fresh_media') {
    throw new Error(`qualification_mode_not_confirmed:${parsed.recognitionRunMode ?? 'missing'}`);
  }
  return recordFreshQualificationJob(parsed.jobId, parsed.duplicate, seenJobIds);
}

async function pollJob(client: SupabaseClient, jobId: string, timeoutMs: number): Promise<{ job: JobRow; stages: string[] }> {
  const started = Date.now();
  const stages: string[] = [];
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await client.from('share_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
    if (error) throw new Error(`job_read_failed:${error.message}`);
    if (!data) throw new Error('job_not_visible_to_test_identity');
    const job = data as JobRow;
    const marker = `${job.status}:${job.progress_stage ?? '-'}`;
    if (stages[stages.length - 1] !== marker) stages.push(marker);
    if (TERMINAL.has(job.status)) return { job, stages };
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`job_timeout_after_${timeoutMs}ms`);
}

async function readResults(client: SupabaseClient, jobId: string): Promise<ResultRow[]> {
  const { data, error } = await client
    .from('share_job_place_results')
    .select('google_place_id, saved_place_id, outcome, origin, confidence_score, rule_version, reason_codes')
    .eq('share_job_id', jobId);
  if (error) throw new Error(`result_read_failed:${error.message}`);
  return (data ?? []) as ResultRow[];
}

async function run(): Promise<void> {
  loadEnvFile(path.resolve(process.cwd(), '.env'));
  loadEnvFile(path.resolve(process.cwd(), '.env.local'));
  const env = exactDevGuard();
  const corpus = loadTutorialCorpus();
  const errors = validateTutorialCorpus(corpus);
  if (errors.length) throw new Error(`invalid_tutorial_corpus:${errors.join('|')}`);

  const requestedId = option('id');
  const requestedPlatform = option('platform');
  const safetyReplay = option('safety-replay') === 'true';
  if (safetyReplay && !requestedId) {
    throw new Error('safety_replay_requires_explicit_fixture_id');
  }
  const attempts = Math.max(1, Math.min(10, Number(option('attempts') ?? 3)));
  const timeoutMs = Math.max(30_000, Math.min(15 * 60_000, Number(option('timeout-ms') ?? 5 * 60_000)));
  const interAttemptMs = Math.max(0, Math.min(10 * 60_000, Number(option('inter-attempt-ms') ?? 0)));
  const candidates = tutorialEntries(corpus).filter((entry) =>
    (['candidate', 'primary', 'backup'].includes(entry.tutorial.eligibility) ||
      (safetyReplay && entry.id === requestedId)) &&
    entry.tutorial.sourceStatus === 'public' &&
    (!requestedId || entry.id === requestedId) &&
    (!requestedPlatform || entry.platform === requestedPlatform),
  );
  if (!candidates.length) throw new Error('no_matching_public_candidate_fixtures');

  const { client, token, identityUserId } = await authenticatedClient(env.supabaseUrl, env.anonKey);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: { app: 'development', backend: 'development', supabaseRef: NEARR_DEV_SUPABASE_REF, devIdentityUserId: identityUserId },
    configuration: {
      attemptsPerFixture: attempts,
      timeoutMs,
      interAttemptMs,
      freshJobsRequired: true,
      recognitionRunMode: 'fresh_media',
    },
    runs: [] as unknown[],
  };
  let unsuccessfulRuns = 0;
  const seenJobIds = new Set<string>();
  for (const entry of candidates) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1 && interAttemptMs > 0) {
        console.log(`WAIT ${entry.id} nextAttempt=${attempt} interAttemptMs=${interAttemptMs}`);
        await new Promise((resolve) => setTimeout(resolve, interAttemptMs));
      }
      const started = Date.now();
      const requestId = `onb2-01-${entry.id}-${Date.now()}-${attempt}`.slice(0, 190);
      try {
        const jobId = await submit(env.endpoint, token, entry, requestId, seenJobIds);
        const { job, stages } = await pollJob(client, jobId, timeoutMs);
        if (job.recognition_run_mode !== 'qualification_fresh') {
          throw new Error(`qualification_job_mode_mismatch:${job.recognition_run_mode ?? 'missing'}`);
        }
        const results = await readResults(client, jobId);
        const returnedGooglePlaceIds = [...collectGoogleIds(job.candidate_payload), ...collectGoogleIds(job.extraction_payload)];
        const savedGooglePlaceIds = results.filter((row) => !!row.saved_place_id && !!row.google_place_id).map((row) => row.google_place_id!);
        const observation: RecognitionObservation = {
          terminalStatus: job.status,
          decision: job.decision,
          returnedGooglePlaceIds: [...new Set([...returnedGooglePlaceIds, ...results.map((row) => row.google_place_id).filter((id): id is string => !!id)])],
          savedGooglePlaceIds: [...new Set(savedGooglePlaceIds)],
          sourceAvailable: sourceWasAvailable(job),
          infrastructureFailure: qualificationInfrastructureFailure({
            status: job.status,
            failureCategory: job.failure_category,
            failureCode: job.failure_code,
            failureReason: job.failure_reason,
            needsHelpReason: job.needs_help_reason,
          }),
        };
        const mediaFallbackObserved = stages.some((stage) => /media|video|audio|frame|transcrib|evidence/.test(stage));
        let verdict = classifyRecognition(entry.tutorial.expectedGooglePlaceId, observation);
        if (
          verdict.outcome === 'pass' &&
          entry.tutorial.expectedRecognitionPath === 'media_fallback' &&
          !mediaFallbackObserved
        ) {
          verdict = { outcome: 'controlled_non_success', reason: 'required_media_fallback_not_observed' };
        }
        const terminalOutcome = job.decision ?? job.status;
        if (verdict.outcome === 'pass' && !entry.tutorial.allowedTerminalOutcomes.includes(terminalOutcome)) {
          verdict = { outcome: 'controlled_non_success', reason: `terminal_outcome_not_allowed:${terminalOutcome}` };
        }
        if (verdict.outcome !== 'pass') unsuccessfulRuns += 1;
        const row = {
          fixtureId: entry.id,
          platform: entry.platform,
          submittedUrl: entry.url,
          canonicalizedUrl: job.canonical_url,
          jobId,
          attempt,
          clientRequestId: requestId,
          recognitionRunMode: job.recognition_run_mode,
          stages,
          metadataExtractionPresent: !!job.extraction_payload,
          mediaFallbackObserved,
          candidateGooglePlaceIds: observation.returnedGooglePlaceIds,
          finalDecision: job.decision,
          savedGooglePlaceIds: observation.savedGooglePlaceIds,
          expectedGooglePlaceId: entry.tutorial.expectedGooglePlaceId,
          outcome: verdict.outcome,
          reason: verdict.reason,
          placeResults: results,
          latencyMs: Date.now() - started,
          failureReason: job.failure_reason ?? job.needs_help_reason,
        };
        report.runs.push(row);
        console.log(`${verdict.outcome.toUpperCase()} ${entry.id} attempt=${attempt} decision=${job.decision ?? job.status} latencyMs=${row.latencyMs}`);
      } catch (error) {
        unsuccessfulRuns += 1;
        const message = error instanceof Error ? error.message : String(error);
        report.runs.push({
          fixtureId: entry.id,
          platform: entry.platform,
          submittedUrl: entry.url,
          attempt,
          outcome: 'infrastructure_failure',
          reason: message,
          latencyMs: Date.now() - started,
        });
        console.log(`INFRASTRUCTURE_FAILURE ${entry.id} attempt=${attempt} reason=${message}`);
      }
    }
  }

  const output = option('output') ?? path.join(os.tmpdir(), `nearr-tutorial-qualification-${Date.now()}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Report: ${output}`);
  if (unsuccessfulRuns) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`[tutorial-qualification] blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
