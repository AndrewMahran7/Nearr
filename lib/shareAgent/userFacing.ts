// lib/shareAgent/userFacing.ts
//
// STAGE 3 — pure derivation of the *user-facing* surface from an agent
// response. Used by:
//   - the Supabase Edge Function (extract AND save modes) to attach the
//     agent block to the response, AND
//   - the host app to decide which UI / save action to trigger, AND
//   - the iOS share extension (via the Edge Function), AND
//   - the eval script (`evalShareAgentShadow.ts`) to assert behavior.
//
// HARD RULES:
//   1. Auto-save is permitted ONLY when the deterministic safety gate
//      (lib/shareAgent/safety.ts) returned `decision === 'auto_save'`
//      AND `safeToAutoSave === true`. This module DOES NOT add new
//      auto-save permissions; it just forwards them.
//   2. Reasoning text is included in the payload but the host app
//      only renders it under __DEV__ / debug toggle.
//   3. The block is intentionally JSON-serialisable and free of any
//      live secrets, raw HTML, or Authorization headers.

import type {
  AgentResponse,
  AgentCandidate,
  AgentStageTimings,
  GeminiDiagnostics,
  ResolvedPlace,
} from './types.ts';

export type UserFacingDecision =
  | 'auto_save' // safety gate passed; caller MAY silent-save resolvedPlace
  | 'candidate_confirmation' // show picker
  | 'multi_candidate_confirmation' // show multi-select picker for ≥2 distinct places
  | 'manual_fallback' // show manual search
  | 'failed'; // agent could not produce useful evidence

export type ClientAgentCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  matchScore: number;
  rationale: string;
};

export type ClientAgentToolCall = {
  tool: string;
  status: 'ok' | 'blocked' | 'unsupported' | 'error';
  note?: string | null;
  latencyMs?: number | null;
};

export type ClientAgentBlock = {
  /**
   * STAGE 5 — opaque per-run identifier. Lets the dev debug panel,
   * eval logs, and `share_agent_runs` row line up for a single run.
   */
  runId: string;
  promptVersion: string;
  modelUsed: string;
  /** Raw agent decision before safety review. Dev-only context. */
  agentDecision: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  /** Authoritative safety-gate decision. */
  safetyDecision: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  /** What the host app should render / do. Always equals safetyDecision. */
  userFacingDecision: UserFacingDecision;
  /**
   * STAGE 3 — true iff the safety gate cleared every rule for auto-save.
   * Callers MUST re-check this flag (defense-in-depth) before invoking
   * any save-side effect.
   */
  safeToAutoSave: boolean;
  /**
   * True iff the agent proposed `auto_save` but safety downgraded it.
   * Useful for the dev panel and eval reports.
   */
  downgradedFromAutoSave: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  evidenceUsed: string[];
  rejectionReasons: string[];
  toolsUsed: string[];
  /**
   * STAGE 5 — per-tool status breakdown. Same length / order as the
   * underlying `AgentDebug.toolInvocations`. Used by the dev panel to
   * surface blocked / rate-limited / unsupported tool calls without
   * leaking raw HTML or secrets (those are already sanitized at the
   * tool layer).
   */
  toolCalls: ClientAgentToolCall[];
  geminiDiagnostics: GeminiDiagnostics | null;
  stageTimings: AgentStageTimings | null;
  candidates: ClientAgentCandidate[];
  resolvedPlace: ResolvedPlace | null;
  warnings: string[];
  latencyMs: number | null;
};

const REASONING_MAX = 800;

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function toClientCandidate(c: AgentCandidate): ClientAgentCandidate {
  return {
    googlePlaceId: c.googlePlaceId,
    name: c.name,
    formattedAddress: c.formattedAddress ?? null,
    latitude: typeof c.latitude === 'number' ? c.latitude : null,
    longitude: typeof c.longitude === 'number' ? c.longitude : null,
    types: Array.isArray(c.types) ? c.types : [],
    matchScore: typeof c.matchScore === 'number' ? c.matchScore : 0,
    rationale: truncate(c.rationale, 240),
  };
}

