// services/media-worker/src/vayrin/visualGeolocationClient.ts
//
// The ONLY place in Nearr that talks to OpenAI for visual geolocation.
//
// Responsibilities, and nothing beyond them:
//   input normalization -> frame payload construction -> prompt/version ->
//   Responses API call -> structured-output parsing -> usage/latency capture ->
//   retry classification.
//
// Explicitly NOT here: candidate verification, Places lookup, auto-save
// decisions, job routing. Those stay in the deterministic Nearr layers that
// already own them, so this module can never become the thing that decides what
// gets saved.
//
// SECRETS. The key is read from the environment by `resolveVayrinApiKey` and
// nowhere else. It is never logged, never returned, never placed in a
// diagnostic, and never included in an error message. `describeKeySource()`
// reports which VARIABLE supplied it and how long it was — never the value —
// following the same convention as `redactedConfigSummary` in config/env.ts.
// This module is server-only: it lives in the media worker, which has no
// EXPO_PUBLIC_* variables and is never bundled into the Expo app.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  VAYRIN_GEOLOCATION_SCHEMA,
  VAYRIN_PROMPT_VERSION,
  VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT,
  buildVayrinUserContext,
  type VayrinTextContext,
} from './visualGeolocationPrompt.js';

/** Environment variables consulted for the OpenAI credential, in order.
 *
 *  `MEDIA_TRANSCRIPTION_API_KEY` is last and is deliberate: this repo already
 *  runs OpenAI Whisper through it (`MEDIA_TRANSCRIPTION_PROVIDER=openai`), so
 *  on a machine that can already transcribe, the harness works with no new
 *  secret to provision. Production should set a dedicated
 *  `VAYRIN_OPENAI_API_KEY` so the two can be rotated and budgeted separately. */
export const VAYRIN_API_KEY_VARIABLES = [
  'VAYRIN_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'MEDIA_TRANSCRIPTION_API_KEY',
] as const;

export type KeyResolution =
  | { ok: true; key: string; variable: string }
  | { ok: false; checked: readonly string[] };

/** Resolve the credential from the environment. Never logs, never returns it
 *  anywhere except the `key` field the caller passes straight to the API. */
export function resolveVayrinApiKey(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): KeyResolution {
  for (const variable of VAYRIN_API_KEY_VARIABLES) {
    const value = env[variable];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { ok: true, key: value.trim(), variable };
    }
  }
  return { ok: false, checked: VAYRIN_API_KEY_VARIABLES };
}

/** Safe-to-log description of the credential: whether it exists and which
 *  variable supplied it. Never any part or characteristic of the value. */
export function describeKeySource(resolution: KeyResolution): Record<string, unknown> {
  if (!resolution.ok) {
    return { hasApiKey: false, checkedVariables: [...resolution.checked] };
  }
  return {
    hasApiKey: true,
    apiKeyVariable: resolution.variable,
  };
}

export const DEFAULT_VAYRIN_MODEL = 'gpt-5.6-sol';
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';

export type VayrinFrameInput = {
  /** Absolute path to a JPEG, PNG, WEBP, or GIF frame. */
  path: string;
  timestampSeconds: number;
};

export type VayrinRequest = {
  frames: VayrinFrameInput[];
  context: VayrinTextContext;
  model?: string;
  endpoint?: string;
  /** Passed through to the API when the model supports it. */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
};

export type VayrinUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
};

export type VayrinPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

export function estimateVayrinCostUsd(
  usage: VayrinUsage,
  pricing: VayrinPricing,
): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cost =
    (uncached / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * pricing.cachedInputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return Number(cost.toFixed(6));
}

export type VayrinHypothesisRaw = {
  name: string;
  place_type: string;
  city: string | null;
  region: string | null;
  country: string | null;
  specificity: string;
  confidence: number;
  reasoning_summary: string;
  supporting_visual_clues: string[];
  supporting_textual_clues: string[];
  conflicting_clues: string[];
  needs_external_verification: boolean;
  evidence_basis?:
    | 'direct_visible_identity'
    | 'distinctive_visual_match'
    | 'contextual_or_memory_prior'
    | 'insufficient';
};

export type VayrinSegmentRaw = {
  frame_timestamps_seconds: number[];
  hypotheses: VayrinHypothesisRaw[];
};

export type VayrinPayload = {
  place_hypotheses: VayrinHypothesisRaw[];
  multiple_distinct_places_visible: boolean;
  additional_place_segments: VayrinSegmentRaw[];
  metadata_was_sufficient: boolean;
};

/** How a failure should be handled. Mirrors the worker's existing philosophy in
 *  `runMediaTask.planTaskFailure`: retry transport and provider-capacity
 *  problems, never retry a well-formed answer we merely dislike. */
