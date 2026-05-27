/**
 * evalShareGold.ts
 *
 * Reads artifacts/share-gold-labeling-labeled.json, runs every URL through the
 * same remote process-share-link backend used by `npm run test:share-remote`,
 * compares actual backend output against the expected labels, and writes:
 *   - artifacts/share-gold-results.json
 *   - artifacts/share-gold-results.csv
 *   - artifacts/share-gold-summary.md
 *
 * Evaluation/reporting only. Does NOT change extraction, safety, or UI logic.
 */

import * as fs from 'fs';
import * as path from 'path';

import { createClient } from '@supabase/supabase-js';
import { compactNameMatches } from '../lib/shareAgent/recoveryHints';

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

type LabeledRow = {
  category?: string;
  url: string;
  expected_place_name?: string;
  expected_address?: string;
  expected_decision?: string;
  label_notes?: string;
  [key: string]: unknown;
};

type ResultRow = {
  category: string;
  url: string;
  expected_place_name: string;
  expected_address: string;
  expected_decision: string;
  label_notes: string;
  backend_status: string;
  actual_candidate_name: string;
  actual_candidate_address: string;
  actual_candidate_place_id: string;
  actual_decision: string;
  safe_to_auto_save: string;
  confidence: string;
  evidence_used: string;
  warnings: string;
  places_queries: string;
  top_candidates: string;
  error_message: string;
  decision_pass: boolean;
  place_pass: boolean | null;
  overall_result: 'pass' | 'partial' | 'fail';
  failure_type: string;
  notes: string;
};

const DEFAULT_EMAIL = 'dev@nearr.test';
const DEFAULT_PASSWORD = 'devpass123';
const INPUT_JSON = 'artifacts/share-gold-labeling-labeled.json';
const OUTPUT_JSON = 'artifacts/share-gold-results.json';
const OUTPUT_CSV = 'artifacts/share-gold-results.csv';
const OUTPUT_MD = 'artifacts/share-gold-summary.md';
const MAX_ATTEMPTS = 3; // initial + 2 retries
const RETRY_DELAY_MS = 1500;
const PER_REQUEST_DELAY_MS = 400;

const FAILURE_TYPES = [
  'wrong_place',
  'wrong_country_or_city',
  'generic_address_card',
  'missed_name_from_caption',
  'missed_handle_candidate',
  'compact_handle_name_mismatch',
  'multi_place_should_manual_fallback',
  'manual_fallback_should_candidate',
  'candidate_should_manual_fallback',
  'unexpected_safe_save',
  'expected_safe_save_but_candidate',
  'gemini_timeout',
  'places_query_bad',
  'backend_error',
  'unknown',
];

// ---------------- env / auth (mirrors testProcessShareLinkRemote.ts) ----------------

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
    console.log('[share-gold-eval] Using NEARR_TEST_ACCESS_TOKEN from env');
    return config.accessToken;
  }
  if (config.usedDefaultCredentials) {
    console.log(
      `[share-gold-eval] NEARR_TEST_EMAIL / NEARR_TEST_PASSWORD missing; using defaults ${DEFAULT_EMAIL} / ${DEFAULT_PASSWORD}`,
    );
  } else {
    console.log(`[share-gold-eval] Signing in as ${config.email}`);
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
  console.log('[share-gold-eval] Sign-in succeeded; access token acquired');
  return token;
}

// ---------------- remote call ----------------

type RemoteResult = {
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
    return { httpStatus: response.status, latencyMs, parsed, rawText };
  } catch (error) {
    return {
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

// ---------------- helpers ----------------

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

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, '');
}

const COUNTRY_TOKENS = new Set([
  'usa',
  'us',
  'united',
  'states',
  'united states',
  'america',
]);

