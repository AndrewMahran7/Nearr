/**
 * scripts/e2e/contract.ts
 *
 * THE DEVELOPMENT CONFIGURATION CONTRACT (Part 6).
 *
 * A pure declaration of what Nearr-Dev must look like for the media / Vayrin
 * path to work end to end, plus a pure evaluator. Pure on purpose: the offline
 * harness test feeds it a synthetic "flag missing" snapshot and proves the
 * contract fails, so the check that guards the deployment is itself guarded.
 *
 * Every entry below was read off the code that consumes it, not invented:
 *   Edge    supabase/functions/process-share-jobs/index.ts readMediaFlags()
 *           supabase/functions/process-share-link/env.ts
 *   Worker  services/media-worker/src/config/env.ts loadConfig()/validateConfig()
 *
 * SECRET DISCIPLINE. A value is only ever handled in one of three ways:
 *   present/absent      — for anything whose content does not matter here;
 *   digest equality     — for anything two services must agree on;
 *   digest == sha256("true") — for a boolean flag, which proves a flag is ON
 *                         without the checker ever seeing a value.
 * No raw value is returned, formatted, or logged by anything in this file.
 */

export type Severity = 'required' | 'advisory';

export type ContractFinding = {
  id: string;
  severity: Severity;
  message: string;
  /** What to do about it, in one line. */
  remedy: string;
};

/** A digest-only view of the Edge Function secrets, as `supabase secrets list` gives it. */
export type EdgeSnapshot = Readonly<Record<string, string>>;
/** Railway variables. Values are present but this module only ever hashes them. */
export type WorkerSnapshot = Readonly<Record<string, string>>;

export type ContractInput = {
  edgeDigests: EdgeSnapshot;
  workerVars: WorkerSnapshot;
  /** sha256 of a value, injected so this module has no crypto dependency. */
  hash: (value: string) => string;
};

/**
 * Flags that MUST be literally "true" on the Supabase Edge side.
 *
 * This testing branch requires Instagram plus TikTok/Facebook parity end to
 * end. If a platform flag is unset, no media task is created for that source.
 */
export const EDGE_REQUIRED_TRUE = [
  'MEDIA_FALLBACK_ENABLED',
  'INSTAGRAM_MEDIA_RESOLVER_ENABLED',
  'TIKTOK_MEDIA_RESOLVER_ENABLED',
  'FACEBOOK_MEDIA_RESOLVER_ENABLED',
] as const;

/** Edge secrets that must merely EXIST for the pipeline to function. */
export const EDGE_REQUIRED_PRESENT = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_PLACES_KEY', // the deterministic resolver's only place source
  'GEMINI_API_KEY', // caption/evidence extraction
  'SHARE_JOBS_WORKER_SECRET', // pg_net -> process-share-jobs sweep auth
  'MEDIA_FINALIZE_SECRET', // media worker -> process-share-jobs callback auth
  'SHARE_MEDIA_WORKER_SECRET', // the value the DB must present to Railway
] as const;

/** Flags that MUST be literally "true" on the Railway worker. */
export const WORKER_REQUIRED_TRUE = [
  'MEDIA_FALLBACK_ENABLED',
  'INSTAGRAM_MEDIA_RESOLVER_ENABLED',
  'TIKTOK_MEDIA_RESOLVER_ENABLED',
  'FACEBOOK_MEDIA_RESOLVER_ENABLED',
  'VAYRIN_VISUAL_GEOLOCATION_ENABLED',
] as const;

/** Railway variables that must exist (validateConfig() refuses to be ready without them). */
export const WORKER_REQUIRED_PRESENT = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SHARE_MEDIA_WORKER_SECRET',
  'MEDIA_FINALIZE_SECRET',
  'SHARE_JOBS_FINALIZE_URL',
  'GEMINI_API_KEY',
  'MEDIA_TRANSCRIPTION_API_KEY',
] as const;

/** Railway variables that must hold an exact non-secret value. */
export const WORKER_REQUIRED_EXACT: Readonly<Record<string, string>> = {
  MEDIA_ANALYSIS_PROVIDER: 'gemini',
  MEDIA_TRANSCRIPTION_PROVIDER: 'openai',
};

