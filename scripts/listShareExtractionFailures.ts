import * as fs from 'fs';
import * as path from 'path';

import { createClient } from '@supabase/supabase-js';

type CliOptions = {
  limit: number;
  platform: string | null;
  failureClass: string | null;
  addressPresent: boolean | null;
  outPath: string | null;
  jsonl: boolean;
};

type FailureRow = {
  id: string;
  created_at: string;
  platform: string | null;
  status: string | null;
  user_facing_decision: string | null;
  failure_class: string | null;
  failure_reason: string | null;
  address_present: boolean;
  address_count: number;
  candidate_count: number;
  query_count: number;
  original_url: string;
  canonical_url: string | null;
  selected_candidate_name: string | null;
  selected_candidate_address: string | null;
  selected_candidate_score: number | null;
  suggested_query: string | null;
  warnings: unknown;
  llm_summary: unknown;
};

function loadDotEnv(): string | null {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    if (!process.env[key]) process.env[key] = value;
  }
  return envPath;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function resolveSupabaseUrl(): string {
  const direct = process.env.SUPABASE_URL?.trim();
  if (direct) return direct;
  const expoPublic = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (expoPublic) return expoPublic;
  throw new Error('Missing required env SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)');
}

function parseBool(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let limit = 20;
  let platform: string | null = null;
  let failureClass: string | null = null;
  let addressPresent: boolean | null = null;
  let outPath: string | null = null;
  let jsonl = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]?.trim();
    if (!arg) continue;
    if (arg === '--limit') {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(500, Math.round(parsed));
      i += 1;
      continue;
    }
    if (arg === '--platform') {
      platform = args[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (arg === '--failure-class') {
      failureClass = args[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (arg === '--address-present') {
      addressPresent = parseBool(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--out') {
      outPath = args[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (arg === '--jsonl') {
      jsonl = true;
      continue;
    }
  }

  if (outPath && !jsonl) {
    jsonl = true;
  }

  return { limit, platform, failureClass, addressPresent, outPath, jsonl };
}

function truncate(value: string | null | undefined, max = 140): string {
  if (!value) return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function compactRow(row: FailureRow): string {
  return [
    row.created_at,
    `platform=${row.platform ?? 'unknown'}`,
    `decision=${row.user_facing_decision ?? row.status ?? 'n/a'}`,
    `class=${row.failure_class ?? 'unknown'}`,
    `addr=${row.address_present ? 'yes' : 'no'}`,
    `cand=${row.candidate_count}`,
    `query=${row.query_count}`,
    `name=${truncate(row.selected_candidate_name, 48) || '(none)'}`,
    `reason=${truncate(row.failure_reason, 64) || '(none)'}`,
  ].join(' | ');
}

function toJsonlObject(row: FailureRow): Record<string, unknown> {
  return {
    id: row.id,
    created_at: row.created_at,
    platform: row.platform,
    status: row.status,
    decision: row.user_facing_decision,
    failure_class: row.failure_class,
    failure_reason: row.failure_reason,
    address_present: row.address_present,
    address_count: row.address_count,
    candidate_count: row.candidate_count,
    query_count: row.query_count,
    original_url: row.original_url,
    canonical_url: row.canonical_url,
    selected_candidate: {
      name: row.selected_candidate_name,
      address: row.selected_candidate_address,
      score: row.selected_candidate_score,
    },
    suggested_query: row.suggested_query,
    warnings: row.warnings,
    llm_summary: row.llm_summary,
  };
}

async function main(): Promise<void> {
  const loadedEnvPath = loadDotEnv();
  const opts = parseArgs();

  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from('share_extraction_failures')
    .select(
      [
        'id',
        'created_at',
        'platform',
        'status',
        'user_facing_decision',
        'failure_class',
        'failure_reason',
        'address_present',
        'address_count',
        'candidate_count',
        'query_count',
        'original_url',
        'canonical_url',
        'selected_candidate_name',
        'selected_candidate_address',
        'selected_candidate_score',
        'suggested_query',
        'warnings',
        'llm_summary',
      ].join(', '),
    )
    .order('created_at', { ascending: false })
    .limit(opts.limit);

  if (opts.platform) query = query.eq('platform', opts.platform);
  if (opts.failureClass) query = query.eq('failure_class', opts.failureClass);
  if (opts.addressPresent !== null) query = query.eq('address_present', opts.addressPresent);

  const { data, error } = await query;
  if (error) throw new Error(`Query failed: ${error.message}`);

  const rows = (data ?? []) as unknown as FailureRow[];

  console.log('[failures:list] share_extraction_failures');
  console.log(`[failures:list] .env loaded: ${loadedEnvPath ?? '(not found)'}`);
  console.log(
    `[failures:list] filters: platform=${opts.platform ?? '(any)'} failure_class=${opts.failureClass ?? '(any)'} address_present=${
      opts.addressPresent === null ? '(any)' : String(opts.addressPresent)
    } limit=${opts.limit}`,
  );
  console.log(`[failures:list] rows: ${rows.length}`);

  if (!opts.jsonl) {
    if (rows.length === 0) {
      console.log('(no rows)');
      return;
    }
    for (const row of rows) {
      console.log(compactRow(row));
      console.log(`  url=${truncate(row.original_url, 180)}`);
      console.log(`  suggested_query=${truncate(row.suggested_query, 160) || '(none)'}`);
    }
    return;
  }

  const jsonlLines = rows.map((row) => JSON.stringify(toJsonlObject(row)));
  const output = `${jsonlLines.join('\n')}${jsonlLines.length > 0 ? '\n' : ''}`;

  if (opts.outPath) {
    const target = path.resolve(process.cwd(), opts.outPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
    console.log(`[failures:list] wrote JSONL: ${target}`);
    return;
  }

  process.stdout.write(output);
}

main().catch((error) => {
  console.error('[failures:list] fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