function normalizeAddress(value: string): {
  full: string;
  compact: string;
  tokens: string[];
  streetNumber: string | null;
  streetName: string;
  cityState: string;
} {
  const cleaned = (value || '')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ') // strip ZIPs
    .replace(/,\s*(usa|us|united states)\b/gi, ' ')
    .replace(/\b(usa|united states)\b/gi, ' ');
  const norm = normalizeText(cleaned);
  const tokens = norm.split(/\s+/).filter((t) => t && !COUNTRY_TOKENS.has(t));
  const numberMatch = norm.match(/\b(\d{1,6})\b/);
  const streetNumber = numberMatch ? numberMatch[1] : null;
  // crude split: street section ends before the last 2-3 tokens (city/state)
  const head = tokens.slice(0, Math.max(1, tokens.length - 3)).join(' ');
  const tail = tokens.slice(-3).join(' ');
  return {
    full: tokens.join(' '),
    compact: tokens.join(''),
    tokens,
    streetNumber,
    streetName: head,
    cityState: tail,
  };
}

function namesMatch(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const e = normalizeText(expected);
  const a = normalizeText(actual);
  if (!e || !a) return false;
  if (e === a) return true;
  if (a.includes(e) || e.includes(a)) return true;
  const ec = normalizeCompact(expected);
  const ac = normalizeCompact(actual);
  if (ec && ac && (ac.includes(ec) || ec.includes(ac))) return true;
  // 2026-05-27 — Patch 2: shared compact-name matcher handles
  // suffix-stripped (`bajasharkeeznb` ↔ `Baja Sharkeez`) and
  // generic-stripped (`phobamboorestaurant` ↔ `Pho Bamboo Vietnamese
  // Restaurant`) variants the prior tiers miss.
  if (compactNameMatches(expected, actual)) return true;
  // token overlap on meaningful (>=4 char) tokens
  const eTokens = e.split(' ').filter((t) => t.length >= 4);
  const aTokens = new Set(a.split(' '));
  if (eTokens.length > 0 && eTokens.every((t) => aTokens.has(t))) return true;
  return false;
}

function addressesMatch(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const e = normalizeAddress(expected);
  const a = normalizeAddress(actual);
  if (!e.tokens.length || !a.tokens.length) return false;
  if (e.full === a.full) return true;
  // Require: same street number AND street name overlap AND city/state overlap.
  const sameNumber = e.streetNumber && a.streetNumber && e.streetNumber === a.streetNumber;
  if (!sameNumber) {
    // If neither side has numbers, allow strong containment
    if (!e.streetNumber && !a.streetNumber) {
      if (a.full.includes(e.full) || e.full.includes(a.full)) return true;
    }
    return false;
  }
  const streetTokens = e.streetName.split(' ').filter((t) => t.length >= 3 && t !== e.streetNumber);
  const aFullSet = new Set(a.full.split(' '));
  const streetOverlap =
    streetTokens.length === 0 || streetTokens.some((t) => aFullSet.has(t));
  const cityTokens = e.cityState.split(' ').filter((t) => t.length >= 2);
  const cityOverlap = cityTokens.length === 0 || cityTokens.some((t) => aFullSet.has(t));
  return Boolean(sameNumber && streetOverlap && cityOverlap);
}

function decisionEquivalent(expected: string, actual: string): boolean {
  const e = (expected || '').trim().toLowerCase();
  const a = (actual || '').trim().toLowerCase();
  if (!e || !a) return false;
  if (e === a) return true;
  // expected safe_save ~ actual auto_save / safe_save / safe_to_auto_save=true mapped to 'safe_save'
  const safeSaveAliases = new Set(['safe_save', 'auto_save', 'safe_to_auto_save', 'autosave']);
  if (safeSaveAliases.has(e) && safeSaveAliases.has(a)) return true;
  return false;
}

function labelAllowsCandidateAcceptable(labelNotes: string): boolean {
  if (!labelNotes) return false;
  return /candidate\s+acceptable/i.test(labelNotes);
}

// ---------------- extraction of backend fields ----------------

