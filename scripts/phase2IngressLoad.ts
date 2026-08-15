/**
 * Isolated hosted ingress/load probe for create-share-job.
 *
 * Every request has a unique idempotency key and public, inert example.com
 * URL. The temporary confirmed user is deleted after all accepted jobs reach
 * a terminal state, cascading every test row without touching real users.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LEVELS = [1, 5, 10, 25, 50, 100] as const;
const TERMINAL = new Set(['completed', 'needs_help', 'failed', 'cancelled']);
const POLL_MS = 1_000;
const TERMINAL_TIMEOUT_MS = 10 * 60_000;

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

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createIsolatedUser(admin: SupabaseClient, url: string, anonKey: string) {
  const email = `phase2-ingress-${randomUUID()}@nearr.invalid`;
  const password = `N!${randomUUID()}a8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: 'phase2_ingress_load_probe' },
  });
  if (error || !data.user) throw new Error(`Could not create isolated user: ${error?.message}`);
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Could not sign in isolated user: ${signedIn.error?.message}`);
  }
  return { userId: data.user.id, accessToken: signedIn.data.session.access_token };
}

async function submit(endpoint: string, accessToken: string, level: number, index: number) {
  const requestId = `phase2-ingress-${level}-${index}-${randomUUID()}`;
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: `https://example.com/nearr-phase2-ingress/${level}/${index}/${randomUUID()}`,
        clientRequestId: requestId,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      requestId,
      ok: response.ok && typeof body.jobId === 'string',
      status: response.status,
      jobId: typeof body.jobId === 'string' ? body.jobId : null,
      duplicate: body.duplicate === true,
      reason: typeof body.error === 'string' ? body.error : null,
      acknowledgementMs: Date.now() - started,
    };
  } catch (error) {
    return {
      requestId,
      ok: false,
      status: null,
      jobId: null,
      duplicate: false,
      reason: error instanceof Error ? error.name : String(error),
      acknowledgementMs: Date.now() - started,
    };
  }
}

async function waitForPersistence(admin: SupabaseClient, userId: string, jobIds: string[]) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await admin.from('share_jobs').select('id').eq('user_id', userId).in('id', jobIds);
    if (result.error) throw new Error(`Persistence probe failed: ${result.error.message}`);
    if ((result.data ?? []).length === jobIds.length) return result.data ?? [];
    await sleep(250);
  }
  const result = await admin.from('share_jobs').select('id').eq('user_id', userId).in('id', jobIds);
  if (result.error) throw new Error(`Persistence probe failed: ${result.error.message}`);
  return result.data ?? [];
}

async function waitForTerminal(admin: SupabaseClient, userId: string, jobIds: string[]) {
  const deadline = Date.now() + TERMINAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await admin.from('share_jobs').select('id,status').eq('user_id', userId).in('id', jobIds);
    if (result.error) throw new Error(`Terminal probe failed: ${result.error.message}`);
    const rows = result.data ?? [];
    if (rows.length === jobIds.length && rows.every((row) => TERMINAL.has(row.status))) return rows;
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${jobIds.length} accepted jobs to become terminal`);
}

async function main(): Promise<void> {
  loadDotEnv();
  assert.ok(process.argv.includes('--execute'), 'Refusing hosted ingress test without explicit --execute');
  const supabaseUrl = required('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = required('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/create-share-job`;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const isolated = await createIsolatedUser(admin, supabaseUrl, anonKey);
  const results = [];
  try {
    for (const level of LEVELS) {
      const started = Date.now();
      const responses = await Promise.all(Array.from({ length: level }, (_, index) => submit(endpoint, isolated.accessToken, level, index)));
      const accepted = responses.filter((response) => response.ok && response.jobId);
      const ids = accepted.map((response) => response.jobId as string);
      const persisted = ids.length ? await waitForPersistence(admin, isolated.userId, ids) : [];
      const terminalStarted = Date.now();
      const terminal = ids.length ? await waitForTerminal(admin, isolated.userId, ids) : [];
      const acknowledgement = responses.map((response) => response.acknowledgementMs);
      const statusCounts = responses.reduce<Record<string, number>>((counts, response) => {
        const key = response.status === null ? response.reason ?? 'transport_error' : String(response.status);
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});
      results.push({
        level,
        attempted: responses.length,
        accepted: accepted.length,
        rejected: responses.length - accepted.length,
        uniqueJobIds: new Set(ids).size,
        duplicates: responses.filter((response) => response.duplicate).length,
        persisted: persisted.length,
        terminal: terminal.length,
        missingAcceptedWork: ids.length - persisted.length,
        statusCounts,
        acknowledgementMs: {
          p50: percentile(acknowledgement, 0.5),
          p95: percentile(acknowledgement, 0.95),
          max: Math.max(...acknowledgement),
        },
        submissionWallMs: terminalStarted - started,
        terminalDrainMs: Date.now() - terminalStarted,
      });
      console.log(`[phase2-ingress] ${level}: ${accepted.length}/${level} accepted, ${persisted.length} persisted, ${terminal.length} terminal`);
    }
    fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
    const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), levels: LEVELS, results };
    const output = path.resolve('artifacts/phase2-ingress-load.json');
    fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`[phase2-ingress] wrote ${output}`);
  } finally {
    const cleanup = await admin.auth.admin.deleteUser(isolated.userId);
    if (cleanup.error) console.warn(`[phase2-ingress] isolated user cleanup failed: ${cleanup.error.message}`);
  }
}

main().catch((error) => {
  console.error(`[phase2-ingress] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
