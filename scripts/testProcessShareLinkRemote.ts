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

type CliOptions = {
  urls: string[];
  urlsExplicitlyProvided: boolean;
  geminiSmoke: boolean;
  geminiPrompt?: string;
  geminiModel?: string;
  geminiModels?: string[];
  slowAgent: boolean;
  agentBudgetMs?: number;
};

type GeminiBenchmarkRow = {
  model: string;
  ok: boolean;
  httpStatus: number | string;
  latencyMs: number | string;
  finishReason: string;
  jsonValid: boolean;
  error: string;
};

type JsonRecord = Record<string, unknown>;

type ProfileMetadataEntry = {
  handle?: string;
  fetched?: boolean;
  blocked?: boolean;
  classification?: string;
  displayName?: string;
  category?: string;
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  confidence?: string;
  reasons?: string[];
};

type AgentToolCall = {
  tool?: string;
  status?: string;
  note?: string | null;
  latencyMs?: number | null;
};

type AgentCandidate = {
  googlePlaceId?: string;
  name?: string;
  formattedAddress?: string | null;
  matchScore?: number;
  rationale?: string;
};

type ResolvedPlace = {
  googlePlaceId?: string;
  name?: string;
  formattedAddress?: string | null;
};

type AgentBlock = {
  runId?: string;
  promptVersion?: string;
  modelUsed?: string;
  userFacingDecision?: string;
  safeToAutoSave?: boolean;
  confidence?: string;
  reasoning?: string;
  evidenceUsed?: string[];
  toolsUsed?: string[];
  toolCalls?: AgentToolCall[];
  geminiDiagnostics?: GeminiDiagnostics | null;
  stageTimings?: AgentStageTimings | null;
  candidates?: AgentCandidate[];
  rejectionReasons?: string[];
  warnings?: string[];
  resolvedPlace?: ResolvedPlace | null;
  diagnostics?: GeminiDiagnostics | (Record<string, unknown> & { queryPlan?: string[] }) | null;
};

type GeminiDiagnostics = {
  model?: string;
  responseMimeType?: string;
  httpStatus?: number | null;
  topLevelKeys?: string[];
  candidatesLength?: number;
  finishReason?: string | null;
  finishMessage?: string | null;
  promptBlockReason?: string | null;
  textExists?: boolean;
  textLength?: number;
  textPreview?: string | null;
  errorMessage?: string | null;
  modelVersion?: string | null;
  responseId?: string | null;
  latencyMs?: number;
};

type AgentStageTimings = {
  metadataMs?: number | null;
  handleDetectionMs?: number | null;
  profileEnrichmentMs?: number | null;
  geminiMs?: number | null;
  placesMs?: number | null;
  compareCandidatesMs?: number | null;
  safetyMs?: number | null;
  totalMs?: number | null;
  placesAttemptCount?: number | null;
};

type MetadataDiagnostics = {
  rawTitleLength?: number;
  rawDescriptionLength?: number;
  cleanTitleLength?: number;
  cleanDescriptionLength?: number;
  descriptionTruncated?: boolean;
  addressMatched?: boolean;
  extractedAddress?: string | null;
  extractedCity?: string | null;
  extractedState?: string | null;
  hasStreetSuffixToken?: boolean;
  hasZipCode?: boolean;
  hasStateCode?: boolean;
  combinedTextLength?: number;
};

type ExtractionPayload = {
  title?: string | null;
  description?: string | null;
  handlesDetected?: string[];
  profileMetadata?: ProfileMetadataEntry[];
  agent?: AgentBlock;
  blockedReason?: string | null;
  debugSlow?: boolean;
  agentBudgetMs?: number;
  geminiTimeoutMs?: number;
  timeoutRecoveryUsed?: boolean;
  realGeminiCompleted?: boolean;
  finalModelDecision?: string | null;
  finalSafetyDecision?: string | null;
  finalCandidates?: AgentCandidate[];
  finalReasoning?: string | null;
  finalToolsUsed?: string[];
  finalStageTimings?: AgentStageTimings | null;
  metadataDiagnostics?: MetadataDiagnostics | null;
};

type BatchSummary = {
  totalTested: number;
  realGeminiCompletedCount: number;
  timeoutRecoveryCount: number;
  candidateConfirmationCount: number;
  manualFallbackCount: number;
  failedCount: number;
  suspectedCorrectCandidates: number;
  suspiciousCandidates: number;
};