function extractActualFields(parsed: Record<string, any> | null): {
  backend_status: string;
  candidate_name: string;
  candidate_address: string;
  candidate_place_id: string;
  decision: string;
  safe_to_auto_save: string;
  confidence: string;
  evidence_used: string;
  warnings: string;
  warnings_array: string[];
  places_queries: string;
  top_candidates: string;
  tool_calls: any[];
} {
  const response = parsed ?? {};
  const extraction = (response.extraction as Record<string, any> | undefined) ?? {};
  const agent = (extraction.agent as Record<string, any> | undefined) ?? {};
  const candidates = Array.isArray(agent.candidates) ? (agent.candidates as any[]) : [];
  const finalCandidates = Array.isArray(extraction.finalCandidates)
    ? (extraction.finalCandidates as any[])
    : [];
  const toolCalls = Array.isArray(agent.toolCalls) ? (agent.toolCalls as any[]) : [];

  const resolved = (agent.resolvedPlace as Record<string, any> | undefined) ?? null;
  const primary = resolved ?? candidates[0] ?? finalCandidates[0] ?? null;
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
  const warnings = asStringArray(agent.warnings);

  return {
    backend_status: asString(response.status),
    candidate_name: primary ? asString(primary.name ?? primary.placeName) : '',
    candidate_address: primary
      ? asString(primary.formattedAddress ?? primary.address)
      : '',
    candidate_place_id: primary ? asString(primary.googlePlaceId ?? primary.placeId) : '',
    decision: asString(agent.userFacingDecision),
    safe_to_auto_save:
      typeof agent.safeToAutoSave === 'boolean' ? String(agent.safeToAutoSave) : '',
    confidence: asString(agent.confidence),
    evidence_used: asStringArray(agent.evidenceUsed).join('; '),
    warnings: warnings.join('; '),
    warnings_array: warnings,
    places_queries: placesQueries.join(' || '),
    top_candidates: topCandidates.join(' || '),
    tool_calls: toolCalls,
  };
}

// ---------------- comparison + failure classification ----------------

