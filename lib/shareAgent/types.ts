/**
 * Shared types for the backend-first share-extraction AI agent.
 *
 * STAGE 1 — SHADOW MODE ONLY.
 *
 * These types describe the new agent's input/output contract. Nothing in
 * the user-facing app reads these yet; the agent runs in shadow mode beside
 * the existing pipeline so we can compare results.
 *
 * Architectural rules:
 *   - This module MUST stay free of React Native imports so it can be
 *     consumed by:
 *       - Supabase Edge Function (Deno runtime, in shadow mode)
 *       - Node-only eval scripts under scripts/
 *   - It MUST NOT import secrets directly. Callers pass keys/env in.
 *   - It is purely declarative — no runtime side-effects.
 */

export type ShareAgentPlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'link';

export type AgentConfidence = 'high' | 'medium' | 'low';

export type AgentDecision =
  | 'auto_save'
  | 'candidate_confirmation'
  | 'manual_fallback'
  | 'failed';

/** Atomic units of evidence the agent may cite when making a decision. */
export type EvidenceKey =
  | 'caption_explicit_venue'
  | 'caption_explicit_address'
  | 'profile_bio_name'
  | 'profile_bio_address'
  | 'profile_bio_city'
  | 'profile_display_name'
  | 'profile_blocked'
  | 'transcript_venue'
  | 'transcript_unsupported'
  | 'tagged_handle_only'
  | 'poster_handle_only'
  | 'places_strong_match'
  | 'places_weak_match'
  | 'places_no_match'
  | 'places_address_verified'
  | 'places_generic_address_card'
  | 'generic_content';

/** A single tool call the agent made while reasoning. */
export type ToolInvocation = {
  tool:
    | 'fetchPostMetadata'
    | 'detectHandles'
    | 'fetchProfileBio'
    | 'fetchTranscript'
    | 'searchPlaces'
    | 'compareCandidateToEvidence';
  /** Free-form input snapshot. Must NOT include secrets or full HTML. */
  input?: Record<string, unknown>;
  /** Free-form output snapshot. Truncated/sanitized by the tool. */
  output?: Record<string, unknown>;
  /** Tool status: 'ok' | 'blocked' | 'unsupported' | 'error'. */
  status: 'ok' | 'blocked' | 'unsupported' | 'error';
  /** Optional human-readable note. */
  note?: string;
  /** Wall-clock latency for this tool call, ms. */
  latencyMs?: number;
};

/** A single Places candidate the agent considered. */
export type AgentCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  types?: string[];
  /** 0..1, agent's own scoring of how well this matches the evidence. */
  matchScore?: number;
  /** Why this candidate was kept or rejected. */
  rationale?: string;
};

/** The single best place the agent resolved to (post-Places search). */
export type ResolvedPlace = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  types?: string[];
};

export type GeminiDiagnostics = {
  model: string;
  responseMimeType: string;
  httpStatus: number | null;
  topLevelKeys: string[];
  candidatesLength: number;
  finishReason: string | null;
  finishMessage: string | null;
  promptBlockReason: string | null;
  textExists: boolean;
  textLength: number;
  textPreview: string | null;
  errorMessage: string | null;
  modelVersion: string | null;
  responseId: string | null;
  latencyMs: number;
};

export type AgentStageTimings = {
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

/**
 * The agent's structured proposal BEFORE the deterministic safety gate
 * has run. This is the raw model output (post-validation).
 */
export type ExtractionProposal = {
  placeName: string | null;
  normalizedPlaceName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  searchQuery: string;
  platform: ShareAgentPlatform;
  sourceUrl: string;
  confidence: AgentConfidence;
  /** Agent's own decision. The deterministic safety gate may downgrade it. */
  decision: AgentDecision;
  /** Agent's own claim. Safety gate is the authoritative source of truth. */
  safeToAutoSave: boolean;
  needsUserConfirmation: boolean;
  evidenceUsed: EvidenceKey[];
  toolsUsed: ToolInvocation['tool'][];
  reasoning: string;
  rejectionReasons: string[];
  candidates: AgentCandidate[];
};

/**
 * The deterministic safety gate's verdict. This is the SOURCE OF TRUTH
 * for whether anything may be silently saved.
 */
export type SafetyDecision = {
  decision: AgentDecision;
  safeToAutoSave: boolean;
  /** Why the gate downgraded (or upheld) the agent's proposal. */
  reasons: string[];
  /** Evidence keys the gate accepted. */
  acceptedEvidence: EvidenceKey[];
  /** Evidence keys the gate rejected. */
  rejectedEvidence: EvidenceKey[];
};

/** Debug breadcrumbs surfaced to logs / shadow persistence. */
export type AgentDebug = {
  /**
   * STAGE 5 — opaque, time-prefixed identifier unique to a single
   * agent run. Surfaced in eval logs, the dev debug panel, and the
   * persisted `share_agent_runs` row so a single run can be traced
   * end-to-end.
   */
  runId: string;
  promptVersion: string;
  modelUsed: string;
  /** Total agent latency in ms (model + all tool calls). */
  latencyMs: number;
  /** Errors that did not abort the run. */
  warnings: string[];
  /** Safe Gemini request/response diagnostics, if the model was called. */
  geminiDiagnostics?: GeminiDiagnostics | null;
  /** Per-stage timing breakdown for debug/dev visibility. */
  stageTimings?: AgentStageTimings;
  /** Full tool call log. */
  toolInvocations: ToolInvocation[];
};

/** The full agent response returned to the orchestrator. */
export type AgentResponse = {
  proposal: ExtractionProposal;
  resolvedPlace: ResolvedPlace | null;
  safety: SafetyDecision;
  debug: AgentDebug;
};
