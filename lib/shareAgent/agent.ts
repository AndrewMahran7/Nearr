/**
 * Backend-first share-extraction AI agent. SHADOW MODE ONLY (Stage 1).
 *
 * This module wraps a single Gemini call that is given:
 *   - the share URL + platform
 *   - title / description (already fetched)
 *   - detected handles
 *   - optional profile enrichment results
 *   - optional Places search results (when the agent asks for them)
 *
 * The agent must:
 *   - Reason from raw evidence (not regex overfits).
 *   - Cite evidence and tools used.
 *   - Explain why it chose a venue and why it rejected alternatives.
 *   - Output a structured ExtractionProposal.
 *
 * The deterministic safety gate (lib/shareAgent/safety.ts) then enforces
 * what is actually safe to auto-save.
 *
 * Architectural rules:
 *   - This module MUST NOT throw. All failures degrade to a `failed`
 *     proposal so the orchestrator can persist a shadow run.
 *   - This module MUST NOT be imported by React Native client code.
 *   - This module MUST NOT expose API keys to its caller. Keys are passed
 *     in via the env argument.
 */

import {
  compareCandidateToEvidence,
  detectHandles,
  fetchProfileBio,
  fetchTranscript,
  searchPlaces,
  type DetectedHandles,
  type LocationBias,
  type PlacesSearchCandidate,
  type ProfileBioResult,
} from './tools.ts';
import { applySafety } from './safety.ts';
import {
  buildCleanPlacesQueries,
  cleanPlacesSeed,
  extractLikelyAddress,
  type LikelyAddress,
} from './queryCleaner.ts';
import {
  derivePlaceNameHintFromHandle,
  extractCaptionVenueHints,
  extractCityStateContext,
  extractVenueHandleCandidates,
  isGenericAddressCard,
  isWrongLocationCandidate,
} from './recoveryHints.ts';
import type {
  AgentCandidate,
  AgentConfidence,
  AgentDebug,
  AgentDecision,
  AgentResponse,
  AgentStageTimings,
  EvidenceKey,
  ExtractionProposal,
  GeminiDiagnostics,
  ResolvedPlace,
  ShareAgentPlatform,
  ToolInvocation,
} from './types.ts';

// STAGE 5 — bumped to v2 alongside the hardened prompt + run-id +
// total-budget enforcement. Bump the suffix whenever the *prompt text*
// or any field in the contract above changes so the eval log + dev
// panel can attribute behavior changes correctly.
// 2026-05-27 — Patch 7: added optional `placeHypotheses` field to
// the Gemini response schema so deterministic code can chase ranked
// guesses against Places.
export const AGENT_PROMPT_VERSION = 'prod-2026-05-27.v3';
export const AGENT_DEFAULT_MODEL = 'gemini-3-flash-preview';
const GEMINI_RESPONSE_MIME_TYPE = 'application/json';

// STAGE 5 — overall agent run budget (model + tools combined). The
// orchestrator already applies its own outer budget (see
// supabase/functions/process-share-link/shadowRun.ts), but enforcing one
// here too means failures degrade to a `failed` proposal instead of
// stranding the caller.
const AGENT_TOTAL_BUDGET_MS = 18_000;
// 2026-05-27 — Patch 4: aligned with edge function inline cap.
const DEFAULT_GEMINI_TIMEOUT_MS = 15_000;
// Hard cap on total tool invocations recorded in a single run. The
// agent has no autonomous loop today so this is mostly defensive — but
// the cap survives any future tool-use loop being added.
const AGENT_MAX_TOOL_INVOCATIONS = 24;
const PLACES_MAX_QUERY_ATTEMPTS = 4;

export type RunShareAgentInput = {
  url: string;
  platform: ShareAgentPlatform;
  title: string | null;
  description: string | null;
  /** Already-detected handles, if the orchestrator has them. */
  detectedHandles?: DetectedHandles | null;
  /** Already-fetched profile bios, if any. The agent will not refetch. */
  profileBios?: ProfileBioResult[];
  /** Optional pre-fetched Places candidates (skip searchPlaces tool call). */
  prefetchedPlaces?: PlacesSearchCandidate[];
  /** Optional location bias for the searchPlaces tool call. */
  locationBias?: LocationBias;
  /** API keys / config. Never logged. */
  env: {
    geminiApiKey: string | null;
    googlePlacesKey: string | null;
  };
  /** Override model (for testing). */
  model?: string;
  /** Allow the agent to make a Places call itself. Default true. */
  allowPlacesSearch?: boolean;
  /** Debug-only override for the agent total budget. */
  agentBudgetMs?: number;
  /** Debug-only override for the Gemini call timeout. */
  geminiTimeoutMs?: number;
};

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function failedProposal(input: {
  url: string;
  platform: ShareAgentPlatform;
  reason: string;
}): ExtractionProposal {
  return {
    placeName: null,
    normalizedPlaceName: null,
    address: null,
    city: null,
    state: null,
    country: null,
    searchQuery: '',
    platform: input.platform,
    sourceUrl: input.url,
    confidence: 'low',
    decision: 'failed',
    safeToAutoSave: false,
    needsUserConfirmation: false,
    evidenceUsed: [],
    toolsUsed: [],
    reasoning: input.reason,
    rejectionReasons: [input.reason],
    candidates: [],
  };
}