function classifyFailure(args: {
  expectedDecision: string;
  actualDecision: string;
  expectedName: string;
  expectedAddress: string;
  actualName: string;
  actualAddress: string;
  decisionPass: boolean;
  placePass: boolean | null;
  warnings: string[];
  backendStatus: string;
  errorMessage: string;
  toolCalls: any[];
  topCandidates: string;
  category: string;
}): string {
  const {
    expectedDecision,
    actualDecision,
    expectedName,
    expectedAddress,
    actualName,
    actualAddress,
    decisionPass,
    placePass,
    warnings,
    backendStatus,
    errorMessage,
    toolCalls,
    topCandidates,
    category,
  } = args;

  if (errorMessage || backendStatus === 'failed' || (backendStatus && backendStatus !== 'extracted')) {
    return 'backend_error';
  }
  const warningsBlob = warnings.join(' ').toLowerCase();
  if (
    warningsBlob.includes('timeout') &&
    (warningsBlob.includes('gemini') || warningsBlob.includes('agent_timeout'))
  ) {
    return 'gemini_timeout';
  }
  const placesFailed = toolCalls.some(
    (t) =>
      typeof t?.tool === 'string' &&
      t.tool.toLowerCase().includes('place') &&
      t.status &&
      t.status !== 'ok',
  );

  const ed = (expectedDecision || '').trim().toLowerCase();
  const ad = (actualDecision || '').trim().toLowerCase();

  if (!decisionPass) {
    if (ed === 'manual_fallback' && (ad === 'candidate_confirmation' || ad === 'safe_save' || ad === 'auto_save')) {
      // Backend produced a place when it shouldn't have
      if (/(multiple|several|round[\- ]up|list of|each|various)/i.test(`${expectedName} ${args.category}`)) {
        return 'multi_place_should_manual_fallback';
      }
      if (ad === 'safe_save' || ad === 'auto_save') return 'unexpected_safe_save';
      return 'candidate_should_manual_fallback';
    }
    if (ed === 'candidate_confirmation' && ad === 'manual_fallback') {
      return 'manual_fallback_should_candidate';
    }
    if ((ed === 'safe_save' || ed === 'auto_save') && ad === 'candidate_confirmation') {
      return 'expected_safe_save_but_candidate';
    }
    if ((ed === 'safe_save' || ed === 'auto_save') && ad === 'manual_fallback') {
      return 'manual_fallback_should_candidate';
    }
  }

  if (placePass === false) {
    // Pick a more specific bucket
    const en = normalizeText(expectedName);
    const an = normalizeText(actualName);
    const eAddrNorm = normalizeAddress(expectedAddress);
    const aAddrNorm = normalizeAddress(actualAddress);
    // generic_address_card: actual candidate name looks like an address (digits + street)
    if (an && /^\s*\d+\s+/.test(an) && an.split(' ').length <= 5) {
      return 'generic_address_card';
    }
    // compact handle vs spaced name (e.g. "Paradise Dynasty" vs "Paradisedynasty")
    if (
      en &&
      an &&
      (normalizeCompact(expectedName).includes(normalizeCompact(actualName)) ||
        normalizeCompact(actualName).includes(normalizeCompact(expectedName)))
    ) {
      return 'compact_handle_name_mismatch';
    }
    // wrong city/country if address numbers match but city tokens diverge
    if (
      eAddrNorm.cityState &&
      aAddrNorm.cityState &&
      !eAddrNorm.cityState.split(' ').some((t) => aAddrNorm.cityState.includes(t))
    ) {
      return 'wrong_country_or_city';
    }
    // missed name from caption: expected name nonempty, actual name empty/generic
    if (en && !an) return 'missed_name_from_caption';
    if (en && an && !namesMatch(expectedName, actualName)) {
      // Could indicate missed handle candidate if top_candidates lacks expected
      if (topCandidates && !normalizeText(topCandidates).includes(en.split(' ')[0])) {
        return 'missed_handle_candidate';
      }
      return 'wrong_place';
    }
  }

  if (placesFailed) return 'places_query_bad';

  return 'unknown';
}

