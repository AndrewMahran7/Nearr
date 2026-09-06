/**
 * One-shot, self-cleaning Production smoke for the Automatic Deep release.
 *
 * Run only through `railway run` scoped to the Production Nearr worker so the
 * script receives the deployed service environment without copying secrets to
 * disk. Every write belongs to one ephemeral auth user and is removed in the
 * finally block.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { isCategoryOnlyPlaceName } from '../../services/media-worker/src/vayrin/placeIdentityGuard';
import { cleanupSession } from './session';

const PRODUCTION_REF = 'rlqvxdwtetxsqxhqztkw';
const TERMINAL = new Set(['saved', 'completed', 'needs_help', 'failed', 'unavailable']);
const PREMIUM_EVENTS = [
  'premium_request_offered',
  'premium_request_cta_tapped',
  'premium_request_reserved',
  'premium_request_consumed',
  'premium_request_released',
  'premium_request_started',
  'premium_request_useful_result',
  'premium_request_no_useful_result',
  'premium_request_token_consumed',
  'premium_request_token_released',
];

type CaseSpec = { id: string; sourceUrl: string; purpose: string };
type Wallet = { present: boolean; availableUses: number; reservedUses: number; version: number };

const cases: CaseSpec[] = [
  { id: 'EXACT_NORMAL', sourceUrl: 'https://www.instagram.com/reel/DWJ2zaqEQOk/', purpose: 'exact normal control' },
  { id: 'GENERIC_WEAK', sourceUrl: 'https://www.instagram.com/reel/DZbppj6IXOt/', purpose: 'generic/weak waterfall escalation' },
  { id: 'BROAD_AREA', sourceUrl: 'https://www.instagram.com/p/5oXehfQxb2/', purpose: 'Lake Havasu parent escalation' },
  { id: 'ZERO_HYPOTHESIS', sourceUrl: 'https://www.instagram.com/reel/DJ1CVA8vbfV/', purpose: 'first-pass zero, bounded recovery' },
  { id: 'C07_SAFETY', sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', purpose: 'review-only memory-prior safety' },
];

function productionRef(url: string): string | null {
  try { return new URL(url).hostname.split('.')[0] || null; } catch { return null; }
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function collectNamed(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const child of value) collectNamed(child, out);
    return out;
  }
  const row = object(value);
  if (!row) return out;
  if (typeof row.name === 'string' && row.name.trim()) out.push(row.name.replace(/\s+/g, ' ').trim());
  for (const child of Object.values(row)) collectNamed(child, out);
  return out;
}

function namesOf(payload: unknown): string[] {
  return [...new Set(collectNamed(payload))].slice(0, 3);
}

function isBroad(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return isCategoryOnlyPlaceName(name) || [
    'bali', 'california', 'maui', 'oregon', 'norway', 'hawaii', 'croatia',
    'los angeles', 'san diego', 'paris', 'lake havasu',
  ].includes(normalized);
}

async function wallet(admin: SupabaseClient, userId: string): Promise<Wallet> {
  const { data, error } = await admin.from('place_find_wallets')
    .select('available_uses,reserved_uses,version').eq('user_id', userId).limit(1);
  if (error) throw new Error(`wallet read failed: ${error.message}`);
  const row = data?.[0];
  return {
    present: !!row,
    availableUses: Number(row?.available_uses ?? 0),
    reservedUses: Number(row?.reserved_uses ?? 0),
    version: Number(row?.version ?? 0),
  };
}

async function seed(admin: SupabaseClient, userId: string, runKey: string, spec: CaseSpec): Promise<string> {
  const platform = new URL(spec.sourceUrl).hostname.includes('youtube') ? 'youtube' : 'instagram';
  const { data: job, error: jobError } = await admin.from('share_jobs').insert({
    user_id: userId,
    source_url: spec.sourceUrl,
    canonical_url: spec.sourceUrl,
    source_platform: platform,
    status: 'processing_metadata',
    progress_stage: 'checking_video',
    idempotency_key: `${runKey}-${spec.id.toLowerCase()}`,
    billing_mode: 'normal_free',
    billing_outcome: 'unmetered:normal_free',
    locked_until: null,
  }).select('id').single();
  if (jobError || !job) throw new Error(`${spec.id} job insert failed: ${jobError?.message ?? 'unknown'}`);
  const { error: taskError } = await admin.from('share_media_tasks').insert({
    share_job_id: job.id,
    user_id: userId,
    source_url: spec.sourceUrl,
    canonical_url: spec.sourceUrl,
    platform,
    status: 'queued',
    progress_stage: 'queued',
    max_attempts: 1,
  });
  if (taskError) throw new Error(`${spec.id} task insert failed: ${taskError.message}`);
  return job.id;
}

async function waitForJobs(admin: SupabaseClient, jobIds: string[], label: string): Promise<any[]> {
  const deadline = Date.now() + 30 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('share_jobs').select('*').in('id', jobIds);
    if (error) throw new Error(`${label} poll failed: ${error.message}`);
    const rows = data ?? [];
    const summary = [...rows].map((row) => `${row.id}:${row.status}`).sort().join(' ');
    if (summary !== last) { console.log(`${label}: ${rows.map((row) => row.status).join(',')}`); last = summary; }
    if (rows.length === jobIds.length && rows.every((row) => TERMINAL.has(row.status))) return rows;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${label} timed out`);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function main(): Promise<void> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (productionRef(supabaseUrl) !== PRODUCTION_REF) throw new Error('refusing non-Production or ambiguous target');
  if (!serviceRoleKey) throw new Error('missing service role key');
  if (process.env.AUTOMATIC_DEEP_RECOGNITION_ENABLED !== 'true') throw new Error('Automatic Deep is not explicitly true');
  if (process.env.PREMIUM_REQUESTS_ENABLED !== 'false') throw new Error('Premium is not explicitly false');
  if (process.env.RECOGNITION_CACHE_READS_ENABLED !== 'false') throw new Error('cache reads are not explicitly false');
  if (process.env.MEDIA_WORKER_MAX_CONCURRENCY !== '4' || process.env.MEDIA_WORKER_CLAIM_BATCH !== '4') {
    throw new Error('worker capacity is not the approved 4/4');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runKey = `nearr-prod-auto-deep-smoke-${stamp}-${randomUUID().slice(0, 8)}`;
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const email = `${runKey}@nearr.invalid`;
  let identity: { userId: string; email: string; accessToken: string } | null = null;
  const jobIds: string[] = [];
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { purpose: 'nearr_production_auto_deep_smoke', runKey },
    });
    if (createError || !created.user) throw new Error(`ephemeral user failed: ${createError?.message ?? 'unknown'}`);
    const authClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw new Error(`ephemeral sign-in failed: ${signInError?.message ?? 'unknown'}`);
    identity = { userId: created.user.id, email, accessToken: signedIn.session.access_token };

    const before = await wallet(admin, identity.userId);
    const ids = new Map<string, string>();
    for (const spec of cases) {
      const id = await seed(admin, identity.userId, runKey, spec);
      ids.set(spec.id, id);
      jobIds.push(id);
    }
    const firstJobs = await waitForJobs(admin, jobIds, 'primary');

    // Repeat one broad-parent source after its first result is terminal. The
    // second run must still show a fresh Simple Sol attempt while answer-cache
    // reads are disabled.
    const cacheSpec: CaseSpec = { ...cases.find((item) => item.id === 'GENERIC_WEAK')!, id: 'CACHE_FRESH_REPEAT' };
    const repeatId = await seed(admin, identity.userId, runKey, cacheSpec);
    ids.set(cacheSpec.id, repeatId);
    jobIds.push(repeatId);
    const repeatJobs = await waitForJobs(admin, [repeatId], 'cache-repeat');
    const jobs = [...firstJobs, ...repeatJobs];

    console.log('post-run: reading tasks, runs, and reservations');
    const [{ data: tasks, error: taskError }, { data: runs, error: runError }, { data: reservations, error: reservationError }] = await Promise.all([
      admin.from('share_media_tasks').select('*').in('share_job_id', jobIds),
      admin.from('share_media_runs').select('*').in('share_job_id', jobIds),
      admin.from('place_find_reservations').select('id,status,share_job_id').in('share_job_id', jobIds),
    ]);
    if (taskError || runError || reservationError) throw new Error(taskError?.message ?? runError?.message ?? reservationError?.message);
    const after = await wallet(admin, identity.userId);
    const walletDelta = {
      availableUses: after.availableUses - before.availableUses,
      reservedUses: after.reservedUses - before.reservedUses,
      version: after.version - before.version,
    };
    const byRun = new Map((runs ?? []).map((row: any) => [row.share_job_id, row]));
    const byTask = new Map((tasks ?? []).map((row: any) => [row.share_job_id, row]));
    const observations = [...cases, cacheSpec].map((spec) => {
      const jobId = ids.get(spec.id)!;
      const job = jobs.find((row) => row.id === jobId)!;
      const run: any = byRun.get(jobId);
      const evidence = object(run?.evidence);
      const automaticDeep = object(evidence?.automaticDeep);
      const recognition = object(evidence?.automaticDeepRecognition);
      return {
        id: spec.id,
        purpose: spec.purpose,
        status: job.status,
        decision: job.decision,
        savedPlaceId: job.saved_place_id ?? null,
        finalNames: namesOf(job.candidate_payload),
        modelProvider: run?.model_provider ?? null,
        durationMs: Number(run?.duration_ms ?? 0),
        taskStatus: (byTask.get(jobId) as any)?.status ?? null,
        automaticDeep,
        recognition,
      };
    });

    console.log('post-run: checking Premium suspension');
    const premiumResponse = await fetch(`${supabaseUrl}/functions/v1/monetization`, {
      method: 'POST',
      headers: { authorization: `Bearer ${identity.accessToken}`, apikey: serviceRoleKey, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'request_premium', premiumJobId: ids.get('GENERIC_WEAK') }),
      signal: AbortSignal.timeout(20_000),
    });
    const premiumBody = await premiumResponse.json().catch(() => null) as any;
    console.log('post-run: reading analytics');
    const [{ data: premiumEvents, error: premiumEventError }, { data: deepEvents, error: deepEventError }] = await Promise.all([
      admin.from('analytics_events').select('event_name').eq('user_id', identity.userId).in('event_name', PREMIUM_EVENTS),
      admin.from('analytics_events').select('event_name').eq('user_id', identity.userId).like('event_name', 'deep_recognition_%'),
    ]);
    if (premiumEventError || deepEventError) throw new Error(premiumEventError?.message ?? deepEventError?.message);

    const exact = observations.find((item) => item.id === 'EXACT_NORMAL')!;
    const generic = observations.find((item) => item.id === 'GENERIC_WEAK')!;
    const broad = observations.find((item) => item.id === 'BROAD_AREA')!;
    const zero = observations.find((item) => item.id === 'ZERO_HYPOTHESIS')!;
    const c07 = observations.find((item) => item.id === 'C07_SAFETY')!;
    const repeat = observations.find((item) => item.id === 'CACHE_FRESH_REPEAT')!;
    const deepLatencies = observations.filter((item) => item.automaticDeep?.invoked === true).map((item) => item.durationMs);
    const assertions = {
      allTerminal: observations.every((item) => TERMINAL.has(item.status)),
      exactNormalSkippedDeep: exact.automaticDeep?.invoked !== true,
      genericWeakEscalatedToSpecific: generic.automaticDeep?.invoked === true && generic.finalNames.length > 0 && generic.finalNames.every((name) => !isBroad(name)),
      broadAreaEscalatedToSpecific: broad.automaticDeep?.invoked === true && broad.finalNames.length > 0 && broad.finalNames.every((name) => !isBroad(name)),
      zeroHypothesisRecovered: zero.automaticDeep?.firstAttemptSpecificHypotheses === 0 && zero.automaticDeep?.recoveryInvoked === true && zero.automaticDeep?.attempts === 2 && zero.finalNames.length > 0,
      c07ReviewOnly: !c07.savedPlaceId && c07.decision !== 'auto_save',
      cacheRepeatFreshInference: repeat.automaticDeep?.invoked === true && typeof repeat.modelProvider === 'string' && repeat.modelProvider.includes('simple-sol'),
      zeroWrongAutosaves: observations.every((item) => !item.savedPlaceId),
      zeroPremiumReservations: (reservations ?? []).length === 0,
      zeroPremiumAnalytics: (premiumEvents ?? []).length === 0,
      zeroWalletDelta: Object.values(walletDelta).every((value) => value === 0),
      premiumSuspended503: premiumResponse.status === 503 && premiumBody?.error === 'premium_requests_suspended',
    };
    const report = {
      schemaVersion: 1,
      runKey,
      target: { supabaseRef: PRODUCTION_REF, railwayEnvironment: 'production', railwayService: 'Nearr' },
      deployedFlags: { automaticDeep: true, premium: false, cacheReads: false, concurrency: 4, claimBatch: 4 },
      observations,
      billing: { walletBefore: before, walletAfter: after, walletDelta, premiumReservations: (reservations ?? []).length, premiumAnalytics: (premiumEvents ?? []).length },
      analytics: { deepEventCount: (deepEvents ?? []).length, deepEventNames: [...new Set((deepEvents ?? []).map((row: any) => row.event_name))] },
      premiumEndpoint: { status: premiumResponse.status, error: premiumBody?.error ?? null },
      performance: {
        escalationRate: observations.filter((item) => item.automaticDeep?.invoked === true).length / observations.length,
        normalOnlyLatencyMs: exact.durationMs,
        deepP50Ms: percentile(deepLatencies, 0.5),
        deepP95Ms: percentile(deepLatencies, 0.95),
        knownDeepModelCostUsd: observations.reduce((sum, item) => sum + Number(item.recognition?.knownModelCostUsd ?? 0), 0),
      },
      assertions,
    };
    const outputDir = path.resolve('artifacts', 'automatic-deep-recognition', 'production');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `smoke-${stamp}.json`);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputPath, report }, null, 2));
    if (Object.values(assertions).some((value) => value !== true)) process.exitCode = 1;
  } finally {
    const cleanup = await cleanupSession(admin, identity, jobIds);
    console.log(JSON.stringify({ cleanup }, null, 2));
    if (identity && (!cleanup.userDeleted || cleanup.errors.length > 0)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
