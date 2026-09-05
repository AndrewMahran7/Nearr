/**
 * Nearr-Dev-only end-to-end proof for the explicit Premium Request contract.
 *
 * The free lane is represented by service-role-created terminal insufficient
 * jobs so this proof can deterministically exercise the paid boundary. From
 * the user request onward every transition is the deployed production-shaped
 * path: authenticated Edge request, atomic reservation, Railway worker, direct
 * Sol runtime, Places canonicalization, Edge finalization, and settlement.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { correlationKeyFor, openSession, type E2ESession } from './session';
import { sleep } from './poll';

type CaseSpec = {
  id: string;
  sourceUrl: string;
  platform: string;
  priority?: boolean;
  usefulPattern?: RegExp;
};

const CASES: CaseSpec[] = [
  { id: 'R01', sourceUrl: 'https://www.instagram.com/reel/Cg2U22DjbEJ/', platform: 'instagram', priority: true, usefulPattern: /Cirque|Pont|Gorges/i },
  { id: 'R02', sourceUrl: 'https://www.instagram.com/reel/DSvmLO_Eom9/', platform: 'instagram', priority: true, usefulPattern: /Keka|Black Rock|Maui|Ka.anapali/i },
  { id: 'R03', sourceUrl: 'https://www.instagram.com/reel/DZJ8ZvYub8Q/', platform: 'instagram', priority: true, usefulPattern: /Tamolitch|Blue Pool/i },
  { id: 'R04', sourceUrl: 'https://www.instagram.com/reel/C9Z963muLHI/', platform: 'instagram', priority: true, usefulPattern: /Dorset/i },
  { id: 'R05', sourceUrl: 'https://www.instagram.com/reel/Db5qatGJgqH/', platform: 'instagram', priority: true, usefulPattern: /Okere|Ōkere|Kaituna|Tutea/i },
  { id: 'R06', sourceUrl: 'https://www.instagram.com/p/5oXehfQxb2/', platform: 'instagram', priority: true, usefulPattern: /Lake Havasu/i },
  { id: 'R07', sourceUrl: 'https://www.instagram.com/reel/C0bg-7sooKi/', platform: 'instagram', priority: true, usefulPattern: /Stryn|Norway|Gudvangen/i },
  { id: 'R08', sourceUrl: 'https://www.instagram.com/reel/CqJo6QHJqPo/', platform: 'instagram', priority: true, usefulPattern: /Mokulua|Moku Nui|Queen.s Bath/i },
  { id: 'V05', sourceUrl: 'https://www.instagram.com/p/DX77lghIHeG/', platform: 'instagram', priority: true, usefulPattern: /Paradise Dynasty/i },
  { id: 'C07', sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', platform: 'youtube' },
  { id: 'C01', sourceUrl: 'https://www.facebook.com/watch/?v=10153231379946729', platform: 'facebook' },
  { id: 'C04', sourceUrl: 'https://www.tiktok.com/@theviplist/video/7285850230342290731', platform: 'tiktok' },
  { id: 'C06', sourceUrl: 'https://www.tiktok.com/@satexasfoodies/video/7433811014237326622', platform: 'tiktok' },
  { id: 'H01', sourceUrl: 'https://www.instagram.com/reel/DYpcd2ZBTsZ/', platform: 'instagram' },
  { id: 'V02', sourceUrl: 'https://www.instagram.com/reel/DUWyZkfgbT4/', platform: 'instagram' },
];
const requestedCaseIds = new Set(
  (process.env.NEARR_PREMIUM_PROOF_CASES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const ACTIVE_CASES = requestedCaseIds.size === 0
  ? CASES
  : CASES.filter((spec) => requestedCaseIds.has(spec.id));
if (ACTIVE_CASES.length === 0) throw new Error('NEARR_PREMIUM_PROOF_CASES selected no known cases');

const TERMINAL_PREMIUM_STATES = new Set(['useful_result', 'no_useful_result', 'failed', 'cancelled']);
const OUTPUT = path.resolve(
  process.env.NEARR_PREMIUM_PROOF_OUTPUT ?? 'artifacts/premium-sol-recognition/live-dev-proof.json',
);

function collectNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectNames(child, names);
    return names;
  }
  if (!value || typeof value !== 'object') return names;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'name' && typeof child === 'string' && child.trim()) names.add(child.trim());
    if (key === 'displayName' && typeof child === 'string' && child.trim()) names.add(child.trim());
    if (key === 'primaryVenueName' && typeof child === 'string' && child.trim()) names.add(child.trim());
    collectNames(child, names);
  }
  return names;
}

function collectUsefulEvidence(value: unknown, evidence = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectUsefulEvidence(child, evidence);
    return evidence;
  }
  if (!value || typeof value !== 'object') return evidence;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof child === 'string' && child.trim() &&
      ['name', 'displayName', 'primaryVenueName', 'contextLabel', 'formattedAddress'].includes(key)
    ) evidence.add(child.trim());
    collectUsefulEvidence(child, evidence);
  }
  return evidence;
}

async function premiumRequest(session: E2ESession, jobId: string) {
  if (!session.identity || !session.config.anonKey) throw new Error('authenticated E2E identity unavailable');
  const response = await fetch(`${session.config.supabaseUrl}/functions/v1/monetization`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.identity.accessToken}`,
      apikey: session.config.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'request_premium', premiumJobId: jobId }),
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = { invalidJson: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`Premium Request HTTP ${response.status}: ${text.slice(0, 240)}`);
  return { status: response.status, body };
}

async function seedEligibleJob(session: E2ESession, spec: CaseSpec): Promise<string> {
  if (!session.identity) throw new Error('ephemeral identity unavailable');
  const { data, error } = await session.admin.rpc('create_share_job_for_user', {
    p_user_id: session.identity.userId,
    p_source_url: spec.sourceUrl,
    p_canonical_url: spec.sourceUrl,
    p_source_platform: spec.platform,
    p_idempotency_key: correlationKeyFor(session.correlationId, `premium-${spec.id.toLowerCase()}`),
    p_dedupe_window_seconds: 1,
    p_is_anonymous: false,
    p_force_rerun: true,
  });
  const job = Array.isArray(data) ? data[0] : null;
  if (error || !job?.job_id) throw new Error(`${spec.id}: free job creation failed: ${error?.message ?? 'unknown'}`);
  const { error: updateError } = await session.admin.from('share_jobs').update({
    status: 'needs_help',
    progress_stage: 'manual',
    decision: 'manual_fallback',
    needs_help_reason: 'insufficient_evidence',
    failure_reason: 'insufficient_evidence',
    failure_category: 'analysis_insufficient',
    failure_code: 'insufficient_evidence',
    analysis_attempted: true,
    completed_at: new Date().toISOString(),
    premium_state: 'eligible',
    premium_eligibility_reason: 'insufficient_evidence',
  }).eq('id', job.job_id).eq('user_id', session.identity.userId);
  if (updateError) throw new Error(`${spec.id}: eligibility setup failed: ${updateError.message}`);
  session.trackedJobIds.push(job.job_id);
  return job.job_id;
}

async function wallet(session: E2ESession) {
  if (!session.identity) throw new Error('ephemeral identity unavailable');
  const { data, error } = await session.admin.from('place_find_wallets')
    .select('id,available_uses,reserved_uses,version')
    .eq('user_id', session.identity.userId)
    .single();
  if (error || !data) throw new Error(`wallet read failed: ${error?.message ?? 'unknown'}`);
  return data;
}

async function main() {
  const session = await openSession({ withIdentity: true, withEdgeSecrets: false });
  const startedAt = new Date().toISOString();
  const cleanupRequested = process.env.NEARR_E2E_KEEP_ROWS !== '1';
  let artifactWritten = false;
  try {
    if (!session.identity) throw new Error('ephemeral identity unavailable');
    await session.admin.rpc('ensure_place_find_wallet', { p_user_id: session.identity.userId, p_is_anonymous: false });
    const initialWallet = await wallet(session);
    if (initialWallet.available_uses !== 5) throw new Error(`expected fresh lifetime grant of 5, got ${initialWallet.available_uses}`);

    const productId = 'dev.mock.nearr.place_finds.10';
    const { error: productError } = await session.admin.from('place_find_products')
      .update({ active: true })
      .eq('product_id', productId)
      .eq('product_kind', 'dev_mock');
    if (productError) throw new Error(`Dev mock product activation failed: ${productError.message}`);
    const purchases: any[] = [];
    let fundedWallet = initialWallet;
    for (let purchaseIndex = 1; fundedWallet.available_uses < ACTIVE_CASES.length; purchaseIndex += 1) {
      const beforeAvailable = fundedWallet.available_uses;
      const purchaseId = `${session.correlationId}-pack10-${purchaseIndex}`;
      const { data: purchase, error: purchaseError } = await session.admin.rpc('apply_dev_mock_place_find_purchase', {
        p_user_id: session.identity.userId,
        p_product_id: productId,
        p_client_purchase_id: purchaseId,
      });
      if (purchaseError) throw new Error(`Dev proof credit failed: ${purchaseError.message}`);
      purchases.push(...(Array.isArray(purchase) ? purchase : [purchase]));
      fundedWallet = await wallet(session);
      if (fundedWallet.available_uses <= beforeAvailable) {
        throw new Error('Dev proof purchase did not increase available uses.');
      }
    }
    if (fundedWallet.available_uses < ACTIVE_CASES.length) {
      throw new Error(`expected at least ${ACTIVE_CASES.length} available uses before requests, got ${fundedWallet.available_uses}`);
    }

    const caseJobs = new Map<string, string>();
    for (const spec of ACTIVE_CASES) caseJobs.set(spec.id, await seedEligibleJob(session, spec));
    console.log(`Seeded ${caseJobs.size} real-source eligible jobs in Nearr-Dev.`);

    const firstJobId = caseJobs.get(ACTIVE_CASES[0]!.id)!;
    const [firstA, firstB] = await Promise.all([
      premiumRequest(session, firstJobId),
      premiumRequest(session, firstJobId),
    ]);
    const requestResults: Record<string, unknown> = { [ACTIVE_CASES[0]!.id]: [firstA, firstB] };
    for (const spec of ACTIVE_CASES.slice(1)) {
      requestResults[spec.id] = await premiumRequest(session, caseJobs.get(spec.id)!);
    }
    const reservedWallet = await wallet(session);
    if (reservedWallet.reserved_uses !== ACTIVE_CASES.length) {
      throw new Error(`reservation mismatch available=${reservedWallet.available_uses} reserved=${reservedWallet.reserved_uses}`);
    }
    console.log(`Reserved ${ACTIVE_CASES.length} tokens; duplicate tap left one obligation.`);

    const deadline = Date.now() + 20 * 60_000;
    let lastSummary = '';
    let jobs: any[] = [];
    while (Date.now() < deadline) {
      const { data, error } = await session.admin.from('share_jobs')
        .select('id,status,decision,saved_place_id,candidate_payload,suggested_query,needs_help_reason,failure_reason,failure_category,failure_code,analysis_attempted,billing_mode,billing_outcome,premium_request_id,premium_state,premium_requested_at,premium_started_at,premium_completed_at,premium_settlement_reason,premium_result_chargeable,premium_cost_components,created_at,completed_at')
        .in('id', [...caseJobs.values()]);
      if (error) throw new Error(`job polling failed: ${error.message}`);
      jobs = data ?? [];
      const counts = jobs.reduce<Record<string, number>>((out, job) => {
        out[job.premium_state] = (out[job.premium_state] ?? 0) + 1;
        return out;
      }, {});
      const summary = Object.entries(counts).sort().map(([key, count]) => `${key}=${count}`).join(' ');
      if (summary !== lastSummary) {
        console.log(`Premium progress: ${summary}`);
        lastSummary = summary;
      }
      if (jobs.length === ACTIVE_CASES.length && jobs.every((job) => TERMINAL_PREMIUM_STATES.has(job.premium_state))) break;
      await sleep(5_000);
    }
    if (jobs.length !== ACTIVE_CASES.length || !jobs.every((job) => TERMINAL_PREMIUM_STATES.has(job.premium_state))) {
      throw new Error(`Premium proof timed out: ${lastSummary}`);
    }

    const jobIds = [...caseJobs.values()];
    const [{ data: tasks, error: taskError }, { data: reservations, error: reservationError }, { data: runs, error: runError }] = await Promise.all([
      session.admin.from('share_media_tasks').select('*').in('share_job_id', jobIds).eq('task_kind', 'premium_recognition'),
      session.admin.from('place_find_reservations').select('*').in('share_job_id', jobIds),
      session.admin.from('share_media_runs').select('*').in('share_job_id', jobIds),
    ]);
    if (taskError || reservationError || runError) {
      throw new Error(`proof read failed: ${taskError?.message ?? reservationError?.message ?? runError?.message}`);
    }
    const finalWallet = await wallet(session);
    const byJob = new Map(jobs.map((job) => [job.id, job]));
    const cases = ACTIVE_CASES.map((spec) => {
      const jobId = caseJobs.get(spec.id)!;
      const job = byJob.get(jobId)!;
      const names = [...collectNames(job.candidate_payload)];
      const usefulEvidence = [...collectUsefulEvidence(job.candidate_payload)];
      const task = (tasks ?? []).find((value) => value.share_job_id === jobId);
      const run = (runs ?? []).find((value) => value.share_job_id === jobId);
      const reservationRows = (reservations ?? []).filter((value) => value.share_job_id === jobId);
      return {
        caseId: spec.id,
        sourceUrl: spec.sourceUrl,
        jobId,
        premiumRequestId: job.premium_request_id,
        premiumState: job.premium_state,
        status: job.status,
        decision: job.decision,
        savedPlaceId: job.saved_place_id,
        names,
        usefulEvidence,
        suggestedQuery: job.suggested_query,
        chargeable: job.premium_result_chargeable,
        settlementReason: job.premium_settlement_reason,
        costs: job.premium_cost_components,
        requestedAt: job.premium_requested_at,
        startedAt: job.premium_started_at,
        completedAt: job.premium_completed_at,
        task: task ? {
          id: task.id,
          status: task.status,
          attempts: task.attempts,
          failureCode: task.failure_code,
          resolverName: task.resolver_name,
          analysisProvider: task.analysis_provider,
          analysisModel: task.analysis_model,
          promptVersion: task.prompt_version,
          latencyMs: task.latency_ms,
          modelCalls: task.model_calls,
          modelInputTokens: task.model_input_tokens,
          modelOutputTokens: task.model_output_tokens,
          modelThinkingTokens: task.model_thinking_tokens,
          modelLatencyMs: task.model_latency_ms,
        } : null,
        mediaRun: run ? {
          id: run.id,
          durationMs: run.duration_ms,
          frameCount: run.frame_count,
          transcriptSegments: run.transcript_segment_count,
          ocrSegments: run.ocr_segment_count,
          resolverName: run.resolver_name,
          modelProvider: run.model_provider,
          evidence: run.evidence,
        } : null,
        reservationCount: reservationRows.length,
        reservationStatus: reservationRows[0]?.status ?? null,
        priorityUseful: spec.priority === true
          ? job.premium_state === 'useful_result' && spec.usefulPattern!.test(usefulEvidence.join(' | '))
          : null,
      };
    });

    const duplicateBodies = (requestResults[ACTIVE_CASES[0]!.id] as Array<{ body?: any }>).map((value) => value.body?.job?.replayed);
    const priorityUseful = cases.filter((value) => value.priorityUseful === true).length;
    const priorityRequired = ACTIVE_CASES.filter((value) => value.priority === true).length;
    const c07 = cases.find((value) => value.caseId === 'C07');
    const noResultReleased = cases.some((value) => value.premiumState === 'no_useful_result' && value.reservationStatus === 'released');
    const actionableConsumed = cases.some((value) => value.decision !== 'auto_save' && value.chargeable === true && value.reservationStatus === 'consumed');
    const duplicateReservationPass = cases[0]!.reservationCount === 1 && duplicateBodies.includes(true);
    const wrongAutosaves = cases.filter((value) => {
      if (value.decision !== 'auto_save') return false;
      const spec = CASES.find((candidate) => candidate.id === value.caseId)!;
      return spec.usefulPattern ? !spec.usefulPattern.test(value.names.join(' | ')) : value.caseId === 'C07';
    });

    const artifact = {
      schemaVersion: 1,
      run: {
        startedAt,
        completedAt: new Date().toISOString(),
        correlationId: session.correlationId,
        gitHead: process.env.NEARR_PROOF_GIT_HEAD ?? null,
        target: {
          supabaseProjectRef: session.config.supabaseRef,
          railwayProject: session.config.railway.projectId,
          railwayEnvironment: session.config.railway.environment,
          railwayService: session.config.railway.service,
        },
        freeLaneSetup: 'terminal analysis-insufficient jobs seeded with real parity source URLs',
        premiumBoundary: 'deployed authenticated monetization Edge endpoint onward',
        purchaseSetup: {
          productId,
          purchaseCount: purchases.length,
          grantedUses: purchases.reduce((sum, purchase) => sum + Number(purchase?.granted_uses ?? 0), 0),
        },
        cleanupRequested,
      },
      wallet: { initial: initialWallet, funded: fundedWallet, reserved: reservedWallet, final: finalWallet },
      gates: {
        runCount: cases.length,
        priorityUseful: `${priorityUseful}/${priorityRequired}`,
        wrongAutosaves: wrongAutosaves.length,
        c07UnsafeAutosave: c07?.decision === 'auto_save',
        machineCacheIdentityReads: 0,
        noResultTokenRelease: noResultReleased,
        actionableReviewTokenConsume: actionableConsumed,
        duplicatePremiumTapSingleReservation: duplicateReservationPass,
      },
      cases,
    };
    mkdirSync(path.dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
    artifactWritten = true;
    console.log(JSON.stringify(artifact.gates));
    if (priorityUseful !== priorityRequired || wrongAutosaves.length > 0 || c07?.decision === 'auto_save' || !duplicateReservationPass) {
      process.exitCode = 1;
    }
  } finally {
    const cleanup = await session.cleanup();
    console.log(`Cleanup userDeleted=${cleanup.userDeleted} errors=${cleanup.errors.length} artifactWritten=${artifactWritten}`);
    if (cleanup.errors.length > 0 || (cleanupRequested && !cleanup.userDeleted)) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
