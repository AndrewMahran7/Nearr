/**
 * scripts/e2e/checks/readiness.ts
 *
 * Deployed development readiness (Parts 2 and 6).
 *
 * Answers one question: is Nearr-Dev, RIGHT NOW, configured and reachable such
 * that a share can travel the whole media path? It runs before any pipeline
 * fixture, because a pipeline failure caused by a missing flag should be
 * reported as a missing flag, not as a mysterious timeout forty seconds later.
 *
 * Cost: free. Everything here is a config read, an unauthenticated health
 * probe, or an auth probe that is deliberately shaped to be rejected before any
 * work is done.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateContract, requiredFindings, advisoryFindings } from '../contract';
import { sha256, presence, type DeployedConfig } from '../config';
import { StageReporter } from '../report';

export type ReadinessOptions = {
  /** Skip the two probes that need the public internet (used by --offline diagnosis). */
  skipNetwork?: boolean;
  /**
   * A client built from the Railway worker's service-role key. When present,
   * readiness PROVES that credential still works against Nearr-Dev rather than
   * only comparing digests — see CROSS_SERVICE_ADVISORY in ../contract.ts for
   * why digest equality is the wrong test for this particular key.
   */
  admin?: SupabaseClient;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text().catch(() => '');
    return { status: response.status, body: body.slice(0, 2_000) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runReadiness(
  reporter: StageReporter,
  config: DeployedConfig,
  options: ReadinessOptions = {},
): Promise<boolean> {
  let ok = true;

  // ---- Supabase identity --------------------------------------------------
  // loadDeployedConfig() has already REFUSED anything that is not Nearr-Dev, so
  // reaching this line is itself the proof. It is reported as a stage anyway so
  // the checklist states which project the rest of the run touched.
  reporter.pass(
    'Supabase identity',
    0,
    `project ref ${config.supabaseRef} (Nearr-Dev), proven from the Railway development worker's SUPABASE_URL`,
  );
  reporter.pass(
    'Railway identity',
    0,
    `project ${config.railway.projectId} / environment ${config.railway.environment} / service ${config.railway.service}`,
  );

  // ---- Configuration contract --------------------------------------------
  const started = Date.now();
  const findings = evaluateContract({
    edgeDigests: config.edgeDigests,
    workerVars: config.railwayVars,
    hash: sha256,
  });
  const required = requiredFindings(findings);
  const advisory = advisoryFindings(findings);

  if (required.length === 0) {
    reporter.pass(
      'Edge + worker configuration contract',
      Date.now() - started,
      `${Object.keys(config.edgeDigests).length} Edge secrets and ${Object.keys(config.railwayVars).length} Railway variables satisfy the development contract`,
    );
  } else {
    ok = false;
    reporter.fail(
      'Edge + worker configuration contract',
      Date.now() - started,
      `${required.length} required configuration problem(s)`,
      Object.fromEntries(required.map((f) => [f.id, f.message])),
    );
    for (const finding of required) console.log(`       fix: ${finding.remedy}`);
  }
  for (const finding of advisory) {
    reporter.warn(`config drift: ${finding.id}`, finding.message);
  }

  // ---- Cross-service auth material ---------------------------------------
  const secretsPresent =
    presence(config.workerSecret) === 'present' && presence(config.mediaFinalizeSecret) === 'present';
  if (secretsPresent) {
    reporter.pass(
      'worker + finalize secrets present on both sides',
      0,
      'SHARE_MEDIA_WORKER_SECRET and MEDIA_FINALIZE_SECRET are both set on Railway (whether they MATCH the Edge copies is asserted by the configuration contract above)',
    );
  } else {
    ok = false;
    reporter.fail('worker + finalize secrets present on both sides', 0, 'a required cross-service secret is absent', {
      SHARE_MEDIA_WORKER_SECRET: presence(config.workerSecret),
      MEDIA_FINALIZE_SECRET: presence(config.mediaFinalizeSecret),
    });
  }

  // ---- The worker's service-role credential actually works ----------------
  // share_media_tasks is RLS-enabled with NO policies and revoked from anon and
  // authenticated, so reading it at all is only possible with a valid
  // service-role key for THIS project. A successful read is therefore proof of
  // both authentication and project identity in one request.
  if (options.admin) {
    const credentialStarted = Date.now();
    const { error } = await options.admin.from('share_media_tasks').select('id').limit(1);
    if (error) {
      ok = false;
      reporter.fail(
        "Railway worker's Supabase credential",
        Date.now() - credentialStarted,
        `the service-role key held by the Railway development worker cannot read share_media_tasks on ${config.supabaseRef}: ${error.message}`,
      );
    } else {
      reporter.pass(
        "Railway worker's Supabase credential",
        Date.now() - credentialStarted,
        `authenticates against ${config.supabaseRef} and can read the service-role-only media queue`,
      );
    }
  }

  if (options.skipNetwork) {
    reporter.skip('Railway worker health', '--offline: network probes skipped');
    reporter.skip('Railway worker readiness', '--offline: network probes skipped');
    reporter.skip('Railway worker invocation auth', '--offline: network probes skipped');
    reporter.skip('Edge finalize-callback auth', '--offline: network probes skipped');
    return ok;
  }

  // ---- Railway health -----------------------------------------------------
  const healthStarted = Date.now();
  const health = await fetchWithTimeout(`${config.workerBaseUrl}/health`, { method: 'GET' }, 20_000);
  if ('error' in health) {
    ok = false;
    reporter.fail('Railway worker health', Date.now() - healthStarted, `GET /health failed: ${health.error}`, {
      workerBaseUrl: config.workerBaseUrl,
    });
  } else if (health.status !== 200) {
    ok = false;
    reporter.fail('Railway worker health', Date.now() - healthStarted, `GET /health returned ${health.status}`, {
      workerBaseUrl: config.workerBaseUrl,
      body: health.body,
    });
  } else {
    reporter.pass('Railway worker health', Date.now() - healthStarted, `${config.workerBaseUrl}/health -> 200`);
  }

  // ---- Railway readiness (config + ffmpeg/ffprobe/yt-dlp + Supabase) -------
  const readyStarted = Date.now();
  const ready = await fetchWithTimeout(`${config.workerBaseUrl}/ready`, { method: 'GET' }, 30_000);
  if ('error' in ready) {
    ok = false;
    reporter.fail('Railway worker readiness', Date.now() - readyStarted, `GET /ready failed: ${ready.error}`);
  } else {
    let checks: Record<string, unknown> = {};
    let missing: unknown[] = [];
    try {
      const parsed = JSON.parse(ready.body) as { checks?: Record<string, unknown>; missingConfig?: unknown[] };
      checks = parsed.checks ?? {};
      missing = Array.isArray(parsed.missingConfig) ? parsed.missingConfig : [];
    } catch {
      /* reported below via status */
    }
    if (ready.status === 200) {
      reporter.pass(
        'Railway worker readiness',
        Date.now() - readyStarted,
        `config+ffmpeg+ffprobe+ytdlp+supabase all ready (deployment is live and can reach ${config.supabaseRef})`,
      );
    } else {
      ok = false;
      reporter.fail(
        'Railway worker readiness',
        Date.now() - readyStarted,
        `GET /ready returned ${ready.status}`,
        { checks, missingConfig: missing },
      );
    }
  }

  // ---- Worker invocation auth --------------------------------------------
  // The exact request shape the database's pg_net kick makes. A 200 proves the
  // worker accepts this secret and its claim loop runs; the deliberately wrong
  // secret proves the endpoint is not simply open.
  const authStarted = Date.now();
  const authorized = await fetchWithTimeout(
    `${config.workerBaseUrl}/v1/process-media-tasks`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.workerSecret}` },
      body: JSON.stringify({ trigger: 'e2e_readiness', limit: 0 }),
    },
    60_000,
  );
  const rejected = await fetchWithTimeout(
    `${config.workerBaseUrl}/v1/process-media-tasks`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-the-worker-secret' },
      body: JSON.stringify({ trigger: 'e2e_readiness_negative' }),
    },
    30_000,
  );
  if ('error' in authorized || 'error' in rejected) {
    ok = false;
    reporter.fail('Railway worker invocation auth', Date.now() - authStarted, 'the invocation endpoint was unreachable', {
      authorized: 'error' in authorized ? authorized.error : authorized.status,
      rejected: 'error' in rejected ? rejected.error : rejected.status,
    });
  } else if (authorized.status !== 200) {
    ok = false;
    reporter.fail(
      'Railway worker invocation auth',
      Date.now() - authStarted,
      `POST /v1/process-media-tasks with the configured worker secret returned ${authorized.status}, expected 200`,
      { status: authorized.status, body: authorized.body },
    );
  } else if (rejected.status !== 401) {
    ok = false;
    reporter.fail(
      'Railway worker invocation auth',
      Date.now() - authStarted,
      `POST /v1/process-media-tasks with a WRONG secret returned ${rejected.status}, expected 401 — the endpoint is not fail-closed`,
      { status: rejected.status },
    );
  } else {
    reporter.pass(
      'Railway worker invocation auth',
      Date.now() - authStarted,
      'configured secret accepted (200), wrong secret refused (401)',
    );
  }

  // ---- Edge finalize-callback auth ---------------------------------------
  // The route the worker takes BACK into Supabase. Sent without a taskId on
  // purpose: a 400 means the secret was accepted and the handler was entered,
  // and no row is touched. A 401 means the two sides disagree about the
  // MEDIA_FINALIZE_SECRET, which strands every finished media task.
  const finalizeUrl = `${config.supabaseUrl}/functions/v1/process-share-jobs`;
  const finalizeStarted = Date.now();
  const finalizeAuthorized = await fetchWithTimeout(
    finalizeUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.mediaFinalizeSecret}` },
      body: JSON.stringify({ mode: 'finalize_media_task' }),
    },
    30_000,
  );
  const finalizeRejected = await fetchWithTimeout(
    finalizeUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-the-finalize-secret' },
      body: JSON.stringify({ mode: 'finalize_media_task' }),
    },
    30_000,
  );
  if ('error' in finalizeAuthorized || 'error' in finalizeRejected) {
    ok = false;
    reporter.fail('Edge finalize-callback auth', Date.now() - finalizeStarted, 'process-share-jobs was unreachable', {
      authorized: 'error' in finalizeAuthorized ? finalizeAuthorized.error : finalizeAuthorized.status,
    });
  } else if (finalizeAuthorized.status === 401) {
    ok = false;
    reporter.fail(
      'Edge finalize-callback auth',
      Date.now() - finalizeStarted,
      'process-share-jobs REJECTED the MEDIA_FINALIZE_SECRET the Railway worker holds — every completed media task will strand its parent job',
      { status: 401, finalizeUrl },
    );
  } else if (finalizeRejected.status !== 401) {
    ok = false;
    reporter.fail(
      'Edge finalize-callback auth',
      Date.now() - finalizeStarted,
      `process-share-jobs accepted a WRONG finalize secret (${finalizeRejected.status}), expected 401`,
      { status: finalizeRejected.status },
    );
  } else {
    reporter.pass(
      'Edge finalize-callback auth',
      Date.now() - finalizeStarted,
      `worker's finalize secret accepted (${finalizeAuthorized.status} without a taskId), wrong secret refused (401)`,
    );
  }

  return ok;
}