type RemoteResponse = {
  status?: string;
  reason?: string | null;
  extraction?: ExtractionPayload;
  ok?: boolean;
  modelUsed?: string;
  diagnostics?: GeminiDiagnostics | null;
  parsedJson?: Record<string, unknown> | null;
  rawTextPreview?: string | null;
  [key: string]: unknown;
};

const DEFAULT_URLS = [
  'https://www.instagram.com/p/DVrn72RmJsW/',
  'https://www.instagram.com/p/DLfvZunSKRp/',
  'https://www.instagram.com/reel/DNT_wptv1K9/',
];

const DEFAULT_EMAIL = 'dev@nearr.test';
const DEFAULT_PASSWORD = 'devpass123';

function loadDotEnv(): string | null {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  return envPath;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function getConfig(): EnvConfig {
  const loadedEnvPath = loadDotEnv();
  const email = process.env.NEARR_TEST_EMAIL?.trim() || DEFAULT_EMAIL;
  const password = process.env.NEARR_TEST_PASSWORD?.trim() || DEFAULT_PASSWORD;
  const usedDefaultCredentials = !process.env.NEARR_TEST_EMAIL || !process.env.NEARR_TEST_PASSWORD;

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

function getCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  let geminiSmoke = false;
  let geminiPrompt: string | undefined;
  let geminiModel: string | undefined;
  let geminiModels: string[] | undefined;
  let slowAgent = false;
  let agentBudgetMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]?.trim();
    if (!arg) continue;
    if (arg === '--gemini-smoke') {
      geminiSmoke = true;
      continue;
    }
    if (arg === '--gemini-prompt') {
      geminiPrompt = args[index + 1]?.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === '--gemini-model') {
      geminiModel = args[index + 1]?.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === '--gemini-models') {
      geminiModels = (args[index + 1] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (geminiModels.length === 0) geminiModels = undefined;
      index += 1;
      continue;
    }
    if (arg === '--slow-agent') {
      slowAgent = true;
      continue;
    }
    if (arg === '--agent-budget-ms') {
      const parsed = Number(args[index + 1]?.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        agentBudgetMs = Math.round(parsed);
        slowAgent = true;
      }
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) urls.push(arg);
  }

  return {
    urls: urls.length > 0 ? urls : DEFAULT_URLS,
    urlsExplicitlyProvided: urls.length > 0,
    geminiSmoke,
    geminiPrompt,
    geminiModel,
    geminiModels,
    slowAgent,
    agentBudgetMs,
  };
}

function summarizeBoolean(value: boolean | null | undefined): string {
  return value === true ? 'yes' : value === false ? 'no' : '(none)';
}

function summarizeMode(response: RemoteResponse): string {
  return response.extraction?.debugSlow ? 'SLOW' : 'NORMAL';
}

function candidateLooksPlausible(extraction: ExtractionPayload | undefined): boolean {
  const agent = extraction?.agent;
  const candidateName = agent?.resolvedPlace?.name ?? extraction?.finalCandidates?.[0]?.name ?? '';
  const evidenceText = [extraction?.title ?? '', extraction?.description ?? ''].join(' ').toLowerCase();
  const meaningfulTokens = candidateName
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 4);
  return meaningfulTokens.some((token) => evidenceText.includes(token));
}

function printBatchSummary(summary: BatchSummary): void {
  console.log('\n=== batch summary ===');
  console.log(`total tested: ${summary.totalTested}`);
  console.log(`real Gemini completed count: ${summary.realGeminiCompletedCount}`);
  console.log(`timeout recovery count: ${summary.timeoutRecoveryCount}`);
  console.log(`candidate_confirmation count: ${summary.candidateConfirmationCount}`);
  console.log(`manual_fallback count: ${summary.manualFallbackCount}`);
  console.log(`failed count: ${summary.failedCount}`);
  console.log(`suspected correct candidates: ${summary.suspectedCorrectCandidates}`);
  console.log(`suspicious candidates: ${summary.suspiciousCandidates}`);
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : `${value}${' '.repeat(width - value.length)}`;
}