/**
 * Values BOTH services must hold identically, compared by digest.
 *
 * A mismatch here is invisible from either side alone and is exactly the shape
 * of "the task was enqueued and Railway never saw it": the database presents
 * one worker secret, the container expects another, every dispatch 401s, and
 * the pg_net call swallows the failure by design.
 */
export const CROSS_SERVICE_MATCHED = [
  'SHARE_MEDIA_WORKER_SECRET',
  'MEDIA_FINALIZE_SECRET',
  'SUPABASE_URL',
] as const;

/**
 * Values the two sides MAY legitimately differ on, reported but not failed.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is deliberately NOT in the required list above.
 * The Edge runtime AUTO-INJECTS its own copy — .env.example says in so many
 * words not to set it by hand — and Supabase re-issues it during platform key
 * migrations, so the Edge digest legitimately drifts from the copy pasted into
 * Railway even while both credentials are valid for the same project. Requiring
 * equality would report a healthy deployment as broken, which is the fastest
 * way to teach someone to ignore this suite.
 *
 * What matters instead is checked two other ways, both of them stronger: the
 * SUPABASE_URL digests must match (same project), and Railway's copy must
 * actually authenticate against Nearr-Dev, which every run proves empirically
 * by reading service-role-only tables with it.
 *
 * The advisory still fires, because a Railway copy that has drifted from the
 * platform's current key is a rotation waiting to strand the worker.
 */
export const CROSS_SERVICE_ADVISORY = ['SUPABASE_SERVICE_ROLE_KEY'] as const;

/**
 * Resolver flags whose two sides should agree.
 *
 * TikTok and Facebook are required on this dedicated phone-testing branch.
 * Other optional platforms remain advisory: a platform enabled on the worker
 * but not on the Edge is not broken, it is simply never
 * reached — the Edge never enqueues for it. That is worth saying out loud on
 * every run without failing a deployment that may have chosen it deliberately.
 */
export const PARITY_FLAGS = [
  'MEDIA_FALLBACK_ENABLED',
  'INSTAGRAM_MEDIA_RESOLVER_ENABLED',
  'TIKTOK_MEDIA_RESOLVER_ENABLED',
  'YOUTUBE_MEDIA_RESOLVER_ENABLED',
  'FACEBOOK_MEDIA_RESOLVER_ENABLED',
  'SNAPCHAT_MEDIA_RESOLVER_ENABLED',
] as const;

const REQUIRED_PARITY: ReadonlySet<string> = new Set([
  'MEDIA_FALLBACK_ENABLED',
  'INSTAGRAM_MEDIA_RESOLVER_ENABLED',
  'TIKTOK_MEDIA_RESOLVER_ENABLED',
  'FACEBOOK_MEDIA_RESOLVER_ENABLED',
]);