function evaluateRow(labeled: LabeledRow, result: RemoteResult): ResultRow {
  const actual = extractActualFields(result.parsed);
  let errorMessage = '';
  if (result.requestError) errorMessage = result.requestError;
  else if (!result.parsed) errorMessage = `http ${result.httpStatus}: non-JSON body`;
  else if (result.httpStatus >= 400 && !actual.backend_status) errorMessage = `http ${result.httpStatus}`;

  const expectedName = (labeled.expected_place_name ?? '').toString().trim();
  const expectedAddress = (labeled.expected_address ?? '').toString().trim();
  const expectedDecision = (labeled.expected_decision ?? '').toString().trim();
  const labelNotes = (labeled.label_notes ?? '').toString();
  const category = (labeled.category ?? '').toString();

  let decisionPass = decisionEquivalent(expectedDecision, actual.decision);
  // Allow safe_save expectation to be satisfied if backend says candidate_confirmation
  // but labels say candidate acceptable (treated as partial later).
  let partialFromNotes = false;
  if (
    !decisionPass &&
    labelAllowsCandidateAcceptable(labelNotes) &&
    actual.decision === 'candidate_confirmation'
  ) {
    partialFromNotes = true;
  }

  // Place comparison
  let placePass: boolean | null = null;
  const expectSkipPlace =
    !expectedName ||
    expectedDecision.toLowerCase() === 'manual_fallback';
  if (!expectSkipPlace) {
    const nameOk = namesMatch(expectedName, actual.candidate_name);
    const addrOk = expectedAddress
      ? addressesMatch(expectedAddress, actual.candidate_address)
      : null;
    if (addrOk === null) {
      placePass = nameOk;
    } else {
      placePass = nameOk && addrOk;
    }
  }

  let overall: 'pass' | 'partial' | 'fail';
  const notesParts: string[] = [];
  if (errorMessage) {
    overall = 'fail';
    notesParts.push(`request: ${errorMessage}`);
  } else if (expectSkipPlace) {
    // Decision-only judgement.
    overall = decisionPass ? 'pass' : 'fail';
  } else {
    if (decisionPass && placePass) overall = 'pass';
    else if ((decisionPass && placePass === false) || (!decisionPass && placePass)) overall = 'partial';
    else if (partialFromNotes && placePass) overall = 'partial';
    else overall = 'fail';
  }
  if (partialFromNotes && overall === 'pass') overall = 'partial';
  if (partialFromNotes) notesParts.push('label_notes: candidate acceptable');

  const failure_type = overall === 'pass' ? '' : classifyFailure({
    expectedDecision,
    actualDecision: actual.decision,
    expectedName,
    expectedAddress,
    actualName: actual.candidate_name,
    actualAddress: actual.candidate_address,
    decisionPass,
    placePass,
    warnings: actual.warnings_array,
    backendStatus: actual.backend_status,
    errorMessage,
    toolCalls: actual.tool_calls,
    topCandidates: actual.top_candidates,
    category,
  });

  return {
    category,
    url: labeled.url,
    expected_place_name: expectedName,
    expected_address: expectedAddress,
    expected_decision: expectedDecision,
    label_notes: labelNotes,
    backend_status: actual.backend_status,
    actual_candidate_name: actual.candidate_name,
    actual_candidate_address: actual.candidate_address,
    actual_candidate_place_id: actual.candidate_place_id,
    actual_decision: actual.decision,
    safe_to_auto_save: actual.safe_to_auto_save,
    confidence: actual.confidence,
    evidence_used: actual.evidence_used,
    warnings: actual.warnings,
    places_queries: actual.places_queries,
    top_candidates: actual.top_candidates,
    error_message: errorMessage,
    decision_pass: decisionPass,
    place_pass: placePass,
    overall_result: overall,
    failure_type,
    notes: notesParts.join('; '),
  };
}

// ---------------- output writers ----------------