function printGeminiBenchmarkTable(rows: GeminiBenchmarkRow[]): void {
  if (rows.length === 0) return;
  const headers = ['model', 'ok', 'http', 'latencyMs', 'finishReason', 'jsonValid', 'error'];
  const tableRows = rows.map((row) => [
    row.model,
    row.ok ? 'yes' : 'no',
    String(row.httpStatus),
    String(row.latencyMs),
    row.finishReason,
    row.jsonValid ? 'yes' : 'no',
    row.error,
  ]);
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...tableRows.map((row) => row[columnIndex]?.length ?? 0)),
  );

  console.log('\n=== debug_gemini benchmark ===');
  console.log(headers.map((header, index) => padCell(header, widths[index])).join(' | '));
  console.log(widths.map((width) => '-'.repeat(width)).join('-|-'));
  for (const row of tableRows) {
    console.log(row.map((value, index) => padCell(value, widths[index])).join(' | '));
  }
}

async function postJson(
  endpoint: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ httpStatus: number; latencyMs: number; rawText: string; parsed: RemoteResponse | null }> {
  const startedAt = Date.now();
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
  let parsed: RemoteResponse | null = null;
  try {
    parsed = JSON.parse(rawText) as RemoteResponse;
  } catch {
    parsed = null;
  }
  return { httpStatus: response.status, latencyMs, rawText, parsed };
}

function isValidParsedJson(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toBenchmarkRow(args: {
  model: string;
  httpStatus: number | string;
  latencyMs: number | string;
  parsed: RemoteResponse | null;
  rawText?: string;
  requestError?: string;
}): GeminiBenchmarkRow {
  const diagnostics = args.parsed?.diagnostics ?? null;
  const jsonValid = isValidParsedJson(args.parsed?.parsedJson ?? null);
  const error =
    args.requestError ??
    diagnostics?.errorMessage ??
    (jsonValid ? '' : truncate(args.rawText ?? '', 120) || args.parsed?.reason || '(none)');
  return {
    model: args.model,
    ok: args.parsed?.ok === true,
    httpStatus: args.httpStatus,
    latencyMs: args.latencyMs,
    finishReason: diagnostics?.finishReason ?? '(none)',
    jsonValid,
    error: error || '(none)',
  };
}

function truncate(value: unknown, max = 140): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

function formatList(values: Array<string | null | undefined>, fallback = '(none)'): string {
  const filtered = values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
  return filtered.length > 0 ? filtered.join(', ') : fallback;
}

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function collectStringsDeep(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringsDeep(item, acc);
    return;
  }
  const record = asObject(value);
  if (!record) return;
  for (const nested of Object.values(record)) {
    collectStringsDeep(nested, acc);
  }
}

function hasDeepText(value: unknown, needle: string): boolean {
  const all: string[] = [];
  collectStringsDeep(value, all);
  const loweredNeedle = needle.toLowerCase();
  return all.some((entry) => entry.toLowerCase().includes(loweredNeedle));
}

async function resolveAccessToken(config: EnvConfig): Promise<string> {
  if (config.accessToken) {
    console.log('[auth] Using NEARR_TEST_ACCESS_TOKEN from env');
    return config.accessToken;
  }

  if (config.usedDefaultCredentials) {
    console.log(
      `[auth] NEARR_TEST_EMAIL / NEARR_TEST_PASSWORD missing; using defaults ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`,
    );
  } else {
    console.log(`[auth] Signing in as ${config.email}`);
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (error) {
    throw new Error(`Supabase sign-in failed: ${error.message}`);
  }

  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Supabase sign-in succeeded but returned no access token');
  }

  console.log('[auth] Sign-in succeeded; access token acquired');
  return token;
}

function summarizeProfile(profile: ProfileMetadataEntry): string {
  const statusParts: string[] = [];
  if (profile.fetched === true) statusParts.push('fetched');
  if (profile.blocked === true) statusParts.push('blocked');
  if (profile.confidence) statusParts.push(`confidence=${profile.confidence}`);
  if (profile.classification) statusParts.push(`class=${profile.classification}`);

  const extracted = formatList(
    [profile.extractedName, profile.extractedAddress, profile.extractedCity].filter(Boolean) as string[],
    '(no extracted business fields)',
  );
  const reasons = formatList(profile.reasons ?? [], '(no reasons)');

  return [
    `@${profile.handle ?? 'unknown'}`,
    statusParts.join(' '),
    `display=${truncate(profile.displayName ?? '', 60) || '(none)'}`,
    `category=${truncate(profile.category ?? '', 60) || '(none)'}`,
    `extracted=${extracted}`,
    `reasons=${reasons}`,
  ]
    .filter(Boolean)
    .join(' | ');
}