function trimPromptField(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

function normalizePromptCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAgentPrompt(args: {
  url: string;
  platform: ShareAgentPlatform;
  title: string | null;
  description: string | null;
  handles: DetectedHandles;
  profileSummaries: string[];
  placesCandidates: PlacesSearchCandidate[];
}): string {
  const title = trimPromptField(args.title, 140);
  const rawDescription = trimPromptField(args.description, 180);
  const normalizedTitle = normalizePromptCompare(title);
  const normalizedDescription = normalizePromptCompare(rawDescription);
  const description =
    normalizedTitle &&
    normalizedDescription &&
    (normalizedDescription.includes(normalizedTitle) || normalizedTitle.includes(normalizedDescription))
      ? ''
      : rawDescription;
  const profileBlock =
    args.profileSummaries.length > 0
      ? args.profileSummaries.map((summary) => trimPromptField(summary, 140)).join('\n')
      : '(none)';
  const placesBlock =
    args.placesCandidates.length > 0
      ? args.placesCandidates
          .slice(0, 8)
          .map(
            (c, i) =>
              `${i + 1}. ${c.name} — ${c.formattedAddress ?? '(no address)'} [types=${(c.types ?? []).join(',')}]`,
          )
          .join('\n')
      : '(no places search performed yet)';
  return [
    'You are the Nearr share-extraction agent (promptVersion ' + AGENT_PROMPT_VERSION + ').',
    'Your job: identify the SINGLE real-world restaurant or place this social post is ABOUT,',
    'and explain your reasoning so a deterministic safety layer can decide whether to auto-save.',
    'You are a careful classifier, not a guesser. When in doubt, choose candidate_confirmation or manual_fallback.',
    '',
    'EVIDENCE PRIORITY (highest to lowest):',
    '  1. caption_explicit_address  — full street address in title/description (STRONGEST).',
    '  2. caption_explicit_venue    — explicit venue name in title/description (STRONG).',
    '  3. profile_bio_address       — extracted address from a profile bio.',
    '  4. profile_bio_name          — extracted business name from a profile bio.',
    '  5. profile_bio_city          — extracted city from a profile bio.',
    '  6. transcript_venue          — venue name explicitly stated in audio.',
    '  7. profile_display_name      — display name only (NOT a confirmed venue).',
    '  8. tagged_handle_only / poster_handle_only — handle text alone (NEVER a venue).',
    '',
    'HARD RULES — these are non-negotiable. Violating any of them means do NOT auto-save:',
    '  - The poster\'s name (display name OR handle) is NOT the venue. A creator named',
    '    "Joe Huang" sharing a restaurant is not a place called "Joe Huang".',
    '  - A raw @handle (e.g. @manasiri.thai) is NOT a venue. Handles can only',
    '    SUPPORT a candidate that already has independent caption/bio/Places evidence.',
    '  - profile_blocked / http_429 means the profile is UNVERIFIED. You must not',
    '    treat its display name or supposed bio as confirmed evidence.',
    '  - Generic food/review text ("best tacos in LA", "this place was fire",',
    '    "food review", "trying X cuisine") is generic_content. Cite it and refuse',
    '    auto-save unless an independent strong evidence key is also present.',
    '  - A direct caption venue name IS strong evidence and clears the hard floor.',
    '  - A full street address IS the strongest evidence (caption_explicit_address).',
    '  - The chosen `googlePlaceId` MUST come from the placesCandidates list below.',
    '    NEVER invent place IDs. If no candidate matches, return decision="manual_fallback"',
    '    or "candidate_confirmation" with the supplied candidates and explain why.',
    '  - Transcript is currently unsupported. Cite transcript_unsupported only;',
    '    NEVER claim transcript_venue evidence.',
    '',
    'REASONING REQUIREMENTS — your `reasoning` field must explicitly cover:',
    '  (a) the single piece of evidence you weighted MOST heavily,',
    '  (b) why you picked this Places candidate over the others (one sentence each',
    '      for the rejected alternatives in `rejectionReasons`),',
    '  (c) why you allowed or refused auto-save (which hard rule applied).',
    'Keep it under ~6 sentences. No marketing copy, no apologies.',
    '',
    'OUTPUT — return STRICT JSON in this exact shape:',
    '{',
    '  "placeName": string | null,',
    '  "normalizedPlaceName": string | null,',
    '  "address": string | null,',
    '  "city": string | null,',
    '  "state": string | null,',
    '  "country": string | null,',
    '  "searchQuery": string,',
    '  "confidence": "high" | "medium" | "low",',
    '  "decision": "auto_save" | "candidate_confirmation" | "manual_fallback" | "failed",',
    '  "safeToAutoSave": boolean,',
    '  "needsUserConfirmation": boolean,',
    '  "evidenceUsed": string[],   // EvidenceKey values from the list above',
    '  "reasoning": string,        // why you chose the venue and rejected others',
    '  "rejectionReasons": string[],',
    '  "candidates": [             // your ranking of supplied Places candidates',
    '    { "googlePlaceId": string, "name": string, "matchScore": number, "rationale": string }',
    '  ],',
    '  "placeHypotheses": [        // OPTIONAL — up to 3 ranked guesses for deterministic Places re-query',
    '    {',
    '      "placeName": string,',
    '      "address": string,      // may be partial / "" if unknown',
    '      "city": string,',
    '      "state": string,',
    '      "evidenceSource": "caption" | "title" | "poster" | "handle" | "address" | "uncertain",',
    '      "confidence": "high" | "medium" | "low",',
    '      "reason": string,',
    '      "shouldQueryPlaces": boolean   // false for clearly-unrelated guesses (suppliers, collabs)',
    '    }',
    '  ]',
    '}',
    '',
    'placeHypotheses guidance: prefer multiple guesses when the post is ambiguous,',
    'when the strongest evidence is a partial address, or when the placesCandidates list',
    'above does not contain the venue you actually identified. ONE guess is fine when',
    'caption_explicit_venue + caption_explicit_address agree. Mark supplier / collab /',
    'tagged-influencer guesses with shouldQueryPlaces=false so we do not chase them.',
    '',
    'INPUTS:',
    `url: ${args.url}`,
    `platform: ${args.platform}`,
    `title: ${title}`,
    `description: ${description}`,
    `posterHandle: ${args.handles.posterHandle ?? '(none)'}`,
    `taggedHandles: ${args.handles.taggedHandles.join(', ') || '(none)'}`,
    `profiles:\n${profileBlock}`,
    `placesCandidates:\n${placesBlock}`,
  ].join('\n');
}

function summarizeProfile(p: ProfileBioResult): string {
  const parts = [`@${p.handle}`, `status=${p.status}`];
  if (p.displayName) parts.push(`displayName="${p.displayName.replace(/"/g, "'")}"`);
  if (p.bio) parts.push(`bio="${p.bio.replace(/"/g, "'").slice(0, 240)}"`);
  if (p.website) parts.push(`website=${p.website}`);
  if (p.note) parts.push(`note=${p.note}`);
  return parts.join(' ');
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function truncateGeminiPreview(value: string | null | undefined, max = 300): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

function extractGeminiCandidateText(candidate: Record<string, unknown> | null): string {
  if (!candidate) return '';
  const content =
    candidate.content && typeof candidate.content === 'object'
      ? (candidate.content as Record<string, unknown>)
      : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      return typeof (part as Record<string, unknown>).text === 'string'
        ? ((part as Record<string, unknown>).text as string)
        : '';
    })
    .filter(Boolean)
    .join('')
    .trim();
}

