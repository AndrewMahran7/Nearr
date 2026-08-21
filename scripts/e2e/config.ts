/**
 * scripts/e2e/config.ts
 *
 * Resolve the DEPLOYED development configuration of both services, prove it is
 * development, and expose it in a form that can be asserted on WITHOUT ever
 * revealing a secret value.
 *
 * Two deliberate choices:
 *
 *  1. Configuration is read from the DEPLOYMENTS, not from local .env files.
 *     A local .env proves what this laptop believes; it proves nothing about
 *     what Nearr-Dev is actually running. Both failures this tier exists to
 *     catch were deployed-config failures that every local file was happy with.
 *
 *  2. Secrets are compared as SHA-256 DIGESTS. `supabase secrets list` already
 *     returns the digest of each Edge secret and never the value, so the Edge
 *     side is compared without ever holding its plaintext. Railway values do
 *     arrive in plaintext (the CLI has no digest mode); they are hashed on
 *     arrival, held only where a request genuinely needs them, and never
 *     printed, logged, or placed in a report line.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_DEV_REF,
  RAILWAY_PROJECT_ID,
  EXPECTED_RAILWAY_ENVIRONMENT,
  EXPECTED_RAILWAY_SERVICE,
  TargetRefusedError,
  assertDevelopmentRailway,
  assertDevelopmentSupabaseUrl,
  assertDevelopmentWorkerUrl,
  type RailwayIdentity,
} from './target';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The digest of the literal string "true" — what an enabled flag must hash to. */
export const DIGEST_TRUE = sha256('true');

export type EdgeSecret = { name: string; digest: string; updatedAt: string };

export type DeployedConfig = {
  supabaseRef: string;
  supabaseUrl: string;
  anonKey: string;
  /** Service-role key for the DEV project, sourced from the Railway dev service. */
  serviceRoleKey: string;
  workerBaseUrl: string;
  workerSecret: string;
  mediaFinalizeSecret: string;
  railway: RailwayIdentity;
  /** Every Railway variable, values intact. NEVER print this. */
  railwayVars: Readonly<Record<string, string>>;
  /** Edge secret name -> digest. Safe to print in full. */
  edgeDigests: Readonly<Record<string, string>>;
  edgeSecrets: readonly EdgeSecret[];
};

function runCli(command: string, args: string[], timeoutMs = 120_000): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${command} could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    // stderr can echo the command line but never a value, so it is safe to show.
    throw new Error(
      `${command} ${args[0]} exited ${result.status}: ${(result.stderr || '').trim().slice(0, 400)}`,
    );
  }
  return result.stdout ?? '';
}

/**
 * Railway variables for the DEVELOPMENT media-worker.
 *
 * The environment and service are hard-coded here rather than taken from a
 * flag: a suite that lets the caller choose which Railway environment to read
 * is one typo away from reading production.
 */
