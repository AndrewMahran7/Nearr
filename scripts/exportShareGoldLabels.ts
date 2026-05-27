/**
 * exportShareGoldLabels.ts
 *
 * Reads TEST_VIDEOS.txt (URLs grouped by category), runs each link through the
 * deployed process-share-link backend (same path as `npm run test:share-remote`),
 * and writes a labeling CSV + JSON to artifacts/ for manual gold-set labeling.
 *
 * This is a labeling/export script only. It does NOT change extraction,
 * safety, or transcription logic and does NOT add new providers.
 */

import * as fs from 'fs';
import * as path from 'path';

import { createClient } from '@supabase/supabase-js';

type EnvConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  processShareLinkUrl: string;
  email: string;
  password: string;
  accessToken?: string;
  usedDefaultCredentials: boolean;
  loadedEnvPath: string | null;
};

type ParsedEntry = {
  category: string;
  url: string;
  inline_note_from_file: string;
};

type LabelRow = {
  category: string;
  url: string;
  inline_note_from_file: string;
  poster_handle: string;
  poster_display_name: string;
  title: string;
  description: string;
  title_length: number;
  description_length: number;
  description_truncated: string;
  detected_handles: string;
  metadata_extracted_address: string;
  metadata_city: string;
  metadata_state: string;
  backend_status: string;
  backend_candidate_name: string;
  backend_candidate_address: string;
  backend_candidate_place_id: string;
  backend_decision: string;
  safe_to_auto_save: string;
  confidence: string;
  evidence_used: string;
  warnings: string;
  places_queries: string;
  top_candidates: string;
  duplicate_url_count: number;
  duplicate_group_id: number;
  error_message: string;
  expected_place_name: string;
  expected_address: string;
  expected_decision: string;
  label_notes: string;
};

const DEFAULT_EMAIL = 'dev@nearr.test';
const DEFAULT_PASSWORD = 'devpass123';
const INPUT_FILE = 'TEST_VIDEOS.txt';
const OUTPUT_DIR = 'artifacts';
const CSV_OUTPUT = path.join(OUTPUT_DIR, 'share-gold-labeling.csv');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'share-gold-labeling.json');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const PER_REQUEST_DELAY_MS = 400;

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

function getConfig(): EnvConfig {
  const loadedEnvPath = loadDotEnv();
  const email = process.env.NEARR_TEST_EMAIL?.trim() || DEFAULT_EMAIL;
  const password = process.env.NEARR_TEST_PASSWORD?.trim() || DEFAULT_PASSWORD;
  const usedDefaultCredentials =
    !process.env.NEARR_TEST_EMAIL || !process.env.NEARR_TEST_PASSWORD;
  return {
    supabaseUrl: requireEnv('EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    processShareLinkUrl: requireEnv('EXPO_PUBLIC_PROCESS_SHARE_LINK_URL'),
    email,
    password,
    accessToken: process.env.NEARR_TEST_ACCESS_TOKEN?.trim() || undefined,
    usedDefaultCredentials,
    loadedEnvPath,
  };
}

async function resolveAccessToken(config: EnvConfig): Promise<string> {
  if (config.accessToken) {
    console.log('[gold-label] Using NEARR_TEST_ACCESS_TOKEN from env');
    return config.accessToken;
  }
  if (config.usedDefaultCredentials) {
    console.log(
      `[gold-label] NEARR_TEST_EMAIL / NEARR_TEST_PASSWORD missing; using defaults ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`,
    );
  } else {
    console.log(`[gold-label] Signing in as ${config.email}`);
  }
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
  const token = data.session?.access_token;
  if (!token) throw new Error('Supabase sign-in succeeded but returned no access token');
  console.log('[gold-label] Sign-in succeeded; access token acquired');
  return token;
}

function parseInputFile(filePath: string): ParsedEntry[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const entries: ParsedEntry[] = [];
  let currentCategory = '(uncategorized)';
  // Match a leading URL plus optional trailing "(...)" note on the same line.
  const urlLineRegex = /^(https?:\/\/\S+)\s*(?:\(([^)]+)\))?\s*$/i;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/^https?:\/\//i.test(line) && line.endsWith(':')) {
      currentCategory = line.slice(0, -1).trim();
      continue;
    }
    const match = line.match(urlLineRegex);
    if (match) {
      entries.push({
        category: currentCategory,
        url: match[1].trim(),
        inline_note_from_file: (match[2] ?? '').trim(),
      });
    }
  }
  return entries;
}

function computeDuplicateInfo(entries: ParsedEntry[]): {
  countByUrl: Map<string, number>;
  groupIdByUrl: Map<string, number>;
} {
  const countByUrl = new Map<string, number>();
  const groupIdByUrl = new Map<string, number>();
  let nextGroupId = 1;
  for (const entry of entries) {
    countByUrl.set(entry.url, (countByUrl.get(entry.url) ?? 0) + 1);
  }
  for (const entry of entries) {
    if ((countByUrl.get(entry.url) ?? 0) > 1 && !groupIdByUrl.has(entry.url)) {
      groupIdByUrl.set(entry.url, nextGroupId++);
    }
  }
  return { countByUrl, groupIdByUrl };
}