function summarizeToolCall(tool: AgentToolCall): string {
  const parts = [tool.tool ?? 'unknown', tool.status ?? 'unknown'];
  if (tool.note) parts.push(`note=${truncate(tool.note, 100)}`);
  if (typeof tool.latencyMs === 'number') parts.push(`latency=${tool.latencyMs}ms`);
  return parts.join(' | ');
}

function summarizeCandidate(candidate: AgentCandidate): string {
  const score = typeof candidate.matchScore === 'number' ? candidate.matchScore.toFixed(2) : 'n/a';
  return [
    candidate.name ?? '(no name)',
    truncate(candidate.formattedAddress ?? '', 100) || '(no address)',
    `matchScore=${score}`,
    candidate.rationale ? `why=${truncate(candidate.rationale, 100)}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function printLikelyProblems(response: RemoteResponse, httpStatus: number): void {
  if (httpStatus === 401 || httpStatus === 403) {
    console.log('likely issue: auth/session issue');
  }

  if (hasDeepText(response, 'gemini_key_missing')) {
    console.log('likely issue: GEMINI_API_KEY appears missing in deployed function');
  }

  const agent = response.extraction?.agent;
  const placesProblem =
    hasDeepText(response, 'GOOGLE_PLACES_KEY missing') ||
    hasDeepText(response, 'places_key_missing') ||
    (agent?.toolCalls ?? []).some(
      (tool) =>
        tool.tool === 'searchPlaces' &&
        ((tool.status && tool.status !== 'ok') || (tool.note ?? '').toLowerCase().includes('google_places_key')),
    );
  if (placesProblem) {
    console.log('likely issue: GOOGLE_PLACES_KEY may be missing or invalid');
  }
}

function summarizeResolvedPlace(place: ResolvedPlace | null | undefined): string {
  if (!place) return '(none)';
  return [
    place.name ?? '(no name)',
    truncate(place.formattedAddress ?? '', 100) || '(no address)',
    place.googlePlaceId ? `placeId=${place.googlePlaceId}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

function summarizeGeminiDiagnostics(diag: GeminiDiagnostics | null | undefined): string[] {
  if (!diag) return ['(none)'];
  return [
    `http=${diag.httpStatus ?? 'none'} model=${diag.model ?? '(none)'}`,
    `keys=${formatList(diag.topLevelKeys ?? [], '(none)')}`,
    `candidates=${String(diag.candidatesLength ?? 0)} finishReason=${diag.finishReason ?? '(none)'}`,
    `promptBlockReason=${diag.promptBlockReason ?? '(none)'}`,
    `textExists=${String(diag.textExists ?? false)} textLength=${String(diag.textLength ?? 0)}`,
    `errorMessage=${diag.errorMessage ?? '(none)'}`,
    `textPreview=${diag.textPreview ?? '(none)'}`,
  ];
}

function summarizeStageTimings(timings: AgentStageTimings | null | undefined): string[] {
  if (!timings) return ['(none)'];
  return [
    `metadata=${String(timings.metadataMs ?? 'n/a')}ms handleDetection=${String(timings.handleDetectionMs ?? 'n/a')}ms profileEnrichment=${String(timings.profileEnrichmentMs ?? 'n/a')}ms`,
    `gemini=${String(timings.geminiMs ?? 'n/a')}ms places=${String(timings.placesMs ?? 'n/a')}ms compareCandidates=${String(timings.compareCandidatesMs ?? 'n/a')}ms safety=${String(timings.safetyMs ?? 'n/a')}ms`,
    `total=${String(timings.totalMs ?? 'n/a')}ms placesAttemptCount=${String(timings.placesAttemptCount ?? 'n/a')}`,
  ];
}

function printUnexpectedPayloadSummary(response: RemoteResponse): void {
  const keys = Object.keys(response);
  const summary = {
    status: response.status ?? null,
    reason: response.reason ?? null,
    keys,
    extractionKeys: response.extraction ? Object.keys(response.extraction) : [],
  };
  console.log('unexpected backend payload summary:', JSON.stringify(summary, null, 2));
}

function printResponseReport(url: string, httpStatus: number, latencyMs: number, response: RemoteResponse): void {
  const keys = Object.keys(response);
  const extraction = response.extraction;
  const agent = extraction?.agent;
  const geminiMissing = hasDeepText(response, 'gemini_key_missing');

  console.log(`\n=== ${url} ===`);
  console.log(`mode: ${summarizeMode(response)}`);
  console.log(`http status: ${httpStatus} (${latencyMs}ms)`);
  console.log(`backend status: ${response.status ?? '(missing)'}`);
  console.log(`backend reason: ${response.reason ?? extraction?.blockedReason ?? '(none)'}`);
  console.log(`top-level keys: ${keys.length > 0 ? keys.join(', ') : '(none)'}`);

  if (response.status === 'unexpected_backend_payload') {
    printUnexpectedPayloadSummary(response);
  }

  console.log(`extraction title: ${truncate(extraction?.title ?? '', 160) || '(none)'}`);
  console.log(`extraction description: ${truncate(extraction?.description ?? '', 160) || '(none)'}`);
  const md = extraction?.metadataDiagnostics ?? null;
  if (md) {
    console.log(
      `metadata diagnostics: rawTitleLen=${md.rawTitleLength ?? 0} rawDescLen=${md.rawDescriptionLength ?? 0} ` +
        `descTruncated=${String(md.descriptionTruncated ?? false)} ` +
        `combinedLen=${md.combinedTextLength ?? 0}`,
    );
    console.log(
      `metadata address signals: addressMatched=${String(md.addressMatched ?? false)} ` +
        `streetSuffix=${String(md.hasStreetSuffixToken ?? false)} zip=${String(md.hasZipCode ?? false)} ` +
        `stateCode=${String(md.hasStateCode ?? false)}`,
    );
    console.log(
      `metadata extracted address: ${md.extractedAddress ?? '(none)'} | city=${md.extractedCity ?? '(none)'} | state=${md.extractedState ?? '(none)'}`,
    );
    if (!md.addressMatched) {
      console.log(
        '[diagnostic] metadata_missing_full_caption_address ' +
          'metadata_title_contains_address=false metadata_description_contains_address=false',
      );
    }
  } else {
    console.log('metadata diagnostics: (none — older backend or no metadata fetched)');
  }
  console.log(`handles detected: ${formatList(extraction?.handlesDetected ?? [], '(none)')}`);

  const profiles = extraction?.profileMetadata ?? [];
  console.log(`profile enrichment ran: ${profiles.length > 0 ? 'yes' : 'no'} (${profiles.length} profiles)`);
  console.log(`profile metadata summary (${profiles.length}):`);
  if (profiles.length === 0) {
    console.log('- (none)');
  } else {
    for (const profile of profiles) {
      console.log(`- ${summarizeProfile(profile)}`);
    }
  }

  console.log(
    `agent meta: promptVersion=${agent?.promptVersion ?? '(none)'} modelUsed=${agent?.modelUsed ?? '(none)'} runId=${agent?.runId ?? '(none)'}`,
  );
  console.log(`gemini signal: ${geminiMissing ? 'missing-key warning present' : agent ? 'no missing-key warning in response' : '(no agent block)'}`);
  console.log(`agent chose: ${summarizeResolvedPlace(agent?.resolvedPlace)}`);
  console.log(`real Gemini completed: ${summarizeBoolean(extraction?.realGeminiCompleted)}`);
  console.log(`timeout recovery used: ${summarizeBoolean(extraction?.timeoutRecoveryUsed)}`);
  if (extraction?.debugSlow) {
    console.log(`agentBudgetMs: ${String(extraction.agentBudgetMs ?? 'n/a')}`);
    console.log(`geminiTimeoutMs: ${String(extraction.geminiTimeoutMs ?? 'n/a')}`);
    console.log(`model chose: ${extraction.finalModelDecision ?? '(none)'}`);
    console.log(`final safety decision: ${extraction.finalSafetyDecision ?? '(none)'}`);
  }
  console.log(`agent userFacingDecision: ${agent?.userFacingDecision ?? '(none)'}`);
  console.log(`agent safeToAutoSave: ${String(agent?.safeToAutoSave ?? false)}`);
  console.log(`agent confidence: ${agent?.confidence ?? '(none)'}`);
  console.log(`agent reasoning: ${truncate(agent?.reasoning ?? '', 400) || '(none)'}`);
  console.log(`evidence used: ${formatList(agent?.evidenceUsed ?? [], '(none)')}`);
  const queryPlan = (agent?.diagnostics as { queryPlan?: string[] } | undefined)?.queryPlan;
  if (Array.isArray(queryPlan)) {
    console.log(`places query plan (${queryPlan.length}): ${formatList(queryPlan, '(none)')}`);
  }
  console.log('gemini diagnostics:');
  for (const line of summarizeGeminiDiagnostics(agent?.geminiDiagnostics)) {
    console.log(`- ${line}`);
  }
  console.log('stage timings:');
  for (const line of summarizeStageTimings(agent?.stageTimings)) {
    console.log(`- ${line}`);
  }

  const tools = agent?.toolCalls ?? [];
  console.log(`tools used (${tools.length}):`);
  if (tools.length === 0) {
    console.log('- (none)');
  } else {
    for (const tool of tools) {
      console.log(`- ${summarizeToolCall(tool)}`);
    }
  }

  const candidates = agent?.candidates ?? [];
  console.log(`candidates (${candidates.length}):`);
  if (candidates.length === 0) {
    console.log('- (none)');
  } else {
    for (const candidate of candidates) {
      console.log(`- ${summarizeCandidate(candidate)}`);
    }
  }

  console.log(`safety blocked reasons: ${formatList(agent?.rejectionReasons ?? [], '(none)')}`);
  if ((agent?.warnings ?? []).length > 0) {
    console.log(`agent warnings: ${formatList(agent?.warnings ?? [], '(none)')}`);
  }

  printLikelyProblems(response, httpStatus);
}

function printGeminiDebugReport(httpStatus: number, latencyMs: number, response: RemoteResponse): void {
  console.log('\n=== debug_gemini ===');
  console.log(`http status: ${httpStatus} (${latencyMs}ms)`);
  console.log(`backend status: ${response.status ?? '(missing)'}`);
  console.log(`ok: ${String(response.ok ?? false)}`);
  console.log(`reason: ${response.reason ?? '(none)'}`);
  console.log(`modelUsed: ${response.modelUsed ?? '(none)'}`);
  console.log('gemini diagnostics:');
  for (const line of summarizeGeminiDiagnostics(response.diagnostics)) {
    console.log(`- ${line}`);
  }
  console.log(`parsedJson: ${response.parsedJson ? JSON.stringify(response.parsedJson) : '(none)'}`);
  console.log(`rawTextPreview: ${truncate(response.rawTextPreview ?? '', 300) || '(none)'}`);
  printLikelyProblems(response, httpStatus);
}

async function callRemote(
  url: string,
  accessToken: string,
  endpoint: string,
  options: CliOptions,
): Promise<RemoteResponse | null> {
  try {
    const result = await postJson(endpoint, accessToken, {
      mode: options.slowAgent ? 'extract_debug_slow' : 'extract',
      ...(options.slowAgent ? { debugSlow: true } : {}),
      ...(options.agentBudgetMs ? { agentBudgetMs: options.agentBudgetMs } : {}),
      url,
      accessToken,
    });

    if (!result.parsed) {
      console.log(`\n=== ${url} ===`);
      console.log(`http status: ${result.httpStatus} (${result.latencyMs}ms)`);
      console.log('backend payload was not valid JSON');
      console.log(`body preview: ${truncate(result.rawText, 300) || '(empty)'}`);
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        console.log('likely issue: auth/session issue');
      }
      return null;
    }

    printResponseReport(url, result.httpStatus, result.latencyMs, result.parsed);
    return result.parsed;
  } catch (error) {
    console.log(`\n=== ${url} ===`);
    console.log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function callGeminiSmoke(
  accessToken: string,
  endpoint: string,
  options: CliOptions,
): Promise<void> {
  const prompt =
    options.geminiPrompt ??
    'Return JSON: {"ok": true, "placeName": "Manasiri Crepe\'s"}';

  if ((options.geminiModels ?? []).length > 0) {
    const rows: GeminiBenchmarkRow[] = [];
    for (const model of options.geminiModels ?? []) {
      try {
        const result = await postJson(endpoint, accessToken, {
          mode: 'debug_gemini',
          accessToken,
          prompt,
          model,
        });
        rows.push(
          toBenchmarkRow({
            model,
            httpStatus: result.httpStatus,
            latencyMs: result.latencyMs,
            parsed: result.parsed,
            rawText: result.rawText,
          }),
        );
      } catch (error) {
        rows.push(
          toBenchmarkRow({
            model,
            httpStatus: 'request_failed',
            latencyMs: 'n/a',
            parsed: null,
            requestError: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    printGeminiBenchmarkTable(rows);
    console.log(
      '[remote-test] example: npm run test:share-remote -- --gemini-smoke --gemini-models gemini-3-flash-preview,gemini-3-flash-lite-preview,gemini-2.5-flash,gemini-2.5-flash-lite',
    );
    return;
  }

  try {
    const result = await postJson(endpoint, accessToken, {
      mode: 'debug_gemini',
      accessToken,
      prompt,
      ...(options.geminiModel ? { model: options.geminiModel } : {}),
    });
    if (!result.parsed) {
      console.log('\n=== debug_gemini ===');
      console.log(`http status: ${result.httpStatus} (${result.latencyMs}ms)`);
      console.log('backend payload was not valid JSON');
      console.log(`body preview: ${truncate(result.rawText, 300) || '(empty)'}`);
      return;
    }
    printGeminiDebugReport(result.httpStatus, result.latencyMs, result.parsed);
    console.log(
      '[remote-test] example: npm run test:share-remote -- --gemini-smoke --gemini-models gemini-3-flash-preview,gemini-3-flash-lite-preview,gemini-2.5-flash,gemini-2.5-flash-lite',
    );
  } catch (error) {
    console.log('\n=== debug_gemini ===');
    console.log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const options = getCliOptions();
  const urls =
    options.geminiSmoke && (options.geminiModels ?? []).length > 0 && !options.urlsExplicitlyProvided
      ? []
      : options.urls;

  console.log('[remote-test] process-share-link remote tester');
  console.log(`[remote-test] endpoint: ${config.processShareLinkUrl}`);
  console.log(`[remote-test] .env loaded: ${config.loadedEnvPath ?? '(not found)'}`);
  console.log(`[remote-test] urls: ${urls.length}`);
  if (options.slowAgent) {
    console.log(`[remote-test] extract mode: SLOW (${options.agentBudgetMs ?? 30000}ms budget)`);
    console.log('[remote-test] example: npm run test:share-remote -- --slow-agent https://www.instagram.com/p/DEGl9lcSIsP/');
  }

  const accessToken = await resolveAccessToken(config);
  if (options.geminiSmoke) {
    await callGeminiSmoke(accessToken, config.processShareLinkUrl, options);
  }
  const summary: BatchSummary = {
    totalTested: 0,
    realGeminiCompletedCount: 0,
    timeoutRecoveryCount: 0,
    candidateConfirmationCount: 0,
    manualFallbackCount: 0,
    failedCount: 0,
    suspectedCorrectCandidates: 0,
    suspiciousCandidates: 0,
  };
  for (const url of urls) {
    const response = await callRemote(url, accessToken, config.processShareLinkUrl, options);
    if (!response?.extraction?.agent) continue;
    summary.totalTested += 1;
    if (response.extraction.realGeminiCompleted) summary.realGeminiCompletedCount += 1;
    if (response.extraction.timeoutRecoveryUsed) summary.timeoutRecoveryCount += 1;
    if (response.extraction.agent.userFacingDecision === 'candidate_confirmation') summary.candidateConfirmationCount += 1;
    if (response.extraction.agent.userFacingDecision === 'manual_fallback') summary.manualFallbackCount += 1;
    if (response.extraction.agent.userFacingDecision === 'failed') summary.failedCount += 1;
    if (candidateLooksPlausible(response.extraction)) summary.suspectedCorrectCandidates += 1;
    else summary.suspiciousCandidates += 1;
  }
  if (urls.length > 0) {
    printBatchSummary(summary);
  }
}

main().catch((error) => {
  console.error('[remote-test] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});