/**
 * Maps the post-safety decision into the surface the host app should
 * render. Stage 3 — auto_save is forwarded when the safety gate cleared
 * it; otherwise the decision is whatever safety chose.
 */
function deriveUserFacing(
  response: AgentResponse,
  candidates: ClientAgentCandidate[],
  resolvedPlace: ResolvedPlace | null,
): { decision: UserFacingDecision; downgraded: boolean; safeToAutoSave: boolean } {
  const safety = response.safety;
  if (safety.decision === 'auto_save' && safety.safeToAutoSave === true && resolvedPlace) {
    return { decision: 'auto_save', downgraded: false, safeToAutoSave: true };
  }
  // STAGE 3 hardcap: even if the agent itself said auto_save, if the
  // deterministic safety gate downgraded it (or there is no resolved
  // place to save), we never expose `auto_save` to the caller.
  const downgraded = response.proposal.decision === 'auto_save' && safety.decision !== 'auto_save';
  if (safety.decision === 'candidate_confirmation') {
    if (candidates.length === 0) {
      return { decision: 'manual_fallback', downgraded, safeToAutoSave: false };
    }
    return { decision: 'candidate_confirmation', downgraded, safeToAutoSave: false };
  }
  if (safety.decision === 'manual_fallback') {
    return { decision: 'manual_fallback', downgraded, safeToAutoSave: false };
  }
  if (safety.decision === 'auto_save' && (!safety.safeToAutoSave || !resolvedPlace)) {
    // Defensive: safety said auto_save but flag is wrong or there is no
    // place to save. Refuse to escalate.
    if (candidates.length > 0) {
      return { decision: 'candidate_confirmation', downgraded: true, safeToAutoSave: false };
    }
    return { decision: 'manual_fallback', downgraded: true, safeToAutoSave: false };
  }
  return { decision: 'failed', downgraded, safeToAutoSave: false };
}

/**
 * Builds the JSON-safe agent block that ships in the Edge Function
 * response and is consumed by both the host app and the eval script.
 *
 * Returns `null` when the agent produced no usable response (e.g. missing
 * Gemini key, network failure). Callers should fall through to the legacy
 * pipeline in that case.
 */
export function buildClientAgentBlock(
  response: AgentResponse | null,
  meta?: { warnings?: string[]; latencyMs?: number | null },
): ClientAgentBlock | null {
  if (!response) return null;
  const candidates = (response.proposal.candidates ?? []).map(toClientCandidate);
  const { decision, downgraded, safeToAutoSave } = deriveUserFacing(
    response,
    candidates,
    response.resolvedPlace ?? null,
  );
  return {
    runId: response.debug.runId,
    promptVersion: response.debug.promptVersion,
    modelUsed: response.debug.modelUsed,
    agentDecision: response.proposal.decision,
    safetyDecision: response.safety.decision,
    userFacingDecision: decision,
    safeToAutoSave,
    downgradedFromAutoSave: downgraded,
    confidence: response.proposal.confidence,
    reasoning: truncate(response.proposal.reasoning, REASONING_MAX),
    evidenceUsed: response.proposal.evidenceUsed ?? [],
    rejectionReasons: response.safety.reasons ?? response.proposal.rejectionReasons ?? [],
    toolsUsed: (response.debug.toolInvocations ?? []).map((t) => t.tool),
    toolCalls: (response.debug.toolInvocations ?? []).map((t) => ({
      tool: t.tool,
      status: t.status,
      note: t.note ?? null,
      latencyMs: typeof t.latencyMs === 'number' ? t.latencyMs : null,
    })),
    geminiDiagnostics: response.debug.geminiDiagnostics ?? null,
    stageTimings: response.debug.stageTimings ?? null,
    candidates,
    resolvedPlace: response.resolvedPlace ?? null,
    warnings: [...(response.debug.warnings ?? []), ...(meta?.warnings ?? [])],
    latencyMs: meta?.latencyMs ?? null,
  };
}