type RemoteResult = {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  parsed: Record<string, any> | null;
  rawText: string;
  requestError?: string;
};

async function postJson(
  endpoint: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<RemoteResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    const latencyMs = Date.now() - startedAt;
    let parsed: Record<string, any> | null = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    return {
      ok: response.ok && parsed !== null,
      httpStatus: response.status,
      latencyMs,
      parsed,
      rawText,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      latencyMs: Date.now() - startedAt,
      parsed: null,
      rawText: '',
      requestError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function callRemoteWithRetry(
  url: string,
  accessToken: string,
  endpoint: string,
): Promise<RemoteResult> {
  let last: RemoteResult | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await postJson(endpoint, accessToken, {
      mode: 'extract',
      url,
      accessToken,
    });
    last = result;
    const transient =
      !!result.requestError ||
      result.httpStatus === 0 ||
      result.httpStatus === 408 ||
      result.httpStatus === 429 ||
      result.httpStatus >= 500;
    if (!transient && result.parsed) return result;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
  return last as RemoteResult;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function detectPoster(
  title: string,
  profileMetadata: any[],
  detectedHandles: string[],
): { handle: string; displayName: string } {
  let displayName = '';
  let handle = '';

  // Common Instagram og:title formats:
  //   "Display Name on Instagram: \"...\""
  //   "Display Name (@handle) on Instagram: ..."
  if (title) {
    const withHandle = title.match(/^(.+?)\s*\(@([A-Za-z0-9._]+)\)\s+on Instagram/i);
    if (withHandle) {
      displayName = withHandle[1].trim();
      handle = withHandle[2].trim();
    } else {
      const nameOnly = title.match(/^(.+?)\s+on Instagram/i);
      if (nameOnly) displayName = nameOnly[1].trim();
    }
  }

  if (!handle) {
    const matched = profileMetadata.find(
      (entry) =>
        entry &&
        typeof entry.handle === 'string' &&
        displayName &&
        typeof entry.displayName === 'string' &&
        entry.displayName.trim().toLowerCase() === displayName.toLowerCase(),
    );
    if (matched?.handle) handle = String(matched.handle);
  }

  if (!handle && profileMetadata.length === 1 && profileMetadata[0]?.handle) {
    handle = String(profileMetadata[0].handle);
  }
  if (!handle && detectedHandles.length === 1) {
    handle = detectedHandles[0];
  }

  if (!displayName && handle) {
    const matched = profileMetadata.find(
      (entry) => entry && entry.handle === handle && typeof entry.displayName === 'string',
    );
    if (matched?.displayName) displayName = String(matched.displayName);
  }

  return { handle, displayName };
}

function buildRow(
  entry: ParsedEntry,
  result: RemoteResult,
  duplicateInfo: { countByUrl: Map<string, number>; groupIdByUrl: Map<string, number> },
): LabelRow {
  const response = result.parsed ?? {};
  const extraction = (response.extraction as Record<string, any> | undefined) ?? {};
  const agent = (extraction.agent as Record<string, any> | undefined) ?? {};
  const metadataDiagnostics =
    (extraction.metadataDiagnostics as Record<string, any> | undefined) ?? {};
  const profileMetadata = Array.isArray(extraction.profileMetadata)
    ? (extraction.profileMetadata as any[])
    : [];
  const detectedHandles = asStringArray(extraction.handlesDetected);
  const candidates = Array.isArray(agent.candidates) ? (agent.candidates as any[]) : [];
  const finalCandidates = Array.isArray(extraction.finalCandidates)
    ? (extraction.finalCandidates as any[])
    : [];
  const toolCalls = Array.isArray(agent.toolCalls) ? (agent.toolCalls as any[]) : [];

  const title = asString(extraction.title);
  const description = asString(extraction.description);

  const { handle: posterHandle, displayName: posterDisplayName } = detectPoster(
    title,
    profileMetadata,
    detectedHandles,
  );

  const resolved = (agent.resolvedPlace as Record<string, any> | undefined) ?? null;
  const primaryCandidate = resolved ?? candidates[0] ?? finalCandidates[0] ?? null;
  const candidateName = primaryCandidate
    ? asString(primaryCandidate.name ?? primaryCandidate.placeName)
    : '';
  const candidateAddress = primaryCandidate
    ? asString(primaryCandidate.formattedAddress ?? primaryCandidate.address)
    : '';
  const candidatePlaceId = primaryCandidate
    ? asString(primaryCandidate.googlePlaceId ?? primaryCandidate.placeId)
    : '';

  // Best-effort places_queries: pull notes from searchPlaces tool calls.
  const placesQueries = toolCalls
    .filter((tool) => typeof tool?.tool === 'string' && tool.tool.toLowerCase().includes('place'))
    .map((tool) => {
      const parts: string[] = [];
      if (tool.tool) parts.push(String(tool.tool));
      if (tool.status) parts.push(`status=${tool.status}`);
      if (tool.note) parts.push(`note=${String(tool.note)}`);
      return parts.join(' ');
    });

  const topCandidates = candidates.slice(0, 5).map((c) => {
    const name = asString(c?.name);
    const addr = asString(c?.formattedAddress);
    const score = typeof c?.matchScore === 'number' ? c.matchScore.toFixed(2) : '';
    const placeId = asString(c?.googlePlaceId);
    return [name, addr, score ? `score=${score}` : '', placeId ? `placeId=${placeId}` : '']
      .filter(Boolean)
      .join(' | ');
  });

  let backendStatus = asString(response.status);
  let errorMessage = '';
  if (result.requestError) {
    backendStatus = 'failed';
    errorMessage = result.requestError;
  } else if (!result.parsed) {
    backendStatus = 'failed';
    errorMessage = `http ${result.httpStatus}: non-JSON body`;
  } else if (!backendStatus && result.httpStatus >= 400) {
    backendStatus = 'failed';
    errorMessage = `http ${result.httpStatus}`;
  } else if (response.reason && (!backendStatus || backendStatus === 'failed')) {
    errorMessage = asString(response.reason);
  }

  const dupCount = duplicateInfo.countByUrl.get(entry.url) ?? 1;
  const dupGroup = duplicateInfo.groupIdByUrl.get(entry.url) ?? 0;

  return {
    category: entry.category,
    url: entry.url,
    inline_note_from_file: entry.inline_note_from_file,
    poster_handle: posterHandle,
    poster_display_name: posterDisplayName,
    title,
    description,
    title_length: title.length,
    description_length: description.length,
    description_truncated:
      typeof metadataDiagnostics.descriptionTruncated === 'boolean'
        ? String(metadataDiagnostics.descriptionTruncated)
        : '',
    detected_handles: detectedHandles.join(', '),
    metadata_extracted_address: asString(metadataDiagnostics.extractedAddress),
    metadata_city: asString(metadataDiagnostics.extractedCity),
    metadata_state: asString(metadataDiagnostics.extractedState),
    backend_status: backendStatus || '',
    backend_candidate_name: candidateName,
    backend_candidate_address: candidateAddress,
    backend_candidate_place_id: candidatePlaceId,
    backend_decision: asString(agent.userFacingDecision),
    safe_to_auto_save:
      typeof agent.safeToAutoSave === 'boolean' ? String(agent.safeToAutoSave) : '',
    confidence: asString(agent.confidence),
    evidence_used: asStringArray(agent.evidenceUsed).join('; '),
    warnings: asStringArray(agent.warnings).join('; '),
    places_queries: placesQueries.join(' || '),
    top_candidates: topCandidates.join(' || '),
    duplicate_url_count: dupCount,
    duplicate_group_id: dupGroup,
    error_message: errorMessage,
    expected_place_name: '',
    expected_address: '',
    expected_decision: '',
    label_notes: '',
  };
}

function csvEscape(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: LabelRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]) as (keyof LabelRow)[];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] as string | number)).join(','));
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const config = getConfig();
  const inputPath = path.resolve(process.cwd(), INPUT_FILE);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  const entries = parseInputFile(inputPath);
  if (entries.length === 0) {
    throw new Error(`No URLs parsed from ${INPUT_FILE}`);
  }

  console.log('[gold-label] share-gold-labeling exporter');
  console.log(`[gold-label] endpoint: ${config.processShareLinkUrl}`);
  console.log(`[gold-label] .env loaded: ${config.loadedEnvPath ?? '(not found)'}`);
  console.log(`[gold-label] input: ${inputPath}`);
  console.log(`[gold-label] entries: ${entries.length}`);

  const accessToken = await resolveAccessToken(config);
  const duplicateInfo = computeDuplicateInfo(entries);

  const rows: LabelRow[] = [];
  let okCount = 0;
  let failedCount = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const result = await callRemoteWithRetry(entry.url, accessToken, config.processShareLinkUrl);
    const row = buildRow(entry, result, duplicateInfo);
    rows.push(row);
    const statusLabel = row.backend_status || (result.parsed ? 'ok' : 'failed');
    if (statusLabel === 'failed' || row.error_message) failedCount += 1;
    else okCount += 1;
    console.log(
      `[gold-label] ${i + 1}/${entries.length} category="${entry.category}" url=${entry.url} status=${statusLabel}${row.error_message ? ` error="${row.error_message}"` : ''}`,
    );
    if (i + 1 < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, PER_REQUEST_DELAY_MS));
    }
  }

  fs.mkdirSync(path.resolve(process.cwd(), OUTPUT_DIR), { recursive: true });
  const csvPath = path.resolve(process.cwd(), CSV_OUTPUT);
  const jsonPath = path.resolve(process.cwd(), JSON_OUTPUT);
  fs.writeFileSync(csvPath, rowsToCsv(rows), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');

  console.log('');
  console.log(`[gold-label] wrote ${rows.length} rows`);
  console.log(`[gold-label] ok=${okCount} failed=${failedCount}`);
  console.log(`[gold-label] csv: ${csvPath}`);
  console.log(`[gold-label] json: ${jsonPath}`);
}

main().catch((error) => {
  console.error(`[gold-label] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