export function readRailwayDevelopmentVars(): Record<string, string> {
  const raw = runCli('railway', [
    'variables',
    '--json',
    '--project',
    RAILWAY_PROJECT_ID,
    '--environment',
    EXPECTED_RAILWAY_ENVIRONMENT,
    '--service',
    EXPECTED_RAILWAY_SERVICE,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TargetRefusedError(
      'ABORT — missing target identity\n\n' +
        'railway variables --json did not return JSON, so the deployed development\n' +
        'configuration could not be read. Run `railway login` and retry.',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TargetRefusedError('ABORT — railway variables returned no object.');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
    else if (value != null) out[key] = String(value);
  }
  return out;
}

/**
 * Edge Function secrets for the DEVELOPMENT Supabase project.
 *
 * `supabase secrets list` returns each secret's SHA-256 digest in its `value`
 * field, never the plaintext. That is the whole reason drift can be asserted
 * here at all: `MEDIA_FALLBACK_ENABLED` hashing to sha256("true") proves the
 * flag is on without anyone, including this process, seeing a secret.
 */
export function readEdgeSecrets(projectRef: string): EdgeSecret[] {
  if (projectRef !== EXPECTED_DEV_REF) {
    throw new TargetRefusedError(
      `ABORT — refusing to list Edge secrets for "${projectRef}"; only ${EXPECTED_DEV_REF} is allowed.`,
    );
  }
  const raw = runCli('supabase', ['secrets', 'list', '--project-ref', projectRef, '-o', 'json']);
  // The CLI has returned both a bare array and a { secrets: [...] } envelope
  // across versions; accept either rather than pinning a CLI version.
  const jsonStart = raw.search(/[[{]/);
  if (jsonStart < 0) throw new Error('supabase secrets list returned no JSON payload.');
  const parsed: unknown = JSON.parse(raw.slice(jsonStart));
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { secrets?: unknown }).secrets)
      ? ((parsed as { secrets: unknown[] }).secrets)
      : [];
  return rows
    .map((row) => row as { name?: unknown; value?: unknown; updated_at?: unknown })
    .filter((row) => typeof row.name === 'string' && typeof row.value === 'string')
    .map((row) => ({
      name: String(row.name),
      digest: String(row.value).toLowerCase(),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    }));
}

/**
 * Resolve and PROVE the full deployed development target.
 *
 * Every identity assertion runs before anything is returned, so no caller can
 * hold a client for an unproven project.
 */
export function loadDeployedConfig(): DeployedConfig {
  const railwayVars = readRailwayDevelopmentVars();
  const railway = assertDevelopmentRailway(railwayVars);

  const supabaseUrl = (railwayVars.SUPABASE_URL || '').trim();
  const supabaseRef = assertDevelopmentSupabaseUrl(
    supabaseUrl,
    'the Railway development media-worker SUPABASE_URL',
  );

  // The finalize URL is the worker's route BACK into Supabase. It must land on
  // the same development project, or the two halves of the pipeline are talking
  // to different databases.
  const finalizeUrl = (railwayVars.SHARE_JOBS_FINALIZE_URL || '').trim();
  if (finalizeUrl) {
    assertDevelopmentSupabaseUrl(finalizeUrl, 'the Railway development SHARE_JOBS_FINALIZE_URL');
  }

  const workerBaseUrl = assertDevelopmentWorkerUrl(
    `https://${railway.publicDomain}`,
    railway.publicDomain,
    'the Railway development public domain',
  );

  const anonKey = resolveAnonKey();

  return Object.freeze({
    supabaseRef,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    anonKey,
    serviceRoleKey: (railwayVars.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    workerBaseUrl,
    workerSecret: (railwayVars.SHARE_MEDIA_WORKER_SECRET || '').trim(),
    mediaFinalizeSecret: (railwayVars.MEDIA_FINALIZE_SECRET || '').trim(),
    railway,
    railwayVars: Object.freeze(railwayVars),
    edgeDigests: Object.freeze({}),
    edgeSecrets: [],
  });
}

/** Attach the Edge secret digests. Split out so `--no-supabase-cli` can skip it. */
export function withEdgeSecrets(config: DeployedConfig): DeployedConfig {
  const edgeSecrets = readEdgeSecrets(config.supabaseRef);
  const edgeDigests: Record<string, string> = {};
  for (const secret of edgeSecrets) edgeDigests[secret.name] = secret.digest;
  return Object.freeze({ ...config, edgeSecrets, edgeDigests: Object.freeze(edgeDigests) });
}

/**
 * The anon key, needed to sign the ephemeral test identity in.
 *
 * Taken from the Supabase CLI's project API listing when available so the suite
 * needs no local file at all, falling back to the development .env.local that
 * every Nearr developer already has. It is a PUBLIC key by design (it ships in
 * the mobile bundle), so neither source is a secret-handling concern; it is
 * still never printed, for consistency.
 */
function resolveAnonKey(): string {
  const fromEnv = (process.env.NEARR_E2E_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const fromFile = readLocalEnvValue('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (fromFile) return fromFile;
  return '';
}

function readLocalEnvValue(name: string): string {
  // Deliberately minimal, and deliberately NOT a general .env loader: the suite
  // must not be able to pick up a stray SUPABASE_URL from a file and start
  // trusting it. Only this one public key is ever read from disk.
  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const file of ['.env.local', '.env']) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0 || trimmed.slice(0, eq).trim() !== name) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return '';
}

/** Safe rendering of a secret's state. Never the value, never its length. */
export function presence(value: string | undefined | null): 'present' | 'absent' {
  return value && value.trim() ? 'present' : 'absent';
}