function csvEscape(value: string | number | boolean | null): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: ResultRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]) as (keyof ResultRow)[];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => csvEscape(row[h] as string | number | boolean | null))
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function buildSummaryMarkdown(rows: ResultRow[]): string {
  const total = rows.length;
  const passCount = rows.filter((r) => r.overall_result === 'pass').length;
  const partialCount = rows.filter((r) => r.overall_result === 'partial').length;
  const failCount = rows.filter((r) => r.overall_result === 'fail').length;
  const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0';

  const byCategory = new Map<string, { total: number; pass: number; partial: number; fail: number }>();
  for (const r of rows) {
    const key = r.category || '(uncategorized)';
    const bucket = byCategory.get(key) ?? { total: 0, pass: 0, partial: 0, fail: 0 };
    bucket.total += 1;
    if (r.overall_result === 'pass') bucket.pass += 1;
    else if (r.overall_result === 'partial') bucket.partial += 1;
    else bucket.fail += 1;
    byCategory.set(key, bucket);
  }

  const failureCounts = new Map<string, number>();
  for (const ft of FAILURE_TYPES) failureCounts.set(ft, 0);
  for (const r of rows) {
    if (r.overall_result !== 'pass' && r.failure_type) {
      failureCounts.set(r.failure_type, (failureCounts.get(r.failure_type) ?? 0) + 1);
    }
  }

  const worst = rows
    .filter((r) => r.overall_result === 'fail')
    .slice(0, 10);

  const recommendations = buildRecommendations(rows, failureCounts);

  const lines: string[] = [];
  lines.push('# Share Gold Set Evaluation Summary');
  lines.push('');
  lines.push(`- Total rows: ${total}`);
  lines.push(`- Pass: ${passCount}`);
  lines.push(`- Partial: ${partialCount}`);
  lines.push(`- Fail: ${failCount}`);
  lines.push(`- Pass rate: ${passRate}%`);
  lines.push('');
  lines.push('## Pass rate by category');
  lines.push('');
  lines.push('| Category | Total | Pass | Partial | Fail | Pass % |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [cat, b] of byCategory) {
    const pct = b.total > 0 ? ((b.pass / b.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${cat} | ${b.total} | ${b.pass} | ${b.partial} | ${b.fail} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## Failures by type');
  lines.push('');
  lines.push('| Failure type | Count |');
  lines.push('| --- | ---: |');
  for (const ft of FAILURE_TYPES) {
    const count = failureCounts.get(ft) ?? 0;
    if (count > 0) lines.push(`| ${ft} | ${count} |`);
  }
  if ([...failureCounts.values()].every((v) => v === 0)) {
    lines.push('| (none) | 0 |');
  }
  lines.push('');
  lines.push('## Top 10 worst failures');
  lines.push('');
  if (worst.length === 0) {
    lines.push('_No outright failures._');
  } else {
    lines.push('| # | URL | Expected | Actual | Reason |');
    lines.push('| ---: | --- | --- | --- | --- |');
    worst.forEach((r, i) => {
      const expected = `${r.expected_place_name || '(none)'} @ ${r.expected_address || '(none)'} [${r.expected_decision || '(none)'}]`;
      const actual = `${r.actual_candidate_name || '(none)'} @ ${r.actual_candidate_address || '(none)'} [${r.actual_decision || '(none)'}]`;
      const reason = r.failure_type || 'unknown';
      lines.push(`| ${i + 1} | ${r.url} | ${escapeMd(expected)} | ${escapeMd(actual)} | ${reason} |`);
    });
  }
  lines.push('');
  lines.push('## Recommendations (ranked by impact)');
  lines.push('');
  if (recommendations.length === 0) {
    lines.push('_No recommendations — looking healthy._');
  } else {
    recommendations.forEach((rec, i) => {
      lines.push(`${i + 1}. **${rec.failureType}** (${rec.count} cases) — ${rec.recommendation}`);
    });
  }
  lines.push('');
  return lines.join('\n');
}

function escapeMd(value: string): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildRecommendations(
  rows: ResultRow[],
  failureCounts: Map<string, number>,
): Array<{ failureType: string; count: number; recommendation: string }> {
  const map: Record<string, string> = {
    wrong_place:
      'Audit Places query construction — the agent is picking the wrong establishment. Boost weight of caption-provided venue name and require name+address co-presence in the chosen candidate.',
    wrong_country_or_city:
      'Add a region/locality sanity check before accepting Places candidates; reject results whose city/state diverges from the caption-extracted city/state.',
    generic_address_card:
      'Reject Places results whose name is just the street address (no business name) when a venue name is present in the caption or poster handle.',
    missed_name_from_caption:
      'Improve caption parsing to lift explicit venue names (📍 lines, "at <Name>", title prefix) into the Places query before searching by handle alone.',
    missed_handle_candidate:
      'When the only signal is an @handle, try a Places query derived from the handle (split camelCase / underscores) and the poster display name in addition to caption text.',
    compact_handle_name_mismatch:
      'Normalize compact handles (no spaces) to spaced candidate names when scoring matches so "paradisedynasty" matches "Paradise Dynasty".',
    multi_place_should_manual_fallback:
      'Detect roundup/multi-place posts (lists, numbered items, "5 places") and route to manual_fallback instead of confirming a single candidate.',
    manual_fallback_should_candidate:
      'Loosen manual_fallback triggers when caption has explicit name AND address with a single matching Places candidate.',
    candidate_should_manual_fallback:
      'Tighten candidate_confirmation when evidence is weak (no caption address, low places score) — prefer manual_fallback.',
    unexpected_safe_save:
      'Raise the auto-save threshold; require strong places match + caption address + non-roundup post.',
    expected_safe_save_but_candidate:
      'When evidence is unambiguous (caption name + caption address + exact Places hit), allow safe_save instead of always asking for confirmation.',
    gemini_timeout:
      'Increase Gemini timeout or fall back to a faster model on timeout; ensure timeout recovery path keeps caption-derived address.',
    places_query_bad:
      'Inspect failing Places tool calls; ensure queries are well-formed and include city/state context from caption.',
    backend_error:
      'Investigate non-extracted backend statuses / HTTP errors before scoring extraction quality.',
    unknown:
      'Manually review these — current heuristics did not classify the failure mode.',
  };
  const result: Array<{ failureType: string; count: number; recommendation: string }> = [];
  for (const ft of FAILURE_TYPES) {
    const count = failureCounts.get(ft) ?? 0;
    if (count > 0) {
      result.push({ failureType: ft, count, recommendation: map[ft] ?? '' });
    }
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}

// ---------------- main ----------------

async function main(): Promise<void> {
  const config = getConfig();
  const inputPath = path.resolve(process.cwd(), INPUT_JSON);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const labeled = JSON.parse(raw) as LabeledRow[];
  if (!Array.isArray(labeled) || labeled.length === 0) {
    throw new Error(`No rows in ${INPUT_JSON}`);
  }

  console.log('[share-gold-eval] gold-set evaluator');
  console.log(`[share-gold-eval] endpoint: ${config.processShareLinkUrl}`);
  console.log(`[share-gold-eval] .env loaded: ${config.loadedEnvPath ?? '(not found)'}`);
  console.log(`[share-gold-eval] input: ${inputPath}`);
  console.log(`[share-gold-eval] rows: ${labeled.length}`);

  const accessToken = await resolveAccessToken(config);
  const results: ResultRow[] = [];

  for (let i = 0; i < labeled.length; i += 1) {
    const row = labeled[i];
    let evaluated: ResultRow;
    try {
      const remote = await callRemoteWithRetry(row.url, accessToken, config.processShareLinkUrl);
      evaluated = evaluateRow(row, remote);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      evaluated = evaluateRow(row, {
        httpStatus: 0,
        latencyMs: 0,
        parsed: null,
        rawText: '',
        requestError: message,
      });
    }
    results.push(evaluated);
    console.log(
      `[share-gold-eval] ${i + 1}/${labeled.length} category="${evaluated.category}" status=${evaluated.overall_result} url=${evaluated.url}${evaluated.failure_type ? ` failure=${evaluated.failure_type}` : ''}`,
    );
    if (i + 1 < labeled.length) {
      await new Promise((resolve) => setTimeout(resolve, PER_REQUEST_DELAY_MS));
    }
  }

  fs.mkdirSync(path.resolve(process.cwd(), 'artifacts'), { recursive: true });
  const jsonPath = path.resolve(process.cwd(), OUTPUT_JSON);
  const csvPath = path.resolve(process.cwd(), OUTPUT_CSV);
  const mdPath = path.resolve(process.cwd(), OUTPUT_MD);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  fs.writeFileSync(csvPath, rowsToCsv(results), 'utf8');
  fs.writeFileSync(mdPath, buildSummaryMarkdown(results), 'utf8');

  const pass = results.filter((r) => r.overall_result === 'pass').length;
  const partial = results.filter((r) => r.overall_result === 'partial').length;
  const fail = results.filter((r) => r.overall_result === 'fail').length;
  console.log('');
  console.log(`[share-gold-eval] pass=${pass} partial=${partial} fail=${fail} total=${results.length}`);
  console.log(`[share-gold-eval] json: ${jsonPath}`);
  console.log(`[share-gold-eval] csv: ${csvPath}`);
  console.log(`[share-gold-eval] summary: ${mdPath}`);
}

main().catch((error) => {
  console.error(`[share-gold-eval] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
