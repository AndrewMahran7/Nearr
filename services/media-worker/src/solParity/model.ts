import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractResponsesText, parseSolParityPayload } from './parser.js';
import { buildSolParityContext, SOL_PARITY_INSTRUCTIONS, SOL_PARITY_PROMPT_VERSION, SOL_PARITY_SCHEMA } from './prompt.js';
import { SOL_PARITY_MODEL, type FrameSet, type ModelArm, type SolParityPayload, type SolUsage, type SourceEvidence } from './types.js';
import {
  buildPremiumInferenceFingerprint,
  type PremiumEvidenceReuseState,
  type PremiumInferenceFingerprint,
} from '../premium/premiumInferenceFingerprint.js';

export const SOL_PARITY_KEY_VARIABLES = ['VAYRIN_OPENAI_API_KEY', 'OPENAI_API_KEY', 'MEDIA_TRANSCRIPTION_API_KEY'] as const;
export const SOL_PARITY_PRICING = Object.freeze({
  input_per_million_usd: 4,
  cached_input_per_million_usd: 0.4,
  output_per_million_usd: 20,
  source: 'official_gpt_5_6_sol_model_page_checked_2026_09_04',
});

export type SolCallResult = {
  model: string;
  prompt_version: string;
  web_search_enabled: boolean;
  images_only: boolean;
  latency_ms: number;
  usage: SolUsage;
  estimated_model_cost_usd: number | null;
  web_search_calls: number;
  web_search_queries: string[];
  web_search_sources: Array<{ title: string | null; url: string }>;
  response_id: string | null;
  response_status: string | null;
  raw_model_output: string | null;
  payload: SolParityPayload | null;
  failure: { kind: 'missing_key' | 'transport' | 'http' | 'malformed'; code: string } | null;
  input_lengths: { caption: number; transcript: number; ocr: number; location: number };
  frame_manifest: Array<{ timestamp_seconds: number; sha256: string; width: number; height: number; byte_length?: number; reason: string }>;
  /** Null only when replaying a pre-fingerprint historical artifact. */
  fingerprint: PremiumInferenceFingerprint | null;
};