export type VayrinFailureKind =
  | 'missing_key'
  | 'transient' //     429 / 5xx / network — safe to retry
  | 'permanent' //     4xx auth, bad request, unknown model — retrying repeats it
  | 'malformed' //     HTTP 200 whose body did not parse — a fresh call may help
  | 'no_frames';

export type VayrinResult =
  | {
      ok: true;
      payload: VayrinPayload;
      model: string;
      promptVersion: string;
      /** Frames selected/requested by the caller before file-read validation. */
      frameCount: number;
      /** Frames actually encoded into the Responses API payload. */
      sentFrameCount: number;
      sentTimestampsSeconds: number[];
      latencyMs: number;
      usage: VayrinUsage;
      /** Bounded preview for diagnostics. Never the full response. */
      rawPreview: string;
    }
  | {
      ok: false;
      kind: VayrinFailureKind;
      /** Closed-vocabulary code. Never contains a key, a token, or a header. */
      code: string;
      retryAfterSeconds: number | null;
      latencyMs: number;
      model: string;
      promptVersion: string;
      frameCount: number;
      sentFrameCount: number;
      sentTimestampsSeconds: number[];
    };

const EMPTY_USAGE: VayrinUsage = {
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
};

/** Encode one frame as a data URI image input. Frames are already scaled to
 *  768px wide by `extractFrames`, which is what keeps the image token cost
 *  bounded — do NOT send originals. */
function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

async function frameToImagePart(frame: VayrinFrameInput): Promise<unknown[] | null> {
  try {
    const bytes = await readFile(frame.path);
    return [
      { type: 'input_text', text: `frame_timestamp_seconds: ${frame.timestampSeconds.toFixed(2)}` },
      {
        type: 'input_image',
        image_url: `data:${imageMimeType(frame.path)};base64,${bytes.toString('base64')}`,
        detail: 'high',
      },
    ];
  } catch {
    return null; // an unreadable frame is skipped, never fatal
  }
}

function readUsage(raw: unknown): VayrinUsage {
  if (!raw || typeof raw !== 'object') return EMPTY_USAGE;
  const u = raw as Record<string, unknown>;
  const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  const inputDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    reasoningTokens: n(details.reasoning_tokens),
    totalTokens: n(u.total_tokens),
    cachedInputTokens: n(inputDetails.cached_tokens),
  };
}

/**
 * Pull the model's text out of a Responses API body.
 *
 * Handles `output_text` (the convenience field) and the canonical
 * `output[].content[].text` walk, because a reasoning model's `output` array
 * leads with a `reasoning` item that carries no text — indexing `output[0]`
 * would return nothing on exactly the model this is built for.
 */
export function extractResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;

  if (typeof b.output_text === 'string' && b.output_text.trim()) return b.output_text;
  if (Array.isArray(b.output_text)) return b.output_text.filter((x) => typeof x === 'string').join('');

  const output = Array.isArray(b.output) ? b.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string') chunks.push(p.text);
    }
  }
  return chunks.join('');
}

/** Structural validation of the model payload. Returns null on anything that is
 *  not the agreed shape, so a malformed response fails SAFELY (no hypotheses)
 *  instead of propagating half-parsed junk into place resolution. */
export function parseVayrinPayload(raw: unknown): VayrinPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.place_hypotheses)) return null;

  const hypotheses = r.place_hypotheses
    .map(parseHypothesis)
    .filter((h): h is VayrinHypothesisRaw => h !== null);

  const segments = Array.isArray(r.additional_place_segments)
    ? r.additional_place_segments
        .map(parseSegment)
        .filter((s): s is VayrinSegmentRaw => s !== null)
    : [];

  return {
    place_hypotheses: hypotheses,
    multiple_distinct_places_visible: r.multiple_distinct_places_visible === true,
    additional_place_segments: segments,
    metadata_was_sufficient: r.metadata_was_sufficient === true,
  };
}

const SPECIFICITY_VALUES = new Set([
  'exact_location',
  'venue',
  'landmark',
  'natural_feature',
  'neighborhood',
  'city',
  'region',
  'country',
]);

function strOrNull(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function strList(v: unknown, maxItems = 12, maxLen = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => strOrNull(x, maxLen))
    .filter((x): x is string => x !== null)
    .slice(0, maxItems);
}

