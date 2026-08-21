/**
 * scripts/e2e/fixtures/pipeline.ts
 *
 * Fixtures A, B, D and E (Part 4). Fixture C — the live model boundary — is in
 * ./vayrin.ts because it is the only one that can spend money.
 *
 * FIXTURE DESIGN RULE: no fixture may depend on a particular live social post
 * staying up, staying public, or staying scrapeable. A regression suite that
 * goes red because a stranger deleted a reel trains people to ignore it. Each
 * fixture below is therefore anchored to something stable — a long-lived
 * reference page, a URL shape that is deterministically unavailable, or a
 * synthetic payload delivered to a real deployed endpoint.
 */

import { StageReporter } from '../report';
import { timeoutFor } from '../poll';
import {
  JOB_TERMINAL,
  StatusTrail,
  assertCheapPathSkippedMedia,
  assertNoCreatorNameAutoSave,
  assertResolverIdentifiedAPlace,
  assertTerminalSuccessPersisted,
  type JobRow,
} from '../lifecycle';
import { correlationKeyFor, type E2ESession } from '../session';
import {
  awaitEdgeClaim,
  awaitJobTerminal,
  awaitMediaTask,
  candidateCount,
  readJob,
  readTaskForJob,
  submitShareJob,
} from './shared';

export type FixtureOutcome = { name: string; ok: boolean };

// ---------------------------------------------------------------------------
// Fixture A — cheap metadata path
// ---------------------------------------------------------------------------

/**
 * A long-lived reference page whose own metadata names a business AND its
 * street address, so the deterministic metadata resolver can identify the place
 * from text alone. Chosen because it has been stable for years, is free to
 * fetch, is not a social post, and cannot be taken down by one account holder.
 * Override with NEARR_E2E_CHEAP_URL if it ever stops carrying the address.
 */
const CHEAP_PATH_URL =
  process.env.NEARR_E2E_CHEAP_URL || 'https://en.wikipedia.org/wiki/Katz%27s_Delicatessen';

export async function fixtureCheapPath(
  reporter: StageReporter,
  session: E2ESession,
): Promise<FixtureOutcome> {
  const name = 'Fixture A — cheap metadata path';
  const submitted = await submitShareJob(session, 'cheap-path', CHEAP_PATH_URL);
  if (!submitted.ok) {
    reporter.fail(`${name}: share job accepted`, submitted.elapsedMs, submitted.detail);
    return { name, ok: false };
  }
  reporter.identify({ jobId: submitted.jobId });
  reporter.pass(
    `${name}: share job accepted`,
    submitted.elapsedMs,
    `job ${submitted.jobId} status=${submitted.status}`,
  );

  const trail = new StatusTrail('job');
  const claimed = await awaitEdgeClaim(session.admin, submitted.jobId, trail);
  if (!claimed.ok) {
    reporter.fail(
      `${name}: process-share-jobs claimed the job`,
      claimed.elapsedMs,
      'the job never left "queued" — the pg_net kick and the process-share-jobs-sweep pg_cron backstop both failed to dispatch',
      { jobStatusTrail: trail.trail, lastObservedJob: claimed.last ?? null },
    );
    return { name, ok: false };
  }
  reporter.pass(`${name}: process-share-jobs claimed the job`, claimed.elapsedMs, `status=${claimed.value.status}`);

  const terminal = await awaitJobTerminal(
    session.admin,
    submitted.jobId,
    trail,
    JOB_TERMINAL,
    timeoutFor('terminal'),
  );
  if (!terminal.ok) {
    reporter.fail(
      `${name}: cheap path reached a terminal result`,
      terminal.elapsedMs,
      'the job never reached a terminal status',
      { jobStatusTrail: trail.trail, lastObservedJob: terminal.last ?? null },
    );
    return { name, ok: false };
  }

  const job: JobRow = terminal.value;
  const task = await readTaskForJob(session.admin, submitted.jobId);

  let ok = true;

  // The cost invariant: metadata that already identifies a place must not
  // spend the media worker on it.
  const overspend = assertCheapPathSkippedMedia(task);
  if (overspend) {
    ok = false;
    reporter.fail(`${name}: no media task created`, 0, overspend, { jobId: submitted.jobId });
  } else {
    reporter.pass(
      `${name}: no media task created`,
      0,
      'the metadata path resolved without enqueueing Railway work',
    );
  }

  // A cheap-path share must actually identify a place. Reaching manual fallback
  // here means the deterministic resolver, Google Places, or the
  // GOOGLE_PLACES_KEY is broken on Nearr-Dev.
  const candidates = candidateCount(job);
  const unresolved = assertResolverIdentifiedAPlace(job, candidates);
  if (unresolved) {
    ok = false;
    reporter.fail(
      `${name}: cheap resolver produced a place`,
      0,
      unresolved,
      {
        jobStatusTrail: trail.trail,
        status: job.status,
        failure_reason: job.failure_reason ?? null,
        needs_help_reason: (job as JobRow & { needs_help_reason?: string | null }).needs_help_reason ?? null,
        url: CHEAP_PATH_URL,
      },
    );
  } else {
    reporter.pass(
      `${name}: cheap resolver produced a place`,
      0,
      `status=${job.status} decision=${job.decision} candidates=${candidates} saved_place_id=${job.saved_place_id ?? 'null'}`,
    );
  }

  const persistence = assertTerminalSuccessPersisted(job);
  if (persistence) {
    ok = false;
    reporter.fail(`${name}: terminal result persisted`, 0, persistence, { jobId: submitted.jobId });
  } else {
    reporter.pass(`${name}: terminal result persisted`, 0, `saved_place_id=${job.saved_place_id ?? 'null'}`);
  }

  if (trail.violations.length > 0) {
    ok = false;
    reporter.fail(`${name}: lifecycle transitions`, 0, `${trail.violations.length} illegal transition(s)`, {
      violations: trail.violations,
      jobStatusTrail: trail.trail,
    });
  }

  return { name, ok };
}

