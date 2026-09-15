import { createHash } from 'node:crypto';

import { openSession } from './e2e/session';

type Row = Record<string, unknown>;

const START = '2026-09-14T23:45:00.000Z';
const END = '2026-09-15T00:30:00.000Z';
const PRIVATE_KEY = /(url|token|secret|authorization|email)/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function sanitized(value: unknown, key = ''): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (PRIVATE_KEY.test(key)) return value ? `[redacted:${digest(value)}]` : value;
    if (UUID.test(value)) return `ref_${digest(value)}`;
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitized(entry, key));
  if (typeof value === 'object') {
    const output: Row = {};
    for (const [childKey, childValue] of Object.entries(value as Row)) {
      if (/(password|service_role|api_key)/iu.test(childKey)) continue;
      output[childKey] = sanitized(childValue, childKey);
    }
    return output;
  }
  return String(value);
}

async function rowsOrEmpty(label: string, query: PromiseLike<{ data: Row[] | null; error: { message?: string } | null }>) {
  const { data, error } = await query;
  if (error) return { label, error: error.message ?? 'unknown', rows: [] as Row[] };
  return { label, error: null, rows: data ?? [] };
}

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: false, withEdgeSecrets: false });
  const { data: jobs, error } = await session.admin
    .from('share_jobs')
    .select('*')
    .gte('created_at', START)
    .lte('created_at', END)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`share_jobs: ${error.message}`);

  const matches = (jobs ?? []).filter((job) => {
    const text = JSON.stringify(job).toLocaleLowerCase();
    return job.source_platform === 'instagram' &&
      (text.includes('prada') || text.includes('greece') || text.includes('san francisco'));
  }) as Row[];

  const output = [];
  for (const job of matches) {
    const jobId = String(job.id);
    const sourceUrl = String(job.source_url);
    const related = await Promise.all([
      rowsOrEmpty('share_media_tasks', session.admin.from('share_media_tasks').select('*').eq('share_job_id', jobId).order('created_at')),
      rowsOrEmpty('share_media_runs', session.admin.from('share_media_runs').select('*').eq('share_job_id', jobId).order('created_at')),
      rowsOrEmpty('share_agent_runs', session.admin.from('share_agent_runs').select('*').eq('url', sourceUrl).gte('created_at', START).lte('created_at', END).order('created_at')),
      rowsOrEmpty('share_extraction_failures', session.admin.from('share_extraction_failures').select('*').eq('original_url', sourceUrl).gte('created_at', START).lte('created_at', END).order('created_at')),
      rowsOrEmpty('share_job_place_results', session.admin.from('share_job_place_results').select('*').eq('share_job_id', jobId).order('created_at')),
    ]);
    output.push({
      pseudonymousJobId: digest(jobId),
      job: sanitized(job),
      related: related.map((entry) => ({
        table: entry.label,
        error: entry.error,
        rows: sanitized(entry.rows),
      })),
    });
  }

  console.log(JSON.stringify({ target: session.config.supabaseRef, start: START, end: END, matches: output }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