export function evaluateContract(input: ContractInput): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const { edgeDigests, workerVars, hash } = input;
  const digestTrue = hash('true');

  // ---- Edge flags ---------------------------------------------------------
  for (const flag of EDGE_REQUIRED_TRUE) {
    const digest = edgeDigests[flag];
    if (!digest) {
      findings.push({
        id: `edge.flag.${flag}.missing`,
        severity: 'required',
        message: `Edge secret ${flag} is NOT SET on Nearr-Dev. process-share-jobs reads it as false, so media fallback is never enqueued.`,
        remedy: `supabase secrets set ${flag}=true --project-ref <dev-ref>`,
      });
      continue;
    }
    if (digest !== digestTrue) {
      findings.push({
        id: `edge.flag.${flag}.not_true`,
        severity: 'required',
        message: `Edge secret ${flag} is set but its value is not the literal string "true" (digest mismatch), so the flag reads as OFF.`,
        remedy: `supabase secrets set ${flag}=true --project-ref <dev-ref>`,
      });
    }
  }

  // ---- Edge presence ------------------------------------------------------
  for (const name of EDGE_REQUIRED_PRESENT) {
    if (!edgeDigests[name]) {
      findings.push({
        id: `edge.secret.${name}.absent`,
        severity: 'required',
        message: `Edge secret ${name} is absent on Nearr-Dev.`,
        remedy: `supabase secrets set ${name}=<value> --project-ref <dev-ref>`,
      });
    }
  }

  // ---- Worker flags -------------------------------------------------------
  for (const flag of WORKER_REQUIRED_TRUE) {
    const raw = (workerVars[flag] ?? '').trim();
    if (!raw) {
      findings.push({
        id: `worker.flag.${flag}.missing`,
        severity: 'required',
        message: `Railway development variable ${flag} is NOT SET. The worker defaults it to false.`,
        remedy: `railway variables --set ${flag}=true --environment development --service media-worker`,
      });
      continue;
    }
    if (raw.toLowerCase() !== 'true') {
      findings.push({
        id: `worker.flag.${flag}.not_true`,
        severity: 'required',
        message: `Railway development variable ${flag} does not read as true.`,
        remedy: `railway variables --set ${flag}=true --environment development --service media-worker`,
      });
    }
  }

  // ---- Worker presence + exact values -------------------------------------
  for (const name of WORKER_REQUIRED_PRESENT) {
    if (!(workerVars[name] ?? '').trim()) {
      findings.push({
        id: `worker.var.${name}.absent`,
        severity: 'required',
        message: `Railway development variable ${name} is absent; the worker cannot report ready without it.`,
        remedy: `railway variables --set ${name}=<value> --environment development --service media-worker`,
      });
    }
  }
  for (const [name, expected] of Object.entries(WORKER_REQUIRED_EXACT)) {
    const raw = (workerVars[name] ?? '').trim().toLowerCase();
    if (raw !== expected) {
      findings.push({
        id: `worker.var.${name}.unexpected`,
        severity: 'required',
        message: `Railway development variable ${name} is "${raw || '(unset)'}", expected "${expected}".`,
        remedy: `railway variables --set ${name}=${expected} --environment development --service media-worker`,
      });
    }
  }

  // ---- Cross-service digest equality --------------------------------------
  for (const name of CROSS_SERVICE_MATCHED) {
    const edgeDigest = edgeDigests[name];
    const workerValue = (workerVars[name] ?? '').trim();
    if (!edgeDigest || !workerValue) continue; // already reported as absent above
    if (hash(workerValue) !== edgeDigest) {
      findings.push({
        id: `cross.${name}.mismatch`,
        severity: 'required',
        message: `${name} DIFFERS between the Supabase Edge secrets and the Railway development worker (SHA-256 digests do not match).`,
        remedy: `Re-set ${name} on both sides from one source of truth. Values are never printed; only digests are compared.`,
      });
    }
  }

  for (const name of CROSS_SERVICE_ADVISORY) {
    const edgeDigest = edgeDigests[name];
    const workerValue = (workerVars[name] ?? '').trim();
    if (!edgeDigest || !workerValue) continue;
    if (hash(workerValue) !== edgeDigest) {
      findings.push({
        id: `cross.${name}.drift`,
        severity: 'advisory',
        message: `${name} differs between the Edge secrets and Railway. That is EXPECTED when the Edge copy is platform-injected, and only matters if Railway's manually pinned copy has gone stale — this run proves it still authenticates, so nothing is broken today.`,
        remedy: `No action needed unless the worker starts failing to reach Supabase. If it does, re-copy the current service-role key into Railway.`,
      });
    }
  }

  // ---- Flag parity --------------------------------------------------------
  for (const flag of PARITY_FLAGS) {
    const edgeDigest = edgeDigests[flag];
    const edgeOn = edgeDigest ? edgeDigest === digestTrue : false;
    const workerOn = (workerVars[flag] ?? '').trim().toLowerCase() === 'true';
    if (edgeOn === workerOn) continue;
    const required = REQUIRED_PARITY.has(flag);
    findings.push({
      id: `parity.${flag}`,
      severity: required ? 'required' : 'advisory',
      message: workerOn
        ? `${flag} is ON for the Railway worker but OFF/unset on the Supabase Edge. The Edge decides whether to enqueue, so this platform never reaches the worker at all.`
        : `${flag} is ON for the Supabase Edge but OFF/unset on the Railway worker. Tasks will be enqueued and then fail at media retrieval.`,
      remedy: `Set ${flag} to the same value on both the Edge secrets and the Railway development service.`,
    });
  }

  return findings;
}

export function requiredFindings(findings: readonly ContractFinding[]): ContractFinding[] {
  return findings.filter((f) => f.severity === 'required');
}

export function advisoryFindings(findings: readonly ContractFinding[]): ContractFinding[] {
  return findings.filter((f) => f.severity === 'advisory');
}