function buildGeminiDiagnostics(args: {
  model: string;
  httpStatus: number | null;
  json: Record<string, unknown> | null;
  errorMessage?: string | null;
  latencyMs: number;
}): GeminiDiagnostics {
  const candidates = Array.isArray(args.json?.candidates)
    ? (args.json?.candidates as unknown[])
    : [];
  const firstCandidate =
    candidates[0] && typeof candidates[0] === 'object'
      ? (candidates[0] as Record<string, unknown>)
      : null;
  const promptFeedback =
    args.json?.promptFeedback && typeof args.json.promptFeedback === 'object'
      ? (args.json.promptFeedback as Record<string, unknown>)
      : null;
  const errorObj =
    args.json?.error && typeof args.json.error === 'object'
      ? (args.json.error as Record<string, unknown>)
      : null;
  const text = extractGeminiCandidateText(firstCandidate);
  return {
    model: args.model,
    responseMimeType: GEMINI_RESPONSE_MIME_TYPE,
    httpStatus: args.httpStatus,
    topLevelKeys: args.json ? Object.keys(args.json) : [],
    candidatesLength: candidates.length,
    finishReason:
      typeof firstCandidate?.finishReason === 'string' ? firstCandidate.finishReason : null,
    finishMessage:
      typeof firstCandidate?.finishMessage === 'string' ? firstCandidate.finishMessage : null,
    promptBlockReason:
      typeof promptFeedback?.blockReason === 'string' ? promptFeedback.blockReason : null,
    textExists: text.length > 0,
    textLength: text.length,
    textPreview: truncateGeminiPreview(text),
    errorMessage:
      args.errorMessage ??
      (typeof errorObj?.message === 'string' ? errorObj.message : null),
    modelVersion:
      typeof args.json?.modelVersion === 'string' ? (args.json.modelVersion as string) : null,
    responseId: typeof args.json?.responseId === 'string' ? (args.json.responseId as string) : null,
    latencyMs: args.latencyMs,
  };
}

function formatGeminiDiagnosticsForLog(diag: GeminiDiagnostics): string {
  const fields = [
    `model=${diag.model}`,
    `http=${diag.httpStatus ?? 'none'}`,
    `keys=${diag.topLevelKeys.join(',') || 'none'}`,
    `candidates=${diag.candidatesLength}`,
    `finishReason=${diag.finishReason ?? 'none'}`,
    `promptBlockReason=${diag.promptBlockReason ?? 'none'}`,
    `textExists=${diag.textExists}`,
    `textLength=${diag.textLength}`,
    `error=${diag.errorMessage ?? 'none'}`,
  ];
  if (diag.textPreview) fields.push(`preview=${JSON.stringify(diag.textPreview)}`);
  return fields.join(' ');
}

function makeGeminiError(message: string, diagnostics: GeminiDiagnostics): Error & {
  diagnostics: GeminiDiagnostics;
} {
  const error = new Error(message) as Error & { diagnostics: GeminiDiagnostics };
  error.diagnostics = diagnostics;
  return error;
}

function asConfidence(value: unknown): AgentConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function asDecision(value: unknown): AgentDecision {
  return value === 'auto_save' ||
    value === 'candidate_confirmation' ||
    value === 'manual_fallback' ||
    value === 'failed'
    ? value
    : 'manual_fallback';
}

const KNOWN_EVIDENCE: EvidenceKey[] = [
  'caption_explicit_venue',
  'caption_explicit_address',
  'profile_bio_name',
  'profile_bio_address',
  'profile_bio_city',
  'profile_display_name',
  'profile_blocked',
  'transcript_venue',
  'transcript_unsupported',
  'tagged_handle_only',
  'poster_handle_only',
  'places_strong_match',
  'places_weak_match',
  'places_no_match',
  'generic_content',
];