// ---------------------------------------------------------------------------
// Fixture B — media-fallback path
// ---------------------------------------------------------------------------

/**
 * An Instagram reel URL that is deterministically unavailable.
 *
 * The shortcode is well-formed but does not exist, so `fetchPostMetadata`
 * cannot return anything at all. That is the exact input to
 * `shouldRunMediaFallbackOnMetadataFailure`, which — with MEDIA_FALLBACK_ENABLED
 * and INSTAGRAM_MEDIA_RESOLVER_ENABLED on — MUST enqueue a media task rather
 * than sending the job straight to needs_help.
 *
 * This is the fixture that would have caught the missing flags: with either
 * flag unset the decision returns { run: false }, no `share_media_tasks` row
 * appears, and the assertion below fails naming the flags.
 *
 * It does not depend on a live post precisely BECAUSE it is unavailable — the
 * behaviour under test is "metadata could not be fetched for a supported
 * platform", which a missing post reproduces permanently and for free.
 */
const FALLBACK_URL =
  process.env.NEARR_E2E_FALLBACK_URL || 'https://www.instagram.com/reel/E2eNearrProbe0/';

export async function fixtureMediaFallback(
  reporter: StageReporter,
  session: E2ESession,
): Promise<FixtureOutcome> {
  const name = 'Fixture B — media fallback dispatch';
  const submitted = await submitShareJob(session, 'media-fallback', FALLBACK_URL);
  if (!submitted.ok) {
    reporter.fail(`${name}: share job accepted`, submitted.elapsedMs, submitted.detail);
    return { name, ok: false };
  }
  reporter.identify({ jobId: submitted.jobId });
  reporter.pass(`${name}: share job accepted`, submitted.elapsedMs, `job ${submitted.jobId}`);

  const trail = new StatusTrail('job');
  const claimed = await awaitEdgeClaim(session.admin, submitted.jobId, trail);
  if (!claimed.ok) {
    reporter.fail(
      `${name}: process-share-jobs claimed the job`,
      claimed.elapsedMs,
      'the job never left "queued"',
      { jobStatusTrail: trail.trail, lastObservedJob: claimed.last ?? null },
    );
    return { name, ok: false };
  }
  reporter.pass(`${name}: process-share-jobs claimed the job`, claimed.elapsedMs, `status=${claimed.value.status}`);

  const taskStarted = Date.now();
  const task = await awaitMediaTask(session.admin, submitted.jobId);
  if (!task) {
    const job = await readJob(session.admin, submitted.jobId);
    reporter.fail(
      `${name}: media fallback selected and a media task created`,
      Date.now() - taskStarted,
      'NO share_media_tasks row was created for a supported-platform share whose metadata could not be fetched. ' +
        'This is what a missing MEDIA_FALLBACK_ENABLED or INSTAGRAM_MEDIA_RESOLVER_ENABLED looks like from the outside: ' +
        'shouldRunMediaFallbackOnMetadataFailure returned { run: false } and the job was sent to needs_help instead of Railway.',
      {
        jobStatusTrail: trail.trail,
        jobStatus: job?.status ?? null,
        decision: job?.decision ?? null,
        failure_reason: job?.failure_reason ?? null,
        url: FALLBACK_URL,
      },
    );
    return { name, ok: false };
  }
  reporter.identify({ taskId: task.id });
  reporter.pass(
    `${name}: media fallback selected and a media task created`,
    Date.now() - taskStarted,
    `share_media_tasks ${task.id} status=${task.status}`,
  );

  // The claim itself is proven exhaustively by the dedicated dispatch check, so
  // this fixture only confirms the real, Edge-created task is also picked up —
  // a task created by the Edge and a task created by the test insert travel the
  // identical trigger, so a divergence here would be a genuine surprise.
  const claimTimeout = timeoutFor('railwayClaim');
  const claimed2 = await (async () => {
    const deadline = Date.now() + claimTimeout;
    for (;;) {
      const row = await readTaskForJob(session.admin, submitted.jobId);
      if (row && row.attempts >= 1 && row.locked_at) return { ok: true as const, row, elapsed: Date.now() - taskStarted };
      if (Date.now() >= deadline) return { ok: false as const, row, elapsed: Date.now() - taskStarted };
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  })();

  if (!claimed2.ok) {
    reporter.fail(
      `${name}: Railway claimed the Edge-created task`,
      claimed2.elapsed,
      `the task sat queued for ${Math.round(claimTimeout / 1000)}s without Railway seeing it`,
      { lastObservedTask: claimed2.row ?? null, workerBaseUrl: session.config.workerBaseUrl },
    );
    return { name, ok: false };
  }
  reporter.pass(
    `${name}: Railway claimed the Edge-created task`,
    claimed2.elapsed,
    `attempts=${claimed2.row.attempts} status=${claimed2.row.status}`,
  );
  return { name, ok: true };
}

// ---------------------------------------------------------------------------
// Fixture D — creator identity must never become place identity
// ---------------------------------------------------------------------------

/**
 * The deterministic form of the observed false auto-save.
 *
 * A creator handle that reads exactly like a business name is submitted as the
 * ONLY explicit evidence for a place, at high confidence, straight into the
 * deployed `finalize_media_task` callback. The handle used here is synthetic
 * name-shaped text, not a real account: the invariant is about the SHAPE of the
 * evidence, and pinning the test to a stranger's account would make it rot.
 *
 * PASS means the deployed auto-save gate refused: no `auto_save`, no
 * `saved_place_id`. Anything the gate does short of saving — needs_help, a
 * confirmation prompt, manual fallback — satisfies the invariant.
 */
const CREATOR_HANDLE = 'olivers_oliveoil_gallery';
const CREATOR_AS_PLACE_NAME = "Oliver's Olive Oil & Balsamic Tasting Gallery";

export async function fixtureCreatorIdentitySafety(
  reporter: StageReporter,
  session: E2ESession,
): Promise<FixtureOutcome> {
  const name = 'Fixture D — creator identity is not place identity';
  const identity = session.identity;
  if (!identity) {
    reporter.fail(`${name}: setup`, 0, 'no ephemeral identity for this run');
    return { name, ok: false };
  }

  const correlationKey = correlationKeyFor(session.correlationId, 'creator-safety');
  const sourceUrl = `https://www.instagram.com/reel/E2eCreatorSafety/?e2e=${session.correlationId}`;

  const { data: jobInsert, error: jobError } = await session.admin
    .from('share_jobs')
    .insert({
      user_id: identity.userId,
      source_url: sourceUrl,
      canonical_url: sourceUrl,
      source_platform: 'instagram',
      status: 'processing_metadata',
      progress_stage: 'checking_video',
      idempotency_key: correlationKey,
      locked_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    .select('id')
    .single();
  if (jobError || !jobInsert) {
    reporter.fail(`${name}: setup`, 0, `could not create the parent job: ${jobError?.message ?? 'unknown'}`);
    return { name, ok: false };
  }
  const jobId = (jobInsert as { id: string }).id;
  session.trackedJobIds.push(jobId);

  const { data: taskInsert, error: taskError } = await session.admin
    .from('share_media_tasks')
    .insert({
      share_job_id: jobId,
      user_id: identity.userId,
      source_url: sourceUrl,
      canonical_url: sourceUrl,
      platform: 'instagram',
      status: 'processing',
      progress_stage: 'verifying_place',
      locked_at: new Date().toISOString(),
      locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 1,
    })
    .select('id')
    .single();
  if (taskError || !taskInsert) {
    reporter.fail(`${name}: setup`, 0, `could not create the media task: ${taskError?.message ?? 'unknown'}`);
    return { name, ok: false };
  }
  const taskId = (taskInsert as { id: string }).id;
  reporter.identify({ jobId, taskId });

  // Creator-name-only evidence: the account handle is the sole explicit
  // evidence, and every other signal is deliberately about something else.
  const evidence = {
    places: [
      {
        name: CREATOR_AS_PLACE_NAME,
        role: 'primary',
        confidence: 0.95,
        identityEvidenceKind: 'observable',
        address: null,
        city: null,
        region: null,
        country: null,
        coordinates: null,
        category: null,
        explicitEvidence: [
          { source: 'caption', timestampSeconds: null, value: `@${CREATOR_HANDLE}` },
        ],
        inferredEvidence: [],
      },
    ],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: ['e2e_creator_identity_probe'],
  };

  const started = Date.now();
  const response = await fetch(`${session.config.supabaseUrl}/functions/v1/process-share-jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.config.mediaFinalizeSecret}`,
    },
    body: JSON.stringify({
      mode: 'finalize_media_task',
      taskId,
      outcome: 'evidence',
      evidence,
      diagnostics: { source: 'nearr-dev-e2e', correlationId: session.correlationId },
    }),
  }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }) as unknown as Response);

  const bodyText = await response.text().catch(() => '');
  if (response.status === 401) {
    reporter.fail(
      `${name}: finalize callback accepted`,
      Date.now() - started,
      'process-share-jobs rejected the MEDIA_FINALIZE_SECRET',
      { status: 401 },
    );
    return { name, ok: false };
  }
  reporter.pass(
    `${name}: finalize callback accepted`,
    Date.now() - started,
    `HTTP ${response.status} ${bodyText.slice(0, 160)}`,
  );

  const job = await readJob(session.admin, jobId);
  const violation = assertNoCreatorNameAutoSave(job);
  if (violation) {
    reporter.fail(
      `${name}: creator handle alone cannot auto-save`,
      0,
      `CURRENT PRODUCT BUG — ${violation}`,
      {
        jobId,
        taskId,
        decision: job?.decision ?? null,
        saved_place_id: job?.saved_place_id ?? null,
        creatorHandle: `@${CREATOR_HANDLE}`,
      },
    );
    return { name, ok: false };
  }
  reporter.pass(
    `${name}: creator handle alone cannot auto-save`,
    0,
    `decision=${job?.decision ?? 'null'} saved_place_id=null — the deployed gate refused name-only creator evidence`,
  );
  return { name, ok: true };
}

