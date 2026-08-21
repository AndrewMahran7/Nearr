/**
 * scripts/e2e/session.ts
 *
 * The run session: correlation identity, proven-development Supabase clients,
 * an EPHEMERAL test user, and cleanup.
 *
 * IDENTITY (Part 10). No personal credentials are ever involved. Each run
 * creates a fresh confirmed user in Nearr-Dev via the admin API with a random
 * password that exists only in this process's memory for the length of the run,
 * signs it in through the public anon key, and deletes it at the end. Nothing
 * is stored, nothing is reused between runs, and no human account can be
 * touched by a bug in a fixture.
 *
 * CORRELATION (Part 8). No new production column was invented for this. The
 * suite reuses `share_jobs.idempotency_key`, which the client already populates
 * from `clientRequestId`, so a correlation id is searchable in the database and
 * in Edge logs with no runtime change at all. The same id is embedded in the
 * ephemeral user's email, which makes every row the run created reachable from
 * one string.
 *
 * CLEANUP (Part 9). Deleting the user cascades away its share jobs, media
 * tasks, saved places, push tokens and place results. The append-only
 * diagnostics tables intentionally use ON DELETE SET NULL, so those rows are
 * deleted explicitly, by job id, before the user goes.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadDeployedConfig, withEdgeSecrets, type DeployedConfig } from './config';
import { assertDevelopmentSupabaseUrl } from './target';

/** Prefix on every artefact this suite creates. Also the cleanup selector. */
export const E2E_PREFIX = 'nearr-e2e';
/** Email domain reserved by RFC 6761 semantics for names that must never resolve. */
export const E2E_EMAIL_DOMAIN = 'nearr.invalid';

export type EphemeralIdentity = {
  userId: string;
  email: string;
  accessToken: string;
};

export type E2ESession = {
  correlationId: string;
  config: DeployedConfig;
  admin: SupabaseClient;
  identity: EphemeralIdentity | null;
  /** Job ids created by this run, so diagnostics rows can be cleaned by id. */
  trackedJobIds: string[];
  cleanup: () => Promise<CleanupReport>;
};

export type CleanupReport = {
  attempted: boolean;
  userDeleted: boolean;
  diagnosticsDeleted: number;
  retained: string[];
  errors: string[];
};

export function newCorrelationId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${E2E_PREFIX}-${stamp}-${randomBytes(4).toString('hex')}`;
}

/** The clientRequestId a fixture submits. Lands in share_jobs.idempotency_key. */
export function correlationKeyFor(correlationId: string, fixture: string): string {
  return `${correlationId}:${fixture}`;
}

/**
 * Build the session.
 *
 * `loadDeployedConfig()` has already refused anything that is not Nearr-Dev, but
 * the URL is asserted a second time immediately before the admin client is
 * constructed. That is not redundancy for its own sake: the client is the object
 * that can actually write, so the assertion sits directly against the write.
 */
export async function openSession(options: {
  withIdentity: boolean;
  withEdgeSecrets?: boolean;
}): Promise<E2ESession> {
  const base = loadDeployedConfig();
  const config = options.withEdgeSecrets === false ? base : withEdgeSecrets(base);

  assertDevelopmentSupabaseUrl(config.supabaseUrl, 'the resolved E2E session target');
  if (!config.serviceRoleKey) {
    throw new Error(
      'The Railway development media-worker has no SUPABASE_SERVICE_ROLE_KEY, so the E2E ' +
        'suite cannot observe share_jobs / share_media_tasks (both are service-role only).',
    );
  }

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const correlationId = newCorrelationId();
  const trackedJobIds: string[] = [];
  let identity: EphemeralIdentity | null = null;

  if (options.withIdentity) {
    identity = await createEphemeralIdentity(admin, config, correlationId);
  }

  const session: E2ESession = {
    correlationId,
    config,
    admin,
    identity,
    trackedJobIds,
    cleanup: () => cleanupSession(admin, identity, trackedJobIds),
  };
  return session;
}

async function createEphemeralIdentity(
  admin: SupabaseClient,
  config: DeployedConfig,
  correlationId: string,
): Promise<EphemeralIdentity> {
  if (!config.anonKey) {
    throw new Error(
      'No Supabase anon key available to sign the ephemeral E2E identity in. Set ' +
        'NEARR_E2E_SUPABASE_ANON_KEY, or keep EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    );
  }
  // High-entropy, single-use, never persisted and never printed.
  const password = `Nz!${randomUUID()}${randomBytes(6).toString('hex')}`;
  const email = `${correlationId}@${E2E_EMAIL_DOMAIN}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: 'nearr_dev_e2e_regression', correlationId },
  });
  if (createError || !created?.user) {
    throw new Error(`Could not create the ephemeral E2E identity: ${createError?.message ?? 'unknown'}`);
  }

  const anon = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn?.session) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw new Error(`Could not sign the ephemeral E2E identity in: ${signInError?.message ?? 'unknown'}`);
  }

  return { userId: created.user.id, email, accessToken: signedIn.session.access_token };
}

/**
 * Remove everything this run created.
 *
 * Scoped three ways so it can never reach an unrelated row: it only ever
 * addresses the ephemeral user id this process created, only ever the job ids
 * this process recorded, and it runs against a project already proven to be
 * Nearr-Dev. Idempotent — a second call finds nothing and reports nothing.
 */
export async function cleanupSession(
  admin: SupabaseClient,
  identity: EphemeralIdentity | null,
  jobIds: string[],
): Promise<CleanupReport> {
  const report: CleanupReport = {
    attempted: true,
    userDeleted: false,
    diagnosticsDeleted: 0,
    retained: [],
    errors: [],
  };
  if (!identity) {
    report.attempted = false;
    return report;
  }

  if (process.env.NEARR_E2E_KEEP_ROWS === '1') {
    report.attempted = false;
    report.retained.push(
      `NEARR_E2E_KEEP_ROWS=1 — user ${identity.email} and ${jobIds.length} job(s) left in Nearr-Dev for inspection. ` +
        'Delete the user in the Supabase dashboard to cascade them away.',
    );
    return report;
  }

  // Append-only diagnostics use ON DELETE SET NULL, so a user delete would
  // orphan rather than remove them. Delete by the ids this run owns first.
  for (const table of ['share_media_runs', 'share_agent_runs', 'share_extraction_failures'] as const) {
    if (jobIds.length === 0) break;
    const { data, error } = await admin
      .from(table)
      .delete()
      .in('share_job_id', jobIds)
      .select('id');
    if (error) {
      // A table without a share_job_id column simply has nothing this run owns.
      if (!/column .* does not exist/i.test(error.message)) {
        report.errors.push(`${table}: ${error.message}`);
        report.retained.push(`${table} rows for jobs ${jobIds.join(', ')}`);
      }
      continue;
    }
    report.diagnosticsDeleted += Array.isArray(data) ? data.length : 0;
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(identity.userId);
  if (deleteError) {
    report.errors.push(`auth user: ${deleteError.message}`);
    report.retained.push(
      `auth user ${identity.email} (${identity.userId}) and everything cascading from it`,
    );
  } else {
    report.userDeleted = true;
  }
  return report;
}