function resolveKey(env: NodeJS.ProcessEnv): string | null {
  for (const name of SOL_PARITY_KEY_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function mime(filePath: string): string {
  if (path.extname(filePath).toLowerCase() === '.png') return 'image/png';
  if (path.extname(filePath).toLowerCase() === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function usage(value: unknown): SolUsage {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const inputDetails = raw.input_tokens_details && typeof raw.input_tokens_details === 'object'
    ? raw.input_tokens_details as Record<string, unknown> : {};
  const outputDetails = raw.output_tokens_details && typeof raw.output_tokens_details === 'object'
    ? raw.output_tokens_details as Record<string, unknown> : {};
  const number = (item: unknown) => typeof item === 'number' && Number.isFinite(item) ? item : null;
  return {
    input_tokens: number(raw.input_tokens),
    cached_input_tokens: number(inputDetails.cached_tokens),
    output_tokens: number(raw.output_tokens),
    reasoning_tokens: number(outputDetails.reasoning_tokens),
    total_tokens: number(raw.total_tokens),
  };
}

export function estimateSolModelCostUsd(value: SolUsage): number | null {
  if (value.input_tokens === null || value.output_tokens === null) return null;
  const cached = Math.min(value.cached_input_tokens ?? 0, value.input_tokens);
  const uncached = Math.max(0, value.input_tokens - cached);
  return Number((
    uncached / 1_000_000 * SOL_PARITY_PRICING.input_per_million_usd +
    cached / 1_000_000 * SOL_PARITY_PRICING.cached_input_per_million_usd +
    value.output_tokens / 1_000_000 * SOL_PARITY_PRICING.output_per_million_usd
  ).toFixed(6));
}

function webProvenance(body: unknown): { calls: number; queries: string[]; sources: Array<{ title: string | null; url: string }> } {
  const output = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).output)
    ? (body as Record<string, unknown>).output as unknown[] : [];
  let calls = 0;
  const queries: string[] = [];
  const sources = new Map<string, { title: string | null; url: string }>();
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (raw.type === 'web_search_call') calls += 1;
    const action = raw.action && typeof raw.action === 'object' ? raw.action as Record<string, unknown> : {};
    if (typeof action.query === 'string' && action.query.trim()) queries.push(action.query.trim().slice(0, 500));
    for (const candidate of Array.isArray(action.sources) ? action.sources : []) {
      if (!candidate || typeof candidate !== 'object') continue;
      const source = candidate as Record<string, unknown>;
      if (typeof source.url !== 'string' || !/^https?:\/\//.test(source.url)) continue;
      sources.set(source.url, { title: typeof source.title === 'string' ? source.title.slice(0, 240) : null, url: source.url });
    }
  }
  return { calls, queries, sources: [...sources.values()].slice(0, 50) };
}

export function modelArmUsesWebSearch(arm: ModelArm): boolean {
  return arm === 'M2' || arm === 'M3';
}

export async function callSolParity(args: {
  frameSet: FrameSet;
  modelArm: ModelArm;
  platform: string;
  canonicalUrl?: string;
  evidence: SourceEvidence;
  evidenceReuse?: PremiumEvidenceReuseState;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<SolCallResult> {
  const started = Date.now();
  const env = args.env ?? process.env;
  const webEnabled = modelArmUsesWebSearch(args.modelArm);
  const context = buildSolParityContext({ platform: args.platform, modelArm: args.modelArm, evidence: args.evidence });
  const frameManifest: SolCallResult['frame_manifest'] = [];
  const content: unknown[] = [{ type: 'input_text', text: context.text }];
  for (const frame of args.frameSet.frames) {
    const bytes = await readFile(frame.path);
    frameManifest.push({
      timestamp_seconds: frame.timestampSeconds,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: frame.width,
      height: frame.height,
      byte_length: bytes.byteLength,
      reason: frame.reason,
    });
    content.push({ type: 'input_text', text: `screenshot_timestamp_seconds: ${frame.timestampSeconds.toFixed(2)}` });
    content.push({ type: 'input_image', image_url: `data:${mime(frame.path)};base64,${bytes.toString('base64')}`, detail: 'high' });
  }
  const requestPayload = {
    model: SOL_PARITY_MODEL,
    instructions: SOL_PARITY_INSTRUCTIONS,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'sol_parity_destination', strict: true, schema: SOL_PARITY_SCHEMA } },
    reasoning: { effort: 'high' },
    store: false,
    ...(webEnabled ? { tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] } : {}),
  };
  const fingerprint = buildPremiumInferenceFingerprint({
    platform: args.platform,
    canonicalUrl: args.canonicalUrl ?? `unknown://${args.platform}`,
    evidence: args.evidence,
    modelArm: args.modelArm,
    frameManifest,
    inputText: context.text,
    requestPayload,
    evidenceReuse: args.evidenceReuse,
  });
  const emptyUsage = usage(null);
  const base = {
    model: SOL_PARITY_MODEL,
    prompt_version: SOL_PARITY_PROMPT_VERSION,
    web_search_enabled: webEnabled,
    images_only: args.modelArm === 'M3',
    input_lengths: context.lengths,
    frame_manifest: frameManifest,
    fingerprint,
  };
  const key = resolveKey(env);
  if (!key) return { ...base, latency_ms: Date.now() - started, usage: emptyUsage, estimated_model_cost_usd: null, web_search_calls: 0, web_search_queries: [], web_search_sources: [], response_id: null, response_status: null, raw_model_output: null, payload: null, failure: { kind: 'missing_key', code: 'missing_openai_key' } };

  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(requestPayload),
      signal: args.signal,
    });
  } catch {
    return { ...base, latency_ms: Date.now() - started, usage: emptyUsage, estimated_model_cost_usd: null, web_search_calls: 0, web_search_queries: [], web_search_sources: [], response_id: null, response_status: null, raw_model_output: null, payload: null, failure: { kind: 'transport', code: args.signal?.aborted ? 'aborted' : 'transport_error' } };
  }
  if (!response.ok) {
    return { ...base, latency_ms: Date.now() - started, usage: emptyUsage, estimated_model_cost_usd: null, web_search_calls: 0, web_search_queries: [], web_search_sources: [], response_id: null, response_status: null, raw_model_output: null, payload: null, failure: { kind: 'http', code: `http_${response.status}` } };
  }

  const body = await response.json().catch(() => null) as unknown;
  if (!body || typeof body !== 'object') {
    return { ...base, latency_ms: Date.now() - started, usage: emptyUsage, estimated_model_cost_usd: null, web_search_calls: 0, web_search_queries: [], web_search_sources: [], response_id: null, response_status: null, raw_model_output: null, payload: null, failure: { kind: 'malformed', code: 'response_not_json' } };
  }
  const rawBody = body as Record<string, unknown>;
  const output = extractResponsesText(body);
  let parsedJson: unknown = null;
  try { parsedJson = JSON.parse(output); } catch { /* classified below */ }
  const payload = parseSolParityPayload(parsedJson);
  const observedUsage = usage(rawBody.usage);
  const web = webProvenance(body);
  return {
    ...base,
    latency_ms: Date.now() - started,
    usage: observedUsage,
    estimated_model_cost_usd: estimateSolModelCostUsd(observedUsage),
    web_search_calls: web.calls,
    web_search_queries: web.queries,
    web_search_sources: web.sources,
    response_id: typeof rawBody.id === 'string' ? rawBody.id : null,
    response_status: typeof rawBody.status === 'string' ? rawBody.status : null,
    raw_model_output: output || null,
    payload,
    failure: payload ? null : { kind: 'malformed', code: output ? 'schema_mismatch' : 'empty_output' },
  };
}