// ---------------------------------------------------------------------------
// Fixture E — hard negative
// ---------------------------------------------------------------------------

/**
 * A real, permanently reachable page with no place content whatsoever.
 *
 * example.com is reserved by RFC 2606 for exactly this purpose: it will always
 * resolve, always return the same minimal document, and can never accidentally
 * start describing a restaurant. The invariant is that insufficient evidence
 * produces a SAFE no-answer — never a fabricated exact save.
 */
const HARD_NEGATIVE_URL = process.env.NEARR_E2E_NEGATIVE_URL || 'https://example.com/';

export async function fixtureHardNegative(
  reporter: StageReporter,
  session: E2ESession,
): Promise<FixtureOutcome> {
  const name = 'Fixture E — hard negative';
  const submitted = await submitShareJob(session, 'hard-negative', HARD_NEGATIVE_URL);
  if (!submitted.ok) {
    reporter.fail(`${name}: share job accepted`, submitted.elapsedMs, submitted.detail);
    return { name, ok: false };
  }
  reporter.identify({ jobId: submitted.jobId });

  const trail = new StatusTrail('job');
  const terminal = await awaitJobTerminal(
    session.admin,
    submitted.jobId,
    trail,
    JOB_TERMINAL,
    timeoutFor('terminal'),
  );
  if (!terminal.ok) {
    reporter.fail(
      `${name}: reached a terminal result`,
      terminal.elapsedMs,
      'the job never reached a terminal status',
      { jobStatusTrail: trail.trail, lastObservedJob: terminal.last ?? null },
    );
    return { name, ok: false };
  }

  const job = terminal.value;
  if (job.decision === 'auto_save' || job.saved_place_id) {
    reporter.fail(
      `${name}: no fabricated save`,
      terminal.elapsedMs,
      `a page with no place content produced decision=${job.decision} saved_place_id=${job.saved_place_id}`,
      { jobStatusTrail: trail.trail, url: HARD_NEGATIVE_URL },
    );
    return { name, ok: false };
  }
  reporter.pass(
    `${name}: no fabricated save`,
    terminal.elapsedMs,
    `status=${job.status} decision=${job.decision ?? 'null'} — safe no-answer, nothing persisted`,
  );

  const task = await readTaskForJob(session.admin, submitted.jobId);
  if (task) {
    reporter.warn(
      `${name}: no media task`,
      `a media task (${task.id}) was created for a non-social page with no evidence — unexpected spend`,
    );
  } else {
    reporter.pass(`${name}: no media task`, 0, 'no Railway work was enqueued for an evidence-free page');
  }
  return { name, ok: true };
}