function asEvidenceArray(value: unknown): EvidenceKey[] {
  if (!Array.isArray(value)) return [];
  const out: EvidenceKey[] = [];
  for (const v of value) {
    if (typeof v === 'string' && (KNOWN_EVIDENCE as string[]).includes(v)) {
      out.push(v as EvidenceKey);
    }
  }
  return out;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

// 2026-05-27 — Patch 7: ranked Gemini guesses. Pure parser; never
// throws. Treats every field as optional and clamps to at most 3
// ranked guesses. We do NOT trust these as evidence — they only
// drive deterministic Places re-queries downstream.
type PlaceHypothesis = {
  placeName: string;
  address: string;
  city: string;
  state: string;
  evidenceSource: string;
  confidence: string;
  reason: string;
  shouldQueryPlaces: boolean;
};

function parsePlaceHypotheses(raw: unknown): PlaceHypothesis[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceHypothesis[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const placeName = typeof e.placeName === 'string' ? e.placeName.trim() : '';
    if (!placeName) continue;
    out.push({
      placeName,
      address: typeof e.address === 'string' ? e.address.trim() : '',
      city: typeof e.city === 'string' ? e.city.trim() : '',
      state: typeof e.state === 'string' ? e.state.trim() : '',
      evidenceSource: typeof e.evidenceSource === 'string' ? e.evidenceSource : 'uncertain',
      confidence: typeof e.confidence === 'string' ? e.confidence : 'low',
      reason: typeof e.reason === 'string' ? e.reason : '',
      shouldQueryPlaces: e.shouldQueryPlaces !== false,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function abbreviateState(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (/^[A-Za-z]{2}$/.test(cleaned)) return cleaned.toUpperCase();
  const stateMap: Record<string, string> = {
    california: 'CA',
    'new york': 'NY',
    texas: 'TX',
    florida: 'FL',
    illinois: 'IL',
  };
  return stateMap[cleaned.toLowerCase()] ?? null;
}

function removePossessiveSuffix(value: string): string {
  return value.replace(/\b([A-Za-z]+)'s\b/g, '$1');
}

function singularizeCrepes(value: string): string {
  return value.replace(/\bcrepes\b/gi, 'Crepe');
}

function inferCategoryHint(text: string | null | undefined): string | null {
  const lowered = (text ?? '').toLowerCase();
  if (!lowered) return null;
  if (/(cafe|café|coffee)/.test(lowered)) return 'cafe';
  if (/burger/.test(lowered)) return 'burger';
  if (/pizza|pizzeria/.test(lowered)) return 'pizzeria';
  if (/taco|taqueria/.test(lowered)) return 'taqueria';
  if (/restaurant/.test(lowered)) return 'restaurant';
  if (/grill/.test(lowered)) return 'grill';
  return null;
}

function buildPlacesRetryQueries(args: {
  proposal: ExtractionProposal;
  title: string | null;
  description: string | null;
  attemptedQueries: string[];
}): string[] {
  const placeName = args.proposal.normalizedPlaceName ?? args.proposal.placeName ?? '';
  const address = args.proposal.address?.trim() ?? '';
  const city = args.proposal.city?.trim() ?? '';
  const state = args.proposal.state?.trim() ?? '';
  const stateShort = abbreviateState(state);
  const categoryHint = inferCategoryHint([args.title, args.description].filter(Boolean).join(' '));
  const baseVariants = uniqueStrings([
    // 2026-05-27 — Patch 6: venue+address FIRST (only when both are
    // known) so the retry never hands a bare address to Google when
    // a real venue name is available — that's the path that returns
    // generic "<number> <street>" cards.
    placeName && address && city && state ? `${placeName} ${address}, ${city}, ${state}` : null,
    placeName && address && city ? `${placeName} ${address}, ${city}` : null,
    placeName && address ? `${placeName} ${address}` : null,
    // 2026-05-26: address-first retries — strongest evidence per docs.
    address && city && state ? `${address}, ${city}, ${state}` : null,
    address && city ? `${address}, ${city}` : null,
    address || null,
    address && placeName ? `${placeName} ${address}` : null,
    args.proposal.searchQuery,
    [placeName, city, state].filter(Boolean).join(' '),
    [removePossessiveSuffix(placeName), city].filter(Boolean).join(' '),
    [singularizeCrepes(placeName), city, stateShort].filter(Boolean).join(' '),
    categoryHint ? [removePossessiveSuffix(placeName), categoryHint, city].filter(Boolean).join(' ') : null,
  ]);
  const attempted = new Set(args.attemptedQueries.map((query) => query.toLowerCase()));
  return baseVariants
    .filter((query) => !attempted.has(query.toLowerCase()))
    .slice(0, Math.max(0, PLACES_MAX_QUERY_ATTEMPTS - args.attemptedQueries.length));
}

type ScoredPlaceCandidate = {
  candidate: PlacesSearchCandidate;
  score: number;
  rationale: string;
};

function hydrateProposalCandidatesFromPlaces(
  scored: ScoredPlaceCandidate[],
  existing: AgentCandidate[],
): AgentCandidate[] {
  // 2026-05-27 — Patch 12: prefer scored Places candidates over
  // Gemini's existing stubs whenever Places returned anything. The
  // stubs typically carry `googlePlaceId === name` (no real Place
  // ID) which would render as a broken Place card on the client AND
  // hide the real business from the candidate list / safety
  // plausibility check. When Places returned nothing, keep the
  // existing list so we don't lose Gemini's narrative context.
  if (scored.length === 0) return existing;
  return scored.slice(0, 5).map(({ candidate, score, rationale }) => ({
    googlePlaceId: candidate.googlePlaceId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress ?? null,
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    types: candidate.types ?? [],
    matchScore: score,
    rationale,
  }));
}

async function callGemini(
  prompt: string,
  model: string,
  apiKey: string,
  // 2026-05-27 — Patch 4: default raised 12s → 15s. Callers still
  // clamp this via `Math.min(remainingMs(), geminiTimeoutMs)`.
  timeoutMs = 15_000,
): Promise<{ text: string; latencyMs: number; diagnostics: GeminiDiagnostics }> {
  const start = nowMs();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // STAGE 5 — explicit timeout so a hung Gemini call cannot blow past
  // the agent total-budget enforcement above.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: GEMINI_RESPONSE_MIME_TYPE },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const latencyMs = Math.round(nowMs() - start);
    const diagnostics = buildGeminiDiagnostics({
      model,
      httpStatus: null,
      json: null,
      errorMessage:
        (err as Error)?.name === 'AbortError'
          ? `gemini_timeout_${timeoutMs}ms`
          : (err as Error)?.message ?? 'gemini_request_failed',
      latencyMs,
    });
    throw makeGeminiError(diagnostics.errorMessage ?? 'gemini_request_failed', diagnostics);
  } finally {
    clearTimeout(t);
  }
  const latencyMs = Math.round(nowMs() - start);
  const raw = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  const diagnostics = buildGeminiDiagnostics({
    model,
    httpStatus: res.status,
    json,
    errorMessage: null,
    latencyMs,
  });
  if (!res.ok) {
    throw makeGeminiError(
      `gemini_http_${res.status}: ${diagnostics.errorMessage ?? 'request_failed'}`,
      diagnostics,
    );
  }
  if (diagnostics.promptBlockReason) {
    throw makeGeminiError(`gemini_prompt_blocked:${diagnostics.promptBlockReason}`, diagnostics);
  }
  const text = extractGeminiCandidateText(
    Array.isArray(json?.candidates) && json?.candidates[0] && typeof json.candidates[0] === 'object'
      ? (json.candidates[0] as Record<string, unknown>)
      : null,
  );
  if (!text) {
    throw makeGeminiError(
      diagnostics.finishReason
        ? `empty gemini response (finishReason=${diagnostics.finishReason})`
        : 'empty gemini response',
      diagnostics,
    );
  }
  return { text, latencyMs, diagnostics };
}

export async function runGeminiJsonSmokeTest(input: {
  prompt: string;
  model?: string | null;
  apiKey: string | null;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  modelUsed: string;
  parsedJson: Record<string, unknown> | null;
  rawText: string | null;
  diagnostics: GeminiDiagnostics | null;
  reason: string | null;
}> {
  const modelUsed = input.model?.trim() || AGENT_DEFAULT_MODEL;
  if (!input.apiKey) {
    return {
      ok: false,
      modelUsed,
      parsedJson: null,
      rawText: null,
      diagnostics: null,
      reason: 'gemini_key_missing',
    };
  }
  try {
    const { text, diagnostics } = await callGemini(
      input.prompt,
      modelUsed,
      input.apiKey,
      input.timeoutMs ?? 12_000,
    );
    const objectText = extractJsonObject(text) ?? text;
    const parsedJson = JSON.parse(objectText) as Record<string, unknown>;
    return {
      ok: true,
      modelUsed,
      parsedJson,
      rawText: text,
      diagnostics,
      reason: null,
    };
  } catch (err) {
    const diagnostics =
      err && typeof err === 'object' && 'diagnostics' in err
        ? ((err as { diagnostics?: GeminiDiagnostics }).diagnostics ?? null)
        : null;
    return {
      ok: false,
      modelUsed,
      parsedJson: null,
      rawText: diagnostics?.textPreview ?? null,
      diagnostics,
      reason: (err as Error)?.message ?? 'gemini_smoke_failed',
    };
  }
}

/**
 * STAGE 5 — short, opaque, time-prefixed identifier for one agent run.
 * Surfaces in `AgentDebug.runId`, the dev debug panel, eval logs, and
 * the persisted `share_agent_runs` row so a single run can be traced
 * end-to-end without leaking PII or tokens.
 */
function newRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return `r${ts}-${rand}`;
}

export async function runShareAgent(input: RunShareAgentInput): Promise<AgentResponse> {
  const overallStart = nowMs();
  const runId = newRunId();
  const agentBudgetMs = Math.max(1_000, input.agentBudgetMs ?? AGENT_TOTAL_BUDGET_MS);
  const geminiTimeoutMs = Math.max(1_000, input.geminiTimeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS);
  const deadline = overallStart + agentBudgetMs;
  const warnings: string[] = [];
  const toolInvocations: ToolInvocation[] = [];
  const platform = input.platform;
  const url = input.url;
  const model = input.model ?? AGENT_DEFAULT_MODEL;
  const isOverBudget = () => nowMs() >= deadline;
  const remainingMs = () => Math.max(0, deadline - nowMs());
  let geminiDiagnostics: GeminiDiagnostics | null = null;
  const attemptedPlacesQueries: string[] = [];
  let finalPlacesQuery: string | null = null;
  let placesSearchMs = 0;
  let compareCandidatesMs = 0;

  // 1. Always include the transcript stub so callers see it explicitly.
  const transcript = fetchTranscript(url);
  toolInvocations.push(transcript.invocation);

  // 2. Detect handles if not already supplied.
  let handles: DetectedHandles;
  if (input.detectedHandles) {
    handles = input.detectedHandles;
    toolInvocations.push({
      tool: 'detectHandles',
      input: { platform, supplied: true },
      output: {
        posterHandle: handles.posterHandle,
        taggedCount: handles.taggedHandles.length,
      },
      status: 'ok',
      latencyMs: 0,
    });
  } else {
    const detected = detectHandles(
      [input.title, input.description].filter(Boolean).join('\n') || null,
      null,
      platform,
    );
    handles = detected.result;
    toolInvocations.push(detected.invocation);
  }

  // 3. Profile bios — use what's supplied; do NOT refetch (no cache).
  const profileBios: ProfileBioResult[] = input.profileBios ?? [];
  for (const p of profileBios) {
    toolInvocations.push({
      tool: 'fetchProfileBio',
      input: { platform: p.platform, handle: p.handle, supplied: true },
      output: { status: p.status, hasBio: !!p.bio, hasDisplayName: !!p.displayName },
      status:
        p.status === 'ok'
          ? 'ok'
          : p.status === 'blocked' || p.status === 'http_429'
          ? 'blocked'
          : p.status === 'unsupported'
          ? 'unsupported'
          : 'error',
      note: p.note,
      latencyMs: 0,
    });
  }

  // 4. Optional Places pre-search to give the agent grounded candidates.
  //
  // Strategy (2026-05-26 update): prefer DETERMINISTIC clean queries
  // over raw caption text. We:
  //   a) Try a likely street address extracted from caption/description
  //      first (strongest evidence — see docs/PROJECT_CONTEXT.md).
  //   b) Then try a cleaned caption seed (handles/hashtags/URLs/emoji
  //      and social wrappers stripped, capped at 80 chars).
  //   c) Then try the verified profile display name as a weak fallback.
  // Earlier non-empty result wins, but we ALSO keep address-first
  // candidates ahead of cleaned-text candidates so the model sees the
  // strongest evidence first in `placesCandidates`.
  let placesCandidates: PlacesSearchCandidate[] = input.prefetchedPlaces ?? [];
  const allowPlaces = input.allowPlacesSearch !== false;
  const titleText = input.title ?? '';
  const descriptionText = input.description ?? '';
  const likelyAddress: LikelyAddress | null =
    extractLikelyAddress(`${titleText}\n${descriptionText}`);
  if (likelyAddress) {
    warnings.push(`address_detected:${likelyAddress.raw}`);
  }
  const profileWithBio = profileBios.find((p) => p.status === 'ok' && (p.bio || p.displayName));
  // 2026-05-27 — Patch 6: derive a venue-name hint for the seed
  // Places query so we can ask `<Name> <Address>, <City>, <State>`
  // BEFORE any bare-address query. This stops the bare-address
  // variants from returning Google's generic <number> <street>
  // address card when there's a real business name available from
  // the caption or a tagged handle. Priority: explicit caption
  // venue ("📍 <Name>" / "<Name>, <Known City>") → verified
  // business display name → a single non-mall tagged handle.
  const captionVenueHints = extractCaptionVenueHints(
    [titleText, descriptionText].filter(Boolean).join('\n'),
  );
  const venueHandleCandidates = extractVenueHandleCandidates(handles);
  const handleHint =
    venueHandleCandidates.length === 1
      ? derivePlaceNameHintFromHandle(venueHandleCandidates[0])
      : null;
  const seedPlaceNameHint: string | null =
    captionVenueHints[0] ?? profileWithBio?.displayName ?? handleHint ?? null;
  if (seedPlaceNameHint) {
    warnings.push(`places_seed_name_hint:${seedPlaceNameHint}`);
  }
  if (placesCandidates.length === 0 && allowPlaces && input.env.googlePlacesKey) {
    const cleanQueries = buildCleanPlacesQueries({
      title: titleText,
      description: descriptionText,
      address: likelyAddress,
      placeName: seedPlaceNameHint,
      city: likelyAddress?.city ?? null,
      profileDisplayName: profileWithBio?.displayName ?? null,
      // 2026-05-27 — Patch 6: bumped 3 → 5 so the new venue+address
      // variants don't crowd out the bare-address fallback.
      max: 5,
    });
    for (const query of cleanQueries) {
      if (isOverBudget()) {
        warnings.push('places_seed_skipped_budget_exceeded');
        break;
      }
      const places = await searchPlaces(query, input.env.googlePlacesKey, input.locationBias);
      toolInvocations.push(places.invocation);
      placesSearchMs += places.invocation.latencyMs ?? 0;
      attemptedPlacesQueries.push(query);
      const count = places.result.candidates.length;
      warnings.push(`places_attempt:${query}=>${count}`);
      console.log(`[places] query=${JSON.stringify(query)} candidate_count=${count}`);
      if (count > 0) {
        placesCandidates = places.result.candidates;
        finalPlacesQuery = query;
        break;
      }
    }
  }

  // Determine if the strongest seed query (address-first) was indeed
  // attempted; this lets us inject `caption_explicit_address` evidence
  // deterministically below, without depending on Gemini self-report.
  const addressSeedAttempted =
    likelyAddress != null &&
    attemptedPlacesQueries.some((q) => q.includes(likelyAddress.raw));

  // 5. Build prompt.
  const prompt = buildAgentPrompt({
    url,
    platform,
    title: input.title,
    description: input.description,
    handles,
    profileSummaries: profileBios.map(summarizeProfile),
    placesCandidates,
  });

  // 6. Call Gemini.
  if (!input.env.geminiApiKey) {
    const proposal = failedProposal({ url, platform, reason: 'gemini_key_missing' });
    const debug: AgentDebug = {
      runId,
      promptVersion: AGENT_PROMPT_VERSION,
      modelUsed: model,
      latencyMs: Math.round(nowMs() - overallStart),
      warnings: ['gemini_key_missing'],
      geminiDiagnostics: null,
      toolInvocations,
    };
    return applySafety({
      proposal,
      resolvedPlace: null,
      safety: {
        decision: 'failed',
        safeToAutoSave: false,
        reasons: ['gemini_key_missing'],
        acceptedEvidence: [],
        rejectedEvidence: [],
      },
      debug,
    });
  }

  let parsed: Record<string, unknown> | null = null;
  let modelLatency = 0;
  if (isOverBudget()) {
    warnings.push(`agent_budget_exceeded_pre_model_${agentBudgetMs}ms`);
  } else {
    try {
      const { text, latencyMs, diagnostics } = await callGemini(
        prompt,
        model,
        input.env.geminiApiKey,
        Math.min(remainingMs(), geminiTimeoutMs),
      );
      modelLatency = latencyMs;
      geminiDiagnostics = diagnostics;
      console.log(`[agent-gemini] ${formatGeminiDiagnosticsForLog(diagnostics)}`);
      const objectText = extractJsonObject(text) ?? text;
      parsed = JSON.parse(objectText) as Record<string, unknown>;
    } catch (err) {
      geminiDiagnostics =
        err && typeof err === 'object' && 'diagnostics' in err
          ? ((err as { diagnostics?: GeminiDiagnostics }).diagnostics ?? null)
          : null;
      if (geminiDiagnostics) {
        console.log(`[agent-gemini] ${formatGeminiDiagnosticsForLog(geminiDiagnostics)}`);
      }
      warnings.push(`gemini_failed: ${(err as Error)?.message ?? 'unknown'}`);
    }
  }

  if (!parsed) {
    const proposal = failedProposal({ url, platform, reason: 'gemini_failed_or_unparseable' });
    proposal.rejectionReasons.push(...warnings);
    const debug: AgentDebug = {
      runId,
      promptVersion: AGENT_PROMPT_VERSION,
      modelUsed: model,
      latencyMs: Math.round(nowMs() - overallStart),
      warnings,
      geminiDiagnostics,
      toolInvocations,
    };
    return applySafety({
      proposal,
      resolvedPlace: null,
      safety: {
        decision: 'failed',
        safeToAutoSave: false,
        reasons: ['gemini_failed'],
        acceptedEvidence: [],
        rejectedEvidence: [],
      },
      debug,
    });
  }

  const proposal: ExtractionProposal = {
    placeName: typeof parsed.placeName === 'string' ? parsed.placeName.trim() || null : null,
    normalizedPlaceName:
      typeof parsed.normalizedPlaceName === 'string'
        ? parsed.normalizedPlaceName.trim() || null
        : null,
    address: typeof parsed.address === 'string' ? parsed.address.trim() || null : null,
    city: typeof parsed.city === 'string' ? parsed.city.trim() || null : null,
    state: typeof parsed.state === 'string' ? parsed.state.trim() || null : null,
    country: typeof parsed.country === 'string' ? parsed.country.trim() || null : null,
    searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery.trim() : '',
    platform,
    sourceUrl: url,
    confidence: asConfidence(parsed.confidence),
    decision: asDecision(parsed.decision),
    safeToAutoSave: parsed.safeToAutoSave === true,
    needsUserConfirmation: parsed.needsUserConfirmation !== false,
    evidenceUsed: asEvidenceArray(parsed.evidenceUsed),
    toolsUsed: Array.from(new Set(toolInvocations.map((t) => t.tool))),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    rejectionReasons: Array.isArray(parsed.rejectionReasons)
      ? (parsed.rejectionReasons as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
    candidates: Array.isArray(parsed.candidates)
      ? (parsed.candidates as unknown[])
          .map((c): AgentCandidate | null => {
            if (!c || typeof c !== 'object') return null;
            const cc = c as Record<string, unknown>;
            const id = typeof cc.googlePlaceId === 'string' ? cc.googlePlaceId : '';
            const name = typeof cc.name === 'string' ? cc.name : '';
            if (!id && !name) return null;
            // STAGE 2 — hydrate from the original Places result so the
            // host app can render full picker rows without a second
            // network call.
            const places = id
              ? placesCandidates.find((p) => p.googlePlaceId === id)
              : undefined;
            return {
              googlePlaceId: id,
              name: name || places?.name || '',
              formattedAddress: places?.formattedAddress ?? null,
              latitude: typeof places?.latitude === 'number' ? places.latitude : null,
              longitude: typeof places?.longitude === 'number' ? places.longitude : null,
              types: places?.types ?? [],
              matchScore: typeof cc.matchScore === 'number' ? cc.matchScore : undefined,
              rationale: typeof cc.rationale === 'string' ? cc.rationale : undefined,
            };
          })
          .filter((c): c is AgentCandidate => c !== null)
      : [],
  };

  // Inject derived evidence keys based on the actual environment so safety
  // gate does not depend solely on the model's self-report.
  const ensure = (k: EvidenceKey) => {
    if (!proposal.evidenceUsed.includes(k)) proposal.evidenceUsed.push(k);
  };
  if (profileBios.some((p) => p.status === 'blocked' || p.status === 'http_429')) {
    ensure('profile_blocked');
  }
  ensure('transcript_unsupported');

  // 2026-05-26: deterministic address evidence. If the regex above found
  // a plausible US street address in caption/description AND we have a
  // resolved address from the proposal OR a Places attempt seeded from
  // it, record `caption_explicit_address` so the safety gate cannot miss
  // it when the model forgot to cite it.
  if (likelyAddress) {
    ensure('caption_explicit_address');
    if (!proposal.address) proposal.address = likelyAddress.raw;
    if (!proposal.city && likelyAddress.city) proposal.city = likelyAddress.city;
    if (!proposal.state && likelyAddress.state) proposal.state = likelyAddress.state;
  }

  if (
    placesCandidates.length === 0 &&
    allowPlaces &&
    input.env.googlePlacesKey &&
    (proposal.evidenceUsed.includes('caption_explicit_venue') ||
      proposal.evidenceUsed.includes('caption_explicit_address') ||
      !!proposal.placeName ||
      !!proposal.address)
  ) {
    const retryQueries = buildPlacesRetryQueries({
      proposal,
      title: input.title,
      description: input.description,
      attemptedQueries: attemptedPlacesQueries,
    });
    for (const query of retryQueries) {
      if (isOverBudget()) {
        warnings.push('places_retry_skipped_budget_exceeded');
        break;
      }
      const places = await searchPlaces(query, input.env.googlePlacesKey, input.locationBias);
      toolInvocations.push(places.invocation);
      placesSearchMs += places.invocation.latencyMs ?? 0;
      attemptedPlacesQueries.push(query);
      const count = places.result.candidates.length;
      warnings.push(`places_attempt:${query}=>${count}`);
      console.log(`[places] query=${JSON.stringify(query)} candidate_count=${count}`);
      if (count > 0) {
        placesCandidates = places.result.candidates;
        finalPlacesQuery = query;
        break;
      }
    }
  }

  // 2026-05-27 — Patch 7: Gemini-supplied ranked hypotheses.
  //
  // Gemini may return up to 3 `placeHypotheses` it considers
  // plausible. They are SUGGESTIONS — deterministic code decides
  // (safety.ts still owns auto-save). When we still have no Places
  // candidates after the retry loop above, or when our top
  // candidate looks weak (e.g. a generic address card), run Places
  // queries against each hypothesis in rank order, accept the
  // first non-empty result, and let the existing scoring + safety
  // pipeline judge it. Skips hypotheses with shouldQueryPlaces
  // false (suppliers, collabs, etc.).
  const hypotheses: PlaceHypothesis[] = parsePlaceHypotheses(parsed.placeHypotheses);
  if (hypotheses.length > 0) {
    warnings.push(`place_hypotheses_count:${hypotheses.length}`);
  }
  const topGenericCard =
    placesCandidates[0] && likelyAddress
      ? isGenericAddressCard({ name: placesCandidates[0].name }, likelyAddress)
      : false;
  const needHypothesisQueries =
    allowPlaces &&
    input.env.googlePlacesKey &&
    hypotheses.length > 0 &&
    (placesCandidates.length === 0 || topGenericCard);
  if (needHypothesisQueries) {
    const hypoQueries: string[] = [];
    for (const h of hypotheses) {
      if (!h.shouldQueryPlaces) continue;
      const name = h.placeName.trim();
      if (!name) continue;
      const addr = h.address.trim();
      const city = h.city.trim();
      const state = h.state.trim();
      if (addr && city && state) hypoQueries.push(`${name} ${addr}, ${city}, ${state}`);
      if (addr && city) hypoQueries.push(`${name} ${addr}, ${city}`);
      if (addr) hypoQueries.push(`${name} ${addr}`);
      if (city && state) hypoQueries.push(`${name} ${city}, ${state}`);
      else if (city) hypoQueries.push(`${name} ${city}`);
      else hypoQueries.push(name);
    }
    const attempted = new Set(attemptedPlacesQueries.map((q) => q.toLowerCase()));
    const dedupedHypoQueries = uniqueStrings(hypoQueries).filter(
      (q) => !attempted.has(q.toLowerCase()),
    );
    for (const query of dedupedHypoQueries.slice(0, PLACES_MAX_QUERY_ATTEMPTS)) {
      if (isOverBudget()) {
        warnings.push('places_hypothesis_skipped_budget_exceeded');
        break;
      }
      const places = await searchPlaces(query, input.env.googlePlacesKey, input.locationBias);
      toolInvocations.push(places.invocation);
      placesSearchMs += places.invocation.latencyMs ?? 0;
      attemptedPlacesQueries.push(query);
      const count = places.result.candidates.length;
      warnings.push(`places_hypothesis_attempt:${query}=>${count}`);
      console.log(`[places-hypothesis] query=${JSON.stringify(query)} candidate_count=${count}`);
      if (count > 0) {
        // Replace ONLY when the new query gives us something that's
        // not also a generic address card; otherwise merge so the
        // scorer sees both.
        const first = places.result.candidates[0];
        const firstIsGeneric = likelyAddress
          ? isGenericAddressCard({ name: first.name }, likelyAddress)
          : false;
        if (placesCandidates.length === 0 || (topGenericCard && !firstIsGeneric)) {
          placesCandidates = places.result.candidates;
          finalPlacesQuery = query;
        } else {
          // Merge new candidates (dedup by place id).
          const seen = new Set(placesCandidates.map((c) => c.googlePlaceId));
          for (const c of places.result.candidates) {
            if (!seen.has(c.googlePlaceId)) {
              placesCandidates.push(c);
              seen.add(c.googlePlaceId);
            }
          }
        }
        if (!firstIsGeneric) break;
      }
    }
  }

  // Pick a Places match for the proposal (best-effort) and grade it.
  // STAGE 3 — also collect the second-best score and a name/address
  // match flag so the safety gate can verify ambiguity and mismatches.
  let resolvedPlace: ResolvedPlace | null = null;
  let topScore: number | null = null;
  let secondScore: number | null = null;
  let resolvedNameMatch: boolean | null = null;
  let resolvedAddressMatch: boolean | null = null;
  let scoredCandidates: ScoredPlaceCandidate[] = [];
  // Tracks whether the resolved place came from a Places search performed
  // IN THIS RUN (either a fresh `searchPlaces` tool call above OR a
  // prefetched candidate set the orchestrator passed in for this run).
  let resolvedFromThisRun = false;
  if (placesCandidates.length > 0) {
    let best: { c: PlacesSearchCandidate; score: number } | null = null;
    let runner: { c: PlacesSearchCandidate; score: number } | null = null;
    for (const c of placesCandidates) {
      const cmp = compareCandidateToEvidence(c, {
        placeName: proposal.placeName,
        address: proposal.address,
        city: proposal.city,
        state: proposal.state,
        bioName: profileBios.find((p) => p.displayName)?.displayName ?? null,
      });
      toolInvocations.push(cmp.invocation);
      compareCandidatesMs += cmp.invocation.latencyMs ?? 0;
      // 2026-05-27 — Patch 6: when we have a venue-name hint (caption
      // pin, "Name, City", or single venue-like handle) and Google
      // returned its generic "<number> <street>" address card for
      // this address, demote that card so a real business candidate
      // can beat it. We never silently auto-save the generic card —
      // safety.ts also gates this — but demoting it here prevents
      // candidate_confirmation from surfacing the address-as-name.
      let score = cmp.result.score;
      let rationale = cmp.result.rationale;
      if (
        seedPlaceNameHint &&
        likelyAddress &&
        isGenericAddressCard({ name: c.name }, likelyAddress)
      ) {
        score = Math.max(0, score - 0.5);
        rationale = `${rationale} [demoted: generic_address_card vs caption venue hint]`;
        warnings.push(`places_generic_address_card_demoted:${c.name}`);
      }
      // 2026-05-27 — Patch 9: wrong-location guard. When the
      // caption inferred a US state (either from likelyAddress or
      // from a known city/state literal) AND this candidate is in
      // a different state or non-US country, demote heavily so a
      // correct-location candidate (or no candidate) wins.
      const expectedStateForScoring =
        proposal.state ||
        likelyAddress?.state ||
        extractCityStateContext(
          [input.title, input.description].filter(Boolean).join(' '),
        )?.state ||
        null;
      if (
        expectedStateForScoring &&
        isWrongLocationCandidate(c.formattedAddress ?? null, expectedStateForScoring)
      ) {
        score = Math.max(0, score - 0.8);
        rationale = `${rationale} [demoted: wrong_location vs expected ${expectedStateForScoring}]`;
        warnings.push(`places_wrong_location_demoted:${c.name}`);
      }
      scoredCandidates.push({ candidate: c, score, rationale });
      if (!best || score > best.score) {
        runner = best;
        best = { c, score };
      } else if (!runner || score > runner.score) {
        runner = { c, score };
      }
    }
    scoredCandidates = scoredCandidates.sort((a, b) => b.score - a.score);
    proposal.candidates = hydrateProposalCandidatesFromPlaces(scoredCandidates, proposal.candidates);
    if (best) {
      topScore = best.score;
      secondScore = runner ? runner.score : null;
      if (best.score >= 0.75) ensure('places_strong_match');
      else if (best.score >= 0.4) ensure('places_weak_match');
      else ensure('places_no_match');
      resolvedPlace = {
        googlePlaceId: best.c.googlePlaceId,
        name: best.c.name,
        formattedAddress: best.c.formattedAddress ?? null,
        latitude: best.c.latitude ?? null,
        longitude: best.c.longitude ?? null,
        types: best.c.types,
      };
      resolvedFromThisRun = true;
      if (proposal.placeName) {
        resolvedNameMatch = simpleNameMatch(best.c.name, proposal.placeName);
      }
      if (proposal.address) {
        resolvedAddressMatch = simpleAddressMatch(
          best.c.formattedAddress ?? null,
          proposal.address,
        );
      }
      if (
        proposal.decision === 'manual_fallback' &&
        proposal.placeName &&
        simpleNameMatch(best.c.name, proposal.placeName)
      ) {
        proposal.decision = 'candidate_confirmation';
        proposal.needsUserConfirmation = true;
        proposal.safeToAutoSave = false;
        if (!proposal.rejectionReasons.includes('places_candidate_found_requires_confirmation')) {
          proposal.rejectionReasons.push('places_candidate_found_requires_confirmation');
        }
        if (!proposal.reasoning.includes('candidate_confirmation')) {
          proposal.reasoning = `${proposal.reasoning} Deterministic Places retries recovered a matching candidate, so the result is candidate_confirmation instead of manual_fallback.`.trim();
        }
      }
    }
  } else {
    ensure('places_no_match');
  }

  if (attemptedPlacesQueries.length > 0) {
    warnings.push(`places_final_query:${finalPlacesQuery ?? 'none'}`);
  }

  // STAGE 5 — defensive cap on tool log size; the agent currently has
  // no autonomous loop, but if a future revision adds one this prevents
  // an unbounded tool array from being emitted.
  if (toolInvocations.length > AGENT_MAX_TOOL_INVOCATIONS) {
    warnings.push(`tool_log_truncated_${toolInvocations.length}_to_${AGENT_MAX_TOOL_INVOCATIONS}`);
    toolInvocations.length = AGENT_MAX_TOOL_INVOCATIONS;
  }

  const safetyStart = nowMs();
  const stageTimings: AgentStageTimings = {
    geminiMs: modelLatency || null,
    placesMs: placesSearchMs || null,
    compareCandidatesMs: compareCandidatesMs || null,
    totalMs: Math.round(nowMs() - overallStart),
    placesAttemptCount: attemptedPlacesQueries.length,
  };

  const debug: AgentDebug = {
    runId,
    promptVersion: AGENT_PROMPT_VERSION,
    modelUsed: model,
    latencyMs: Math.round(nowMs() - overallStart),
    warnings: warnings.concat(modelLatency ? [`model_latency_ms=${modelLatency}`] : []),
    geminiDiagnostics,
    stageTimings,
    toolInvocations,
  };

  // 2026-05-26: deterministic single-line summary log right before the
  // safety gate runs, so we can correlate evidence -> final decision in
  // a single log line per run. Keep keys short; do not dump full text.
  try {
    console.log(
      `[extraction] evidence_summary=${JSON.stringify({
        runId,
        platform,
        addressDetected: !!likelyAddress,
        addressSeedAttempted,
        placeName: proposal.placeName,
        address: proposal.address,
        city: proposal.city,
        evidence: proposal.evidenceUsed,
        placesCount: placesCandidates.length,
        topScore,
        secondScore,
        resolvedFromThisRun,
        attemptedQueries: attemptedPlacesQueries.length,
      })}`,
    );
  } catch {
    // logging must never throw
  }

  const expectedStateForSafety =
    proposal.state ||
    likelyAddress?.state ||
    extractCityStateContext(
      [input.title, input.description].filter(Boolean).join(' '),
    )?.state ||
    null;

  const withSafety = applySafety(
    { proposal, resolvedPlace, safety: undefined as any, debug },
    {
      resolvedPlaceFromThisRun: resolvedFromThisRun,
      topMatchScore: topScore,
      secondMatchScore: secondScore,
      resolvedPlaceNameMatchesProposal: resolvedNameMatch,
      resolvedPlaceAddressMatchesProposal: resolvedAddressMatch,
      resolvedFormattedAddress: resolvedPlace?.formattedAddress ?? null,
      expectedState: expectedStateForSafety,
    },
  );
  withSafety.debug.stageTimings = {
    ...withSafety.debug.stageTimings,
    safetyMs: Math.round(nowMs() - safetyStart),
    totalMs: Math.round(nowMs() - overallStart),
  };
  try {
    console.log(
      `[safety] final_decision=${withSafety.safety.decision} safeToAutoSave=${withSafety.safety.safeToAutoSave} reasons=${JSON.stringify(withSafety.safety.reasons)}`,
    );
  } catch {
    // logging must never throw
  }
  return withSafety;
}

// ---------------------------------------------------------------------------
// STAGE 3 — minimal name/address fuzzy match for the safety gate. Both
// helpers are intentionally permissive: they only return `false` when
// the strings are clearly unrelated (no shared significant token / no
// shared digit run). The gate treats `false` as a hard mismatch and
// blocks auto-save. `true` is "no obvious mismatch" — Places strong-match
// scoring (≥0.75) is still required for auto-save.
// ---------------------------------------------------------------------------

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MATCH_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'a',
  'an',
  'restaurant',
  'cafe',
  'coffee',
  'bar',
  'kitchen',
  'grill',
  'co',
  'company',
  'inc',
  'llc',
]);

function simpleNameMatch(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = new Set(
    normalizeForMatch(actual)
      .split(' ')
      .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t)),
  );
  const e = normalizeForMatch(expected)
    .split(' ')
    .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t));
  if (e.length === 0) return true; // nothing significant to compare
  return e.some((t) => a.has(t));
}

function simpleAddressMatch(
  actual: string | null | undefined,
  expected: string,
): boolean {
  if (!actual) return false;
  const aDigits = (actual.match(/\d+/g) ?? []).filter((d) => d.length >= 2);
  const eDigits = (expected.match(/\d+/g) ?? []).filter((d) => d.length >= 2);
  if (eDigits.length === 0) {
    // No street number in the expected address — fall back to token
    // overlap (street name / city).
    return simpleNameMatch(actual, expected);
  }
  // Require at least one shared multi-digit run (street number or zip).
  return eDigits.some((d) => aDigits.includes(d));
}