function parseHypothesis(raw: unknown): VayrinHypothesisRaw | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const specificity = typeof r.specificity === 'string' ? r.specificity : '';
  if (!SPECIFICITY_VALUES.has(specificity)) return null;

  const name = strOrNull(r.name, 200);
  const city = strOrNull(r.city, 120);
  const region = strOrNull(r.region, 120);
  const country = strOrNull(r.country, 120);
  // A hypothesis that names nothing at any level locates nothing.
  if (!name && !city && !region && !country) return null;

  const confidence =
    typeof r.confidence === 'number' && Number.isFinite(r.confidence)
      ? Math.max(0, Math.min(1, r.confidence))
      : 0;
  const evidenceBasis =
    r.evidence_basis === 'direct_visible_identity' ||
    r.evidence_basis === 'distinctive_visual_match' ||
    r.evidence_basis === 'contextual_or_memory_prior' ||
    r.evidence_basis === 'insufficient'
      ? r.evidence_basis
      : 'contextual_or_memory_prior';

  return {
    name: name ?? '',
    place_type: strOrNull(r.place_type, 80) ?? '',
    city,
    region,
    country,
    specificity,
    confidence,
    reasoning_summary: strOrNull(r.reasoning_summary, 600) ?? '',
    supporting_visual_clues: strList(r.supporting_visual_clues),
    supporting_textual_clues: strList(r.supporting_textual_clues),
    conflicting_clues: strList(r.conflicting_clues),
    needs_external_verification: r.needs_external_verification !== false,
    evidence_basis: evidenceBasis,
  };
}

function parseSegment(raw: unknown): VayrinSegmentRaw | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hypotheses = Array.isArray(r.hypotheses)
    ? r.hypotheses.map(parseHypothesis).filter((h): h is VayrinHypothesisRaw => h !== null)
    : [];
  if (hypotheses.length === 0) return null;
  const timestamps = Array.isArray(r.frame_timestamps_seconds)
    ? r.frame_timestamps_seconds
        .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0)
        .slice(0, 64)
    : [];
  return { frame_timestamps_seconds: timestamps, hypotheses };
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Run one visual-geolocation call.
 *
 * Never throws for an API-level problem — every failure comes back as
 * `{ ok:false }` with a classified `kind`, so callers make retry decisions from
 * a closed vocabulary instead of by inspecting exception text.
 */
export async function runVisualGeolocation(request: VayrinRequest): Promise<VayrinResult> {
  const model = request.model?.trim() || DEFAULT_VAYRIN_MODEL;
  const endpoint = request.endpoint?.trim() || DEFAULT_ENDPOINT;
  const frameCount = request.frames.length;
  const sentTimestampsSeconds: number[] = [];
  const started = Date.now();

  const base = () => ({
    model,
    promptVersion: VAYRIN_PROMPT_VERSION,
    frameCount,
    sentFrameCount: sentTimestampsSeconds.length,
    sentTimestampsSeconds: [...sentTimestampsSeconds],
  });
  const fail = (
    kind: VayrinFailureKind,
    code: string,
    retryAfterSeconds: number | null = null,
  ): VayrinResult => ({
    ok: false,
    kind,
    code,
    retryAfterSeconds,
    latencyMs: Date.now() - started,
    ...base(),
  });

  if (frameCount === 0) return fail('no_frames', 'vayrin_no_frames');

  const resolution = resolveVayrinApiKey(request.env);
  if (!resolution.ok) return fail('missing_key', 'vayrin_missing_api_key');

  const content: unknown[] = [{ type: 'input_text', text: buildVayrinUserContext(request.context) }];
  for (const frame of request.frames) {
    const parts = await frameToImagePart(frame);
    if (parts) {
      content.push(...parts);
      sentTimestampsSeconds.push(frame.timestampSeconds);
    }
  }
  // Every frame was unreadable — the same state as having no frames.
  if (content.length === 1) return fail('no_frames', 'vayrin_frames_unreadable');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${resolution.key}`,
      },
      body: JSON.stringify({
        model,
        instructions: VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'vayrin_geolocation',
            strict: true,
            schema: VAYRIN_GEOLOCATION_SCHEMA,
          },
        },
        store: false,
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) return fail('transient', 'vayrin_aborted');
    // Deliberately does NOT include the error message: a transport error can
    // echo back the request, and the request carries the Authorization header.
    return fail('transient', 'vayrin_transport_error');
  }

  if (!response.ok) {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const status = response.status;
    if (status === 429 || status >= 500) {
      return fail('transient', `vayrin_http_${status}`, retryAfter);
    }
    return fail('permanent', `vayrin_http_${status}`, retryAfter);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail('malformed', 'vayrin_response_not_json');
  }

  const text = extractResponseText(body);
  if (!text.trim()) return fail('malformed', 'vayrin_empty_output');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return fail('malformed', 'vayrin_output_not_json');
  }

  const payload = parseVayrinPayload(parsedJson);
  if (!payload) return fail('malformed', 'vayrin_schema_mismatch');

  return {
    ok: true,
    payload,
    latencyMs: Date.now() - started,
    usage: readUsage((body as Record<string, unknown>).usage),
    rawPreview: text.slice(0, 800),
    ...base(),
  };
}

/** Whether a failure is worth another attempt. Retries transport and capacity
 *  problems only. A weak or unwelcome ANSWER is never retried — that is a
 *  result, not a fault, and re-rolling it is how a pipeline starts paying for
 *  the answer it wanted rather than the one the evidence supports. */
export function isRetryableFailure(kind: VayrinFailureKind): boolean {
  return kind === 'transient';
}